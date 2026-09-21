package com.cywu.dataos.controlplane.mapping;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

import com.cywu.dataos.controlplane.api.ConflictException;
import com.cywu.dataos.controlplane.api.InvalidRequestException;
import com.cywu.dataos.controlplane.executor.AdapterUnavailableException;
import com.cywu.dataos.controlplane.standard.StandardAdminService;
import com.cywu.dataos.controlplane.standard.UpdateStandardVersionRequest;
import com.cywu.dataos.controlplane.standard.CreateStandardRequest;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * 标准映射业务规则（G23）：生命周期与 checksum 门控（含漂移拒绝）、标准停用阻断、
 * 发布取代与回退、受控转换白名单校验、导入 dry-run、覆盖率投影、执行器不可用
 * 的诚实 503。验证执行器以 MockBean 返回聚合形状。
 */
@SpringBootTest
@ActiveProfiles("test")
class MappingAdminServiceTest {

    private static final ObjectMapper JSON = new ObjectMapper();

    @Autowired
    private MappingAdminService service;

    @Autowired
    private MappingRepository repository;

    @Autowired
    private StandardAdminService standards;

    @MockBean
    private MappingValidationClient validationClient;

    // ---- 夹具 ----

    /** 发布一个含 CODE（值域 OPD/ER/PHY）+ STRING + DECIMAL 数据元的标准。 */
    private String publishedStandard() {
        var code = "std-" + UUID.randomUUID().toString().substring(0, 8);
        var request = new CreateStandardRequest(code, code + "标准", "d", "team",
                List.of(new CreateStandardRequest.ElementContract("channel", "挂号渠道",
                                "CODE", true, "定义", "NORMAL", "", List.of(
                                new CreateStandardRequest.ValueContract("OPD", "门诊", "", ""),
                                new CreateStandardRequest.ValueContract("ER", "急诊", "", ""),
                                new CreateStandardRequest.ValueContract("PHY", "体检", "", ""))),
                        new CreateStandardRequest.ElementContract("reg_no", "登记号",
                                "STRING", true, "定义", "NORMAL", "", List.of()),
                        new CreateStandardRequest.ElementContract("fee", "费用",
                                "DECIMAL", true, "定义", "NORMAL", "", List.of())));
        var created = standards.create(null, request, "tester");
        var versionId = (String) ((Map<?, ?>) created.get("version")).get("id");
        standards.submit(null, versionId, "tester");
        standards.publish(null, versionId, "tester");
        return (String) ((Map<?, ?>) created.get("standard")).get("id");
    }

    private static CreateMappingSetRequest.ItemContract item(String column, String element,
                                                             String transform, String param) {
        return new CreateMappingSetRequest.ItemContract(column, element, transform, param,
                "CONFIRMED", "");
    }

    private CreateMappingSetRequest request(String standardId, String code) {
        return new CreateMappingSetRequest(code, code + "映射", "doris-dataos.default.ods_ep.ep_mz_cfzb",
                "ods_ep.ep_mz_cfzb", standardId, List.of(
                        item("channel_code", "channel", "VALUE_MAP",
                                "{\"OPD\":\"OPD\",\"ER\":\"ER\",\"PHY\":\"PHY\"}"),
                        item("reg_no", "reg_no", "COPY", ""),
                        item("fee", "fee", "COPY", "")));
    }

    @SuppressWarnings("unchecked")
    private static String versionIdOf(Map<String, Object> detail) {
        return (String) ((Map<String, Object>) detail.get("version")).get("id");
    }

    private void mockValidation(String coverageJson) {
        try {
            JsonNode node = JSON.readTree(coverageJson);
            when(validationClient.validate(anyString(), any())).thenReturn(node);
        } catch (Exception failure) {
            throw new IllegalStateException(failure);
        }
    }

    private static final String ALL_PASS = """
            {"asOf":"2026-09-21T00:00:00Z","dataset":"ods_ep.ep_mz_cfzb","rowCount":100,
             "items":[{"sourceColumn":"x","sourceType":"varchar","targetType":"CODE",
                       "compatible":true,"nullRate":0.0,"coverage":1.0,"unmappedTop":[]}]}
            """;

    private static final String LOW_COVERAGE = """
            {"asOf":"2026-09-21T00:00:00Z","dataset":"ods_ep.ep_mz_cfzb","rowCount":100,
             "items":[{"sourceColumn":"x","sourceType":"varchar","targetType":"CODE",
                       "compatible":true,"nullRate":0.0,"coverage":0.7,"unmappedTop":[]}]}
            """;

    // ---- 生命周期与 checksum 门控 ----

    @Test
    void lifecycleValidateActivateSupersedeRollback() {
        var standardId = publishedStandard();
        var created = service.create(null, request(standardId, "map-" + UUID.randomUUID().toString().substring(0, 8)), "t");
        var v1 = versionIdOf(created);

        // 越级激活：未提交 → 状态机拒绝
        assertThatThrownBy(() -> service.activate(null, v1, "t"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("→ ACTIVE");
        // 无 PASS 证据：提交后直接激活 → checksum 门控拒绝
        service.submit(null, v1, "t");
        assertThatThrownBy(() -> service.activate(null, v1, "t"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("PASS 验证证据");

        mockValidation(ALL_PASS);
        var validated = service.validate(null, v1, "t");
        assertThat(((Map<?, ?>) ((List<?>) ((Map<?, ?>) validated.get("version")).get("validations")).get(0))
                .get("status")).isEqualTo("PASS");

        var activated = service.activate(null, v1, "t");
        assertThat(((Map<?, ?>) activated.get("set")).get("activeVersion").toString())
                .contains("versionNo=1").contains("ACTIVE");

        // v2 基于活动版复制：先漂移 checksum（改元素）再提交，旧证据失效 → 激活被拒
        var v2Detail = service.createVersion(null,
                (String) ((Map<?, ?>) activated.get("set")).get("id"), null, "t");
        var v2 = versionIdOf(v2Detail);
        service.validate(null, v2, "t"); // PASS 证据（v2 初版 checksum）
        service.updateVersion(null, v2, new UpdateMappingVersionRequest(null, List.of(
                item("channel_code", "channel", "VALUE_MAP", "{\"OPD\":\"OPD\",\"ER\":\"ER\"}"),
                item("reg_no", "reg_no", "COPY", ""))), "t"); // 内容漂移 → checksum 变
        service.submit(null, v2, "t");
        assertThatThrownBy(() -> service.activate(null, v2, "t"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("PASS 验证证据");

        // 重新验证（新 checksum 的 PASS）→ 激活 → v1 被取代
        service.validate(null, v2, "t");
        var v2Activated = service.activate(null, v2, "t");
        assertThat(v2Activated.get("versions").toString()).contains("RETIRED").contains("ACTIVE");
        assertThat(v2Activated.get("events").toString()).contains("取代");

        // 回退到 v1：v1 复活、v2 因回退停用；事件留痕
        var rolled = service.rollback(null, (String) ((Map<?, ?>) v2Activated.get("set")).get("id"), v1, "t");
        assertThat(((Map<?, ?>) rolled.get("version")).get("status")).isEqualTo("ACTIVE");
        assertThat(rolled.get("events").toString()).contains("回退");
        assertThat(rolled.get("events").toString()).contains("因回退被停用");
    }

    @Test
    void rollbackRequiresRetiredWithPassEvidence() {
        var standardId = publishedStandard();
        var created = service.create(null, request(standardId, "map-" + UUID.randomUUID().toString().substring(0, 8)), "t");
        var v1 = versionIdOf(created);
        var setId = (String) ((Map<?, ?>) created.get("set")).get("id");
        // 非 RETIRED 目标（DRAFT）拒绝
        assertThatThrownBy(() -> service.rollback(null, setId, v1, "t"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("RETIRED");
        mockValidation(ALL_PASS);
        service.submit(null, v1, "t");
        service.validate(null, v1, "t");
        service.activate(null, v1, "t");
        // 活动版本身不能作为回退目标
        assertThatThrownBy(() -> service.rollback(null, setId, v1, "t"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("RETIRED");
    }

    @Test
    void lowCoverageValidationIsFailAndBlocksActivation() {
        var standardId = publishedStandard();
        var created = service.create(null, request(standardId, "map-" + UUID.randomUUID().toString().substring(0, 8)), "t");
        var v1 = versionIdOf(created);
        service.submit(null, v1, "t");
        mockValidation(LOW_COVERAGE);
        var validated = service.validate(null, v1, "t");
        assertThat(((List<?>) ((Map<?, ?>) validated.get("version")).get("validations")).get(0).toString())
                .contains("FAIL");
        assertThatThrownBy(() -> service.activate(null, v1, "t"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("PASS 验证证据");
    }

    @Test
    void executorUnavailableSurfacesAsHonestUnavailable() {
        var standardId = publishedStandard();
        var created = service.create(null, request(standardId, "map-" + UUID.randomUUID().toString().substring(0, 8)), "t");
        var v1 = versionIdOf(created);
        when(validationClient.validate(anyString(), any()))
                .thenThrow(new AdapterUnavailableException("质量执行器暂时不可用: conn refused"));
        assertThatThrownBy(() -> service.validate(null, v1, "t"))
                .isInstanceOf(AdapterUnavailableException.class)
                .hasMessageContaining("质量执行器");
        // 无伪造验证行
        assertThat(repository.findValidations("default", v1, 10)).isEmpty();
    }

    // ---- 受控转换与目标校验 ----

    @Test
    void transformWhitelistAndTargetRulesEnforced() {
        var standardId = publishedStandard();
        var code = "map-" + UUID.randomUUID().toString().substring(0, 8);
        // 非法转换（任意 SQL 拒绝面）
        assertThatThrownBy(() -> service.create(null, new CreateMappingSetRequest(code, "n",
                "asset", "ods_ep.ep_mz_cfzb", standardId,
                List.of(item("channel_code", "channel", "SELECT 1", ""))), "t"))
                .isInstanceOf(InvalidRequestException.class)
                .hasMessageContaining("非法转换");
        // 目标数据元不在标准已发布版本
        assertThatThrownBy(() -> service.create(null, new CreateMappingSetRequest(code, "n",
                "asset", "ods_ep.ep_mz_cfzb", standardId,
                List.of(item("channel_code", "no_such_element", "COPY", ""))), "t"))
                .isInstanceOf(InvalidRequestException.class)
                .hasMessageContaining("不在标准已发布版本中");
        // VALUE_MAP 目标值不在值域
        assertThatThrownBy(() -> service.create(null, new CreateMappingSetRequest(code, "n",
                "asset", "ods_ep.ep_mz_cfzb", standardId,
                List.of(item("channel_code", "channel", "VALUE_MAP", "{\"OPD\":\"NOPE\"}"))), "t"))
                .isInstanceOf(InvalidRequestException.class)
                .hasMessageContaining("不在标准值域中");
        // TRIM 目标须 STRING
        assertThatThrownBy(() -> service.create(null, new CreateMappingSetRequest(code, "n",
                "asset", "ods_ep.ep_mz_cfzb", standardId,
                List.of(item("channel_code", "fee", "TRIM", ""))), "t"))
                .isInstanceOf(InvalidRequestException.class)
                .hasMessageContaining("目标必须是 STRING");
        // 源字段非安全标识符（注入面）
        assertThatThrownBy(() -> service.create(null, new CreateMappingSetRequest(code, "n",
                "asset", "ods_ep.ep_mz_cfzb", standardId,
                List.of(item("a) UNION SELECT 1 --", "reg_no", "COPY", ""))), "t"))
                .isInstanceOf(InvalidRequestException.class)
                .hasMessageContaining("source_column 非法");
        // 源字段重复
        assertThatThrownBy(() -> service.create(null, new CreateMappingSetRequest(code, "n",
                "asset", "ods_ep.ep_mz_cfzb", standardId,
                List.of(item("reg_no", "reg_no", "COPY", ""), item("reg_no", "reg_no", "COPY", ""))), "t"))
                .isInstanceOf(InvalidRequestException.class)
                .hasMessageContaining("源字段重复");
    }

    @Test
    void deprecatedStandardBlocksMappingWrites() {
        var standardId = publishedStandard();
        var created = service.create(null, request(standardId, "map-" + UUID.randomUUID().toString().substring(0, 8)), "t");
        var v1 = versionIdOf(created);
        // 标准版本停用（发布版被弃用后无 PUBLISHED 版本）
        var versions = (List<?>) ((Map<?, ?>) standards.detail(null, standardId, null)).get("versions");
        var publishedVersionId = ((Map<?, ?>) versions.get(0)).get("id").toString();
        standards.deprecate(null, publishedVersionId, "tester");
        // 新映射创建被拒（明确结果，不静默）
        assertThatThrownBy(() -> service.create(null, request(standardId, "map-" + UUID.randomUUID().toString().substring(0, 8)), "t"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("没有已发布版本");
        // 既有版本提交同样被拒
        assertThatThrownBy(() -> service.submit(null, v1, "t"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("没有已发布版本");
    }

    // ---- 导入（dry-run 先行）----

    @Test
    void importDryRunThenCommit() {
        var standardId = publishedStandard();
        var created = service.create(null, request(standardId, "map-" + UUID.randomUUID().toString().substring(0, 8)), "t");
        var v1 = versionIdOf(created);
        var csv = """
                source_column,target_element_code,transform,transform_param,conclusion
                channel_code,channel,VALUE_MAP,"{""OPD"":""OPD""}",CONFIRMED
                reg_no,reg_no,COPY,,CONFIRMED
                """;
        var dry = service.importItems(null, v1, csv, true, "t");
        assertThat(dry.get("dryRun")).isEqualTo(true);
        assertThat(dry.get("itemCount")).isEqualTo(2);
        assertThat((List<?>) dry.get("problems")).isEmpty();
        assertThat(dry.get("checksum").toString()).hasSize(64);
        // 落库替换
        var commit = service.importItems(null, v1, csv, false, "t");
        assertThat(commit.get("applied")).isEqualTo(true);
        var detail = service.detail(null, (String) ((Map<?, ?>) created.get("set")).get("id"), v1);
        assertThat(((List<?>) ((Map<?, ?>) detail.get("version")).get("items"))).hasSize(2);
        // 非 DRAFT 导入被拒
        service.submit(null, v1, "t");
        assertThatThrownBy(() -> service.importItems(null, v1, csv, false, "t"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("只有 DRAFT");
    }

    // ---- 覆盖率投影 ----

    @Test
    void coverageProjectionFollowsActiveMappings() {
        // 共享测试库可能有其他用例留下的 ACTIVE 映射——只断增量与结构
        var before = service.coverage(null);
        var coveredBefore = ((Number) before.get("coveredCodeElements")).longValue();

        var standardId = publishedStandard();
        mockValidation(ALL_PASS);
        var created = service.create(null, request(standardId, "map-" + UUID.randomUUID().toString().substring(0, 8)), "t");
        var v1 = versionIdOf(created);
        service.submit(null, v1, "t");
        service.validate(null, v1, "t");
        service.activate(null, v1, "t");

        var after = service.coverage(null);
        // 本用例的标准 CODE 元素 1 个（channel），激活映射后覆盖数至少 +1、覆盖率非空
        assertThat(((Number) after.get("publishedCodeElements")).longValue())
                .isGreaterThanOrEqualTo(((Number) before.get("publishedCodeElements")).longValue() + 1);
        assertThat(((Number) after.get("coveredCodeElements")).longValue()).isGreaterThan(coveredBefore);
        assertThat(after.get("coverage")).isNotNull();
    }

    @Test
    void activePointerCasSerializesConcurrentActivation() {
        var standardId = publishedStandard();
        var created = service.create(null, request(standardId, "map-" + UUID.randomUUID().toString().substring(0, 8)), "t");
        var setId = (String) ((Map<?, ?>) created.get("set")).get("id");
        // 初始指针为空：第一个 CAS 赢，第二个（仍以 null 为期望）输——并发激活串行化原语
        assertThat(repository.casActivePointer(setId, null, "version-a")).isEqualTo(1);
        assertThat(repository.casActivePointer(setId, null, "version-b")).isZero();
        assertThat(repository.casActivePointer(setId, "version-a", "version-b")).isEqualTo(1);
    }
}
