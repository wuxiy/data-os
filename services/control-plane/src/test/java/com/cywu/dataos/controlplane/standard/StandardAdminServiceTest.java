package com.cywu.dataos.controlplane.standard;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.cywu.dataos.controlplane.api.ConflictException;
import com.cywu.dataos.controlplane.api.InvalidRequestException;
import com.cywu.dataos.controlplane.api.ResourceNotFoundException;

/**
 * 数据标准业务规则（G22）：生命周期不可变、类型白名单、CODE 值域非空、
 * 发布取代、OM 未配置时 SYNC_PENDING 不伪造成功、对比/影响/FHIR 导出、
 * 导入 dry-run 先行。跨租户与角色的拒绝面归 StandardSecurityTest。
 */
@SpringBootTest
@ActiveProfiles("test")
class StandardAdminServiceTest {

    @Autowired
    private StandardAdminService service;

    private static String code() {
        return "std-" + UUID.randomUUID().toString().substring(0, 8);
    }

    private static CreateStandardRequest.ElementContract element(String elementCode, String type,
                                                                  String... valueCodes) {
        return new CreateStandardRequest.ElementContract(
                elementCode, elementCode + "名称", type, true, elementCode + "定义", "NORMAL",
                "doris-dataos.default.ods_ep.t_" + elementCode,
                valueCodes.length == 0 ? List.of()
                        : List.of(new CreateStandardRequest.ValueContract(valueCodes[0], valueCodes[0] + "显示", "", ""),
                                  new CreateStandardRequest.ValueContract(valueCodes[1], valueCodes[1] + "显示", "", "")));
    }

    private static CreateStandardRequest request(String code) {
        return new CreateStandardRequest(code, code + "标准", "描述", "data-team",
                List.of(element("el_" + code, "CODE", "M", "F"),
                        new CreateStandardRequest.ElementContract(
                                "el_amount", "金额", "DECIMAL", true, "金额定义", "SENSITIVE", "", List.of())));
    }

    private static String versionIdOf(Map<String, Object> detail) {
        return (String) ((Map<?, ?>) detail.get("version")).get("id");
    }

    private static String standardIdOf(Map<String, Object> detail) {
        return (String) ((Map<?, ?>) detail.get("standard")).get("id");
    }

    /** create → submit → publish，返回版本 id。 */
    private String createAndPublish(String code) {
        var detail = service.create(null, request(code), "tester");
        var versionId = versionIdOf(detail);
        service.submit(null, versionId, "tester");
        service.publish(null, versionId, "tester");
        return versionId;
    }

    @Test
    void lifecycleDraftToPublishedWithSupersede() {
        var code = code();
        var created = service.create(null, request(code), "tester");
        var v1 = versionIdOf(created);
        assertThat(((Map<?, ?>) created.get("version")).get("status")).isEqualTo("DRAFT");

        var submitted = service.submit(null, v1, "tester");
        assertThat(((Map<?, ?>) submitted.get("version")).get("status")).isEqualTo("IN_REVIEW");

        // 测试环境未配置 OM：发布成功但术语投影挂起（SYNC_PENDING 事件留痕，不伪造成功）
        var published = service.publish(null, v1, "tester");
        assertThat(((Map<?, ?>) published.get("version")).get("status")).isEqualTo("PUBLISHED");
        assertThat(((Map<?, ?>) published.get("version")).get("syncStatus")).isEqualTo("SYNC_PENDING");
        assertThat(((List<?>) published.get("events")).toString()).contains("SYNC_PENDING");

        // 新版本：默认以已发布版为基准复制元素；发布后旧发布版自动停用（历史事件不删）
        var v2Detail = service.createVersion(null, standardIdOf(published), null, "tester");
        var v2 = versionIdOf(v2Detail);
        assertThat(((Map<?, ?>) v2Detail.get("version")).get("versionNo")).isEqualTo(2);
        assertThat(((List<?>) ((Map<?, ?>) v2Detail.get("version")).get("elements"))).hasSize(2);
        service.submit(null, v2, "tester");
        var v2Published = service.publish(null, v2, "tester");
        var versions = v2Published.get("versions").toString();
        assertThat(versions).contains("DEPRECATED");  // v1 被取代
        assertThat(versions).contains("PUBLISHED");
        assertThat(v2Published.get("events").toString()).contains("取代");
    }

    @Test
    void duplicateCodeAndImmutablePublished() {
        var code = code();
        var detail = service.create(null, request(code), "tester");
        assertThatThrownBy(() -> service.create(null, request(code), "tester"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("标准代码已存在");

        var versionId = versionIdOf(detail);
        service.submit(null, versionId, "tester");
        service.publish(null, versionId, "tester");
        // PUBLISHED 不可覆盖：PUT 拒绝（只能新建版本）
        assertThatThrownBy(() -> service.updateVersion(null, versionId,
                new UpdateStandardVersionRequest("改名", null, null, null), "tester"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("只有 DRAFT");
    }

    @Test
    void skipsLevelPublishIsRejected() {
        var detail = service.create(null, request(code()), "tester");
        var versionId = versionIdOf(detail);
        // 越级发布：DRAFT 直接 publish → 状态机拒绝（须先 IN_REVIEW）
        assertThatThrownBy(() -> service.publish(null, versionId, "tester"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("→ PUBLISHED");
    }

    @Test
    void invalidTypeAndEmptyDomainAndDuplicatesRejected() {
        var badType = new CreateStandardRequest(code(), "n", "d", "o",
                List.of(element("el", "TEXT", "A", "B")));
        assertThatThrownBy(() -> service.create(null, badType, "tester"))
                .isInstanceOf(InvalidRequestException.class)
                .hasMessageContaining("非法类型");

        var emptyDomain = new CreateStandardRequest(code(), "n", "d", "o",
                List.of(element("el", "CODE")));
        assertThatThrownBy(() -> service.create(null, emptyDomain, "tester"))
                .isInstanceOf(InvalidRequestException.class)
                .hasMessageContaining("值域为空");

        var valuesOnNonCode = new CreateStandardRequest(code(), "n", "d", "o",
                List.of(element("el", "STRING", "A", "B")));
        assertThatThrownBy(() -> service.create(null, valuesOnNonCode, "tester"))
                .isInstanceOf(InvalidRequestException.class)
                .hasMessageContaining("非 CODE 类型不携带值域");

        var duplicated = new CreateStandardRequest(code(), "n", "d", "o",
                List.of(element("el", "CODE", "A", "B"), element("el", "CODE", "C", "D")));
        assertThatThrownBy(() -> service.create(null, duplicated, "tester"))
                .isInstanceOf(InvalidRequestException.class)
                .hasMessageContaining("code 重复");
    }

    @Test
    void unknownStandardReadsAsNotFound() {
        // 不存在的 id 与他租户 id 同观（ResourceNotFound，不泄漏存在性）
        assertThatThrownBy(() -> service.detail(null, "no-such-id", null))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void compareAndImpactAndFhir() {
        var code = code();
        var created = service.create(null, request(code), "tester");
        var v1 = versionIdOf(created);
        service.submit(null, v1, "tester");
        service.publish(null, v1, "tester");

        // v2：改类型/敏感级别 + 新增元素
        var v2Detail = service.createVersion(null, standardIdOf(created), null, "tester");
        var v2 = versionIdOf(v2Detail);
        service.updateVersion(null, v2, new UpdateStandardVersionRequest(null, null, null,
                List.of(new CreateStandardRequest.ElementContract(
                                "el_" + code, "改名元素", "STRING", false, "新定义", "CRITICAL",
                                "doris-dataos.default.ods_ep.t_other", List.of()),
                        element("el_new", "CODE", "X", "Y"))), "tester");

        var diff = service.compare(null, v2, v1);
        // left=v2, right=v1：仅 v2 有的 → removed，仅 v1 有的 → added
        assertThat(diff.get("removed").toString()).contains("el_new");
        assertThat(diff.get("added").toString()).contains("el_amount");
        assertThat(diff.get("changed").toString()).contains("类型").contains("敏感级别");

        // 跨标准对比被拒
        var otherCreated = service.create(null, request(code()), "tester");
        var otherV1 = versionIdOf(otherCreated);
        assertThatThrownBy(() -> service.compare(null, v2, otherV1))
                .isInstanceOf(InvalidRequestException.class)
                .hasMessageContaining("同一标准");

        var impact = service.impact(null, v2);
        assertThat(impact.get("referencedAssets").toString()).contains("t_other").contains("t_el_new");
        assertThat(impact.get("elementCount")).isEqualTo(2);

        // FHIR：Bundle 含 CodeSystem/ValueSet；标识只用业务 code，不含内部数据库 id
        var fhir = service.fhirBundle(null, v2);
        assertThat(fhir.get("resourceType")).isEqualTo("Bundle");
        var entries = fhir.get("entry").toString();
        assertThat(entries).contains("CodeSystem").contains("ValueSet");
        assertThat(entries).doesNotContain(v2).doesNotContain(standardIdOf(created));
        assertThat(entries).contains("urn:dataos:standard:" + code + ":el_new");
    }

    @Test
    void importDryRunThenCommitWithCsv() {
        var code = code();
        var csv = """
                standard_code,standard_name,element_code,element_name,data_type,required,definition,sensitivity,value_code,value_display
                %s,挂号渠道标准,channel,挂号渠道,CODE,true,渠道枚举,NORMAL,OPD,门诊
                %s,挂号渠道标准,channel,挂号渠道,CODE,true,渠道枚举,NORMAL,ER,急诊
                %s,挂号渠道标准,fee,挂号费,DECIMAL,false,费用,NORMAL,,
                """.formatted(code, code, code);
        var parsed = StandardController.parseCsv(csv);
        assertThat(parsed.code()).isEqualTo(code);
        assertThat(parsed.elements()).hasSize(2);
        assertThat(parsed.elements().get(0).values()).hasSize(2);

        // dry-run：只出报告，不落库
        var dry = service.importStandards(null, parsed, null, true, "tester");
        assertThat(dry.get("dryRun")).isEqualTo(true);
        assertThat(dry.get("elementCount")).isEqualTo(2);
        assertThat(dry.get("valueCount")).isEqualTo(2L);
        assertThat((List<?>) dry.get("problems")).isEmpty();
        assertThat(service.list(null, code, null, 0, 20).get("total")).isEqualTo(0L);

        // 落库
        var committed = service.importStandards(null, parsed, null, false, "tester");
        assertThat(committed.get("created")).isNotNull();
        assertThat(service.list(null, code, null, 0, 20).get("total")).isEqualTo(1L);

        // 重复导入：代码冲突进 problems，不落库
        var again = service.importStandards(null, parsed, null, false, "tester");
        assertThat(again.get("problems").toString()).contains("标准代码已存在");

        // 版本倒退：携带 versionNo < 1 拒绝
        var rollback = service.importStandards(null,
                new CreateStandardRequest(code() + "x", "n", "", "", parsed.elements()), 0, false, "tester");
        assertThat(rollback.get("problems").toString()).contains("版本倒退");
    }

    @Test
    void retrySyncOnlyForPublished() {
        var detail = service.create(null, request(code()), "tester");
        var versionId = versionIdOf(detail);
        assertThatThrownBy(() -> service.retrySync(null, versionId, "tester"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("只有 PUBLISHED");

        service.submit(null, versionId, "tester");
        service.publish(null, versionId, "tester");
        var retried = service.retrySync(null, versionId, "tester");
        // OM 未配置：重试仍挂起（诚实），事件追加
        assertThat(((Map<?, ?>) retried.get("version")).get("syncStatus")).isEqualTo("SYNC_PENDING");
        assertThat(((List<?>) retried.get("events")).size()).isGreaterThanOrEqualTo(4);
    }
}
