package com.cywu.dataos.mpi.load;

import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.jdbc.Sql;

import com.cywu.dataos.mpi.candidate.MpiBlockingService;
import com.cywu.dataos.mpi.candidate.MpiPairId;
import com.cywu.dataos.mpi.normalizer.MpiNormalizer;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 装载与召回的集成测试：H2 模拟 Doris 侧结构，SELECT/INSERT 真实执行。
 * 覆盖：脏数据跳过、属性归一、B4 卡号复用召回、B6 同名同性别召回、
 * B3 跨源就绪、跨规则 pair 去重、rebuild 端点统计。
 */
@ActiveProfiles("test")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@Sql("/mpi-doris-test-schema.sql")
class MpiLoadBlockingTests {

    @Autowired
    @Qualifier("dorisJdbc")
    private JdbcTemplate doris;

    @Autowired
    private MpiLoaderService loader;

    @Autowired
    private MpiBlockingService blocking;

    @Autowired
    private TestRestTemplate rest;

    @BeforeEach
    void cleanSimulatedTables() {
        doris.update("DELETE FROM ods_ep.ep_mz_cfzb");
        doris.update("DELETE FROM dataos_mpi.mpi_source_identity");
        doris.update("DELETE FROM dataos_mpi.mpi_candidate_pair");
    }

    private void seedPrescriptions() {
        doris.batchUpdate("""
                INSERT INTO ods_ep.ep_mz_cfzb (YLJGDM, PATIENT_ID, HZXM, HZXB, KH, HZNL, LXFS)
                VALUES (?, ?, ?, ?, ?, ?, ?)
                """, List.of(
                new Object[] {"H0001", 1L, "张三", "男", "4413001", "3", "13800000000"},
                // 同一身份的多张处方行：聚合为一行源身份。
                new Object[] {"H0001", 1L, "张 三", "男", "4413001", "4", "13800000000"},
                // 与身份 1 同卡不同人：卡号复用，B4 的目标形态。
                new Object[] {"H0001", 2L, "李四", "女", "4413001", "5", null},
                // 同卡第三身份（同机构）：构成三身份卡号复用链。
                new Object[] {"H0001", 3L, "王五", "1", "４４１３００１", "7", null},
                // 同机构同名同性别且联系方式相同：B6 的目标形态。
                new Object[] {"H0001", 5L, "张三", "男", "zz1", "9", "13800000000"},
                // 同机构同名同性别但联系方式不同：B6 必须不召回（联系方式是必要佐证）。
                new Object[] {"H0001", 6L, "张三", "男", "q1", "1", "13900000000"},
                // 缺主键 / 缺姓名：跳过计数。
                new Object[] {"H0001", null, "赵六", "男", "x1", "1", null},
                new Object[] {"H0002", 4L, "", "女", "y1", "2", null}));
    }

    @Test
    void loadNormalizesAggregatesAndSkipsInvalidIdentities() {
        seedPrescriptions();
        var result = loader.load("default", "EP");

        assertThat(result.identitiesLoaded()).isEqualTo(5);
        assertThat(result.identitiesSkipped()).isEqualTo(2);

        var identities = doris.queryForList(
                "SELECT source_key, name_norm, gender, card_no_norm, contact_hash, age_display"
                        + " FROM dataos_mpi.mpi_source_identity ORDER BY source_key");
        assertThat(identities).hasSize(5);
        var first = identities.get(0);
        assertThat(first.get("SOURCE_KEY")).isEqualTo("1");
        assertThat(first.get("NAME_NORM")).isEqualTo("张三");
        assertThat(first.get("GENDER")).isEqualTo("M");
        assertThat(first.get("CONTACT_HASH")).asString().hasSize(64);
        // 王五（source_key=3）：全角卡号归一半角、数字性别归一 M。
        var third = identities.get(2);
        assertThat(third.get("CARD_NO_NORM")).isEqualTo("4413001");
        assertThat(third.get("GENDER")).isEqualTo("M");
        // 无联系方式：hash 列为空而非裸哈希。
        assertThat(third.get("CONTACT_HASH")).isNull();
    }

    @Test
    void blockingFindsCardReuseAndSameNamePairsWithDedup() {
        seedPrescriptions();
        loader.load("default", "EP");
        // 手工注入跨源身份：同机构同患者主键同联系方式（B3 就绪 + B6 佐证齐备）。
        doris.update("""
                INSERT INTO dataos_mpi.mpi_source_identity
                  (tenant_id, institution_code, source_system, source_key, patient_id, name_norm, gender,
                   contact_hash, loaded_at, updated_at)
                VALUES ('default', 'H0001', 'HIS', '1', '1', '张三', 'M', ?, CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """, MpiNormalizer.saltedHash("13800000000", "unit-test-salt"));

        var result = blocking.generate("default");

        // B4（同机构同卡）: EP|1/2/3 三身份共用 4413001 → 3 对；
        // B6（同名同性别同联系方式）: 张三男且联系方式 13800000000 的
        // EP|1、EP|5、HIS|1 两两成对，其中 (EP|1,HIS|1) 与 B3 重叠被去重归
        // B3 → B6 实得 2 对、B3 得 1 对。EP|6 联系方式不同，必须不召回。
        assertThat(result.totalPairs()).isEqualTo(6);
        assertThat(result.byB3()).isEqualTo(1);
        assertThat(result.byB4()).isEqualTo(3);
        assertThat(result.byB6()).isEqualTo(2);

        var pairs = doris.queryForList(
                "SELECT identity_a, identity_b, blocking_rule FROM dataos_mpi.mpi_candidate_pair");
        assertThat(pairs).anySatisfy(pair -> {
            assertThat(pair.get("IDENTITY_A")).isEqualTo("H0001|EP|1");
            assertThat(pair.get("IDENTITY_B")).isEqualTo("H0001|EP|2");
            assertThat(pair.get("BLOCKING_RULE")).isEqualTo("B4");
        });
        // pair_id 与 Java 确定性算法一致（跨表引用契约）。
        var expectedId = MpiPairId.of("default", "H0001|EP|1", "H0001|EP|2");
        var storedId = doris.queryForObject("""
                SELECT pair_id FROM dataos_mpi.mpi_candidate_pair
                WHERE identity_a = 'H0001|EP|1' AND identity_b = 'H0001|EP|2'
                """, Long.class);
        assertThat(storedId).isEqualTo(expectedId);
    }

    @Test
    void blockingClearsStalePairsBeforeRegeneration() {
        seedPrescriptions();
        loader.load("default", "EP");
        // 伪造上一轮遗留候选（规则收紧前的旧集合）：重算后必须被清除。
        doris.update("""
                INSERT INTO dataos_mpi.mpi_candidate_pair
                  (pair_id, tenant_id, identity_a, identity_b, blocking_rule, generated_at)
                VALUES (999999, 'default', 'H0001|EP|2', 'H0001|EP|6', 'B6', CURRENT_TIMESTAMP)
                """);
        blocking.generate("default");
        var stale = doris.queryForObject(
                "SELECT COUNT(*) FROM dataos_mpi.mpi_candidate_pair WHERE pair_id = 999999", Integer.class);
        assertThat(stale).isZero();
        var total = doris.queryForObject(
                "SELECT COUNT(*) FROM dataos_mpi.mpi_candidate_pair", Integer.class);
        assertThat(total).isEqualTo(4);
    }

    @Test
    void rebuildEndpointReturnsAggregatedStats() {
        seedPrescriptions();
        var entity = rest.postForEntity("/api/v1/mpi/rebuild", null, Map.class);
        assertThat(entity.getStatusCode().value()).isEqualTo(200);
        var body = entity.getBody();
        assertThat(body.get("identitiesLoaded")).isEqualTo(5);
        assertThat(body.get("identitiesSkipped")).isEqualTo(2);
        assertThat(body.get("candidatePairs")).isEqualTo(4);
        @SuppressWarnings("unchecked")
        var blockingStats = (Map<String, Integer>) body.get("blocking");
        assertThat(blockingStats.get("B4")).isEqualTo(3);
        assertThat(blockingStats.get("B6")).isEqualTo(1);
        assertThat(blockingStats.get("B3")).isEqualTo(0);
    }
}
