package com.cywu.dataos.mpi.load;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import com.cywu.dataos.mpi.normalizer.MpiNormalizer;
import com.cywu.dataos.mpi.storage.DorisAccessConfiguration;

/**
 * 源身份装载：Doris ods_ep.ep_mz_cfzb 处方行 → 归一去重后的源身份，
 * 全量重算幂等（先清本租户本源旧集合，不依赖 UNIQUE KEY 隐式覆盖）。
 * 身份粒度 = 机构(YLJGDM) × 患者主键(PATIENT_ID)；属性取组内 MAX
 * （姓名/性别/卡号对同一登记稳定，年龄/联系方式仅展示与哈希证据）。
 * 注意清空会重置 mpi_person_id 回写列——回写发生在装载之后的决策阶段，无损。
 */
@Service
@ConditionalOnProperty(name = "data-os.mpi.doris.url")
public class MpiLoaderService {

    /** 通用 SQL（H2 测试与 Doris 同构）。 */
    static final String SELECT_IDENTITIES = """
            SELECT YLJGDM, CAST(PATIENT_ID AS VARCHAR), MAX(HZXM), MAX(HZXB), MAX(KH), MAX(HZNL), MAX(LXFS)
            FROM ods_ep.ep_mz_cfzb
            GROUP BY YLJGDM, PATIENT_ID
            """;

    /** 全量重算纪律：先清本租户本源旧集合（与候选对/匹配结果同一纪律）。 */
    static final String CLEAR_IDENTITIES = """
            DELETE FROM dataos_mpi.mpi_source_identity WHERE tenant_id = ? AND source_system = ?
            """;

    static final String INSERT_IDENTITY = """
            INSERT INTO dataos_mpi.mpi_source_identity
              (tenant_id, institution_code, source_system, source_key, patient_id, card_no_norm,
               name_norm, gender, age_display, contact_hash, id_card_hash, mpi_person_id, loaded_at, updated_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, NULL, NULL, ?, ?)
            """;

    private static final int BATCH_SIZE = 500;

    private final JdbcTemplate doris;
    private final String hashSalt;

    public MpiLoaderService(@Qualifier("dorisJdbc") JdbcTemplate doris,
                            DorisAccessConfiguration.DorisProperties properties) {
        this.doris = doris;
        this.hashSalt = properties.getHashSalt();
    }

    public record LoadResult(int identitiesLoaded, int identitiesSkipped) {
    }

    public LoadResult load(String tenantId, String sourceSystem) {
        doris.update(CLEAR_IDENTITIES, tenantId, sourceSystem);
        var now = Timestamp.from(Instant.now());
        List<Object[]> batch = new ArrayList<>();
        int skipped = 0;
        var rows = doris.query(SELECT_IDENTITIES, (rs, i) -> new Object[] {
                rs.getString(1), rs.getString(2), rs.getString(3), rs.getString(4),
                rs.getString(5), rs.getString(6), rs.getString(7)});
        for (var row : rows) {
            var institution = trimToNull(row[0]);
            var patientId = trimToNull(row[1]);
            var name = MpiNormalizer.normalizeName((String) row[2]);
            if (institution == null || patientId == null || name.isEmpty()) {
                // 缺机构/主键/姓名的身份无法参与任何规则：跳过并计数，不入库。
                skipped++;
                continue;
            }
            batch.add(new Object[] {
                    tenantId, institution, sourceSystem, patientId, patientId,
                    MpiNormalizer.normalizeCardNo((String) row[4]),
                    name,
                    MpiNormalizer.normalizeGender((String) row[3]),
                    trimToNull(row[5]),
                    MpiNormalizer.saltedHash((String) row[6], hashSalt),
                    now, now});
        }
        for (int start = 0; start < batch.size(); start += BATCH_SIZE) {
            doris.batchUpdate(INSERT_IDENTITY, batch.subList(start, Math.min(start + BATCH_SIZE, batch.size())));
        }
        return new LoadResult(batch.size(), skipped);
    }

    private static String trimToNull(Object value) {
        if (value == null) return null;
        var text = String.valueOf(value).trim();
        return text.isEmpty() ? null : text;
    }
}
