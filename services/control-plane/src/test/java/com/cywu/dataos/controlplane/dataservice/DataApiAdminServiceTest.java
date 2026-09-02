package com.cywu.dataos.controlplane.dataservice;

import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThat;
import com.cywu.dataos.controlplane.api.ConflictException;
import com.cywu.dataos.controlplane.api.InvalidRequestException;

import static org.assertj.core.api.Assertions.assertThatThrownBy;

@SpringBootTest
@ActiveProfiles("test")
class DataApiAdminServiceTest {

    @Autowired
    private DataApiAdminService service;

    private CreateDataServiceRequest request(String code, String sqlTemplate,
                                              List<CreateDataServiceRequest.ParameterContract> parameters) {
        return new CreateDataServiceRequest(
                code, "电子处方日汇总", "按日期区间汇总处方量",
                sqlTemplate,
                parameters,
                List.of(new CreateDataServiceRequest.ColumnContract("stat_date", "date", "统计日期"),
                        new CreateDataServiceRequest.ColumnContract("prescriptions", "number", "处方量")),
                500, 30, "data-team");
    }

    private List<CreateDataServiceRequest.ParameterContract> dateParams() {
        return List.of(
                new CreateDataServiceRequest.ParameterContract("start_date", "date", true, "开始日期", null, null),
                new CreateDataServiceRequest.ParameterContract("end_date", "date", true, "结束日期", null, null));
    }

    private String cleanTemplate() {
        return """
                SELECT DATE(cf_date) AS stat_date, COUNT(*) AS prescriptions
                FROM ods_ep.ep_mz_cfzb
                WHERE cf_date BETWEEN :start_date AND :end_date
                GROUP BY DATE(cf_date)
                """;
    }

    @Test
    void createStartsAtDraftAndPublishFlipsStatus() {
        var code = "svc-" + UUID.randomUUID().toString().substring(0, 8);
        var definition = service.create(null, request(code, cleanTemplate(), dateParams()));
        assertThat(definition.status()).isEqualTo(DataApiLifecycle.DRAFT);

        var published = service.publish(definition.id(), null);
        assertThat(published.status()).isEqualTo(DataApiLifecycle.PUBLISHED);

        var deprecated = service.deprecate(definition.id(), null);
        assertThat(deprecated.status()).isEqualTo(DataApiLifecycle.DEPRECATED);

        // DEPRECATED 不可复活
        assertThatThrownBy(() -> service.publish(definition.id(), null))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    void templateRejectionBlocksCreation() {
        var code = "bad-" + UUID.randomUUID().toString().substring(0, 8);
        assertThatThrownBy(() -> service.create(null, request(code,
                "DELETE FROM ods_ep.ep_mz_cfzb", List.of())))
                .isInstanceOf(InvalidRequestException.class);
    }

    @Test
    void duplicateCodeRejected() {
        var code = "dup-" + UUID.randomUUID().toString().substring(0, 8);
        service.create(null, request(code, cleanTemplate(), dateParams()));
        assertThatThrownBy(() -> service.create(null, request(code, cleanTemplate(), dateParams())))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    void issuedKeyShowsPlaintextOnceAndRegistryCarriesHashOnly() {
        var code = "key-" + UUID.randomUUID().toString().substring(0, 8);
        var definition = service.create(null, request(code, cleanTemplate(), dateParams()));
        service.publish(definition.id(), null);

        var issued = service.issueKey(definition.id(), null, "科研合作方A", List.of("H001"), 100);
        assertThat(issued.apiKey()).startsWith("dataos_sk_");
        assertThat(issued.dailyQuota()).isEqualTo(100);

        var registry = service.registry();
        assertThat(registry.get("services").toString()).contains(code);
        // registry 只携带 hash，绝不回显明文；用量窗口为当日
        var keyEntries = ((List<?>) registry.get("keys")).stream()
                .map(Object::toString).filter(entry -> entry.contains("callerName=" + "科研合作方A")).toList();
        assertThat(keyEntries).hasSize(1);
        assertThat(keyEntries.get(0)).contains(DataApiAdminService.sha256Hex(issued.apiKey()));
        assertThat(keyEntries.get(0)).doesNotContain(issued.apiKey());
        assertThat(keyEntries.get(0)).contains("usedToday=0");
    }

    @Test
    void revokedKeyDisappearsFromRegistry() {
        var code = "rev-" + UUID.randomUUID().toString().substring(0, 8);
        var definition = service.create(null, request(code, cleanTemplate(), dateParams()));
        service.publish(definition.id(), null);
        var issued = service.issueKey(definition.id(), null, "短期调用方", List.of("*"), 10);

        service.revokeKey(definition.id(), issued.keyId(), null);
        var registry = service.registry();
        assertThat(registry.get("keys").toString()).doesNotContain(DataApiAdminService.sha256Hex(issued.apiKey()));
    }

    @Test
    void recordCallIsIdempotentAndFeedsUsageAndAudit() {
        var code = "call-" + UUID.randomUUID().toString().substring(0, 8);
        var definition = service.create(null, request(code, cleanTemplate(), dateParams()));
        service.publish(definition.id(), null);
        var issued = service.issueKey(definition.id(), null, "审计验证方", List.of("*"), 10);
        var keyHash = DataApiAdminService.sha256Hex(issued.apiKey());

        var idempotencyKey = "idem-" + UUID.randomUUID();
        assertThat(service.recordCall(code, keyHash, "{\"start_date\":\"2026-08-01\"}",
                12, false, 45, 200, idempotencyKey)).isTrue();
        // 同 idempotency_key 重复回写被忽略
        assertThat(service.recordCall(code, keyHash, "{\"start_date\":\"2026-08-01\"}",
                12, false, 45, 200, idempotencyKey)).isFalse();

        var registry = service.registry();
        assertThat(registry.get("keys").toString()).contains("usedToday=1");

        var calls = service.calls(definition.id(), null, 10);
        assertThat(calls).hasSize(1);
        assertThat(calls.get(0)).containsEntry("rowCount", 12);
        assertThat(calls.get(0)).containsEntry("statusCode", 200);

        var overview = service.overview(null);
        assertThat(overview).containsEntry("callsToday", 1L);
    }

    @Test
    void unknownCodeCallReportIsRejected() {
        assertThat(service.recordCall("no-such-code", "hash", null, 0, false, 1, 200, "idem"))
                .isFalse();
    }
}
