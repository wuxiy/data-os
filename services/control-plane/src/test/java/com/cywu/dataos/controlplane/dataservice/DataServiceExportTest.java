package com.cywu.dataos.controlplane.dataservice;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.cywu.dataos.controlplane.api.ConflictException;
import com.cywu.dataos.controlplane.api.InvalidRequestException;

/**
 * 导出任务状态机与生命周期（P7，H3）：创建 → CAS 认领 → 终态 →
 * 到期清理 / 孤儿清算；导出形态审计（kind=export）计入配额窗口。
 */
@SpringBootTest
@ActiveProfiles("test")
class DataServiceExportTest {

    @Autowired
    private DataApiAdminService service;

    private String publishedService() {
        var code = "exp-" + UUID.randomUUID().toString().substring(0, 8);
        var request = new CreateDataServiceRequest(
                code, "导出验证服务", "P7 测试",
                """
                SELECT DATE(cf_date) AS stat_date, COUNT(*) AS prescriptions
                FROM ods_ep.ep_mz_cfzb
                WHERE cf_date BETWEEN :start_date AND :end_date
                GROUP BY DATE(cf_date)
                """,
                List.of(
                        new CreateDataServiceRequest.ParameterContract("start_date", "date", true, "开始日期", null, null),
                        new CreateDataServiceRequest.ParameterContract("end_date", "date", true, "结束日期", null, null)),
                List.of(new CreateDataServiceRequest.ColumnContract("stat_date", "date", "统计日期")),
                500, 30, "data-team");
        var definition = service.create(null, request);
        service.publish(definition.id(), null);
        return definition.id();
    }

    @Test
    void exportLifecycleCreateClaimFinalizeExpire() {
        var serviceId = publishedService();
        var export = service.createExport(serviceCodeOf(serviceId), "hash-" + UUID.randomUUID(), "{\"start_date\":\"2026-08-01\"}");
        assertThat(export.status()).isEqualTo(DataServiceExport.ExportStatus.PENDING);
        assertThat(service.findPendingExports()).anyMatch(item -> item.id().equals(export.id()));

        // CAS 认领：PENDING → RUNNING，二次认领被拒
        assertThat(service.claimExport(export.id())).isTrue();
        assertThat(service.claimExport(export.id())).isFalse();

        // 终态：RUNNING → SUCCEEDED（带产物与到期）
        var expiresAt = Instant.now().plusSeconds(3600);
        assertThat(service.finalizeExport(export.id(), DataServiceExport.ExportStatus.SUCCEEDED,
                12345, 678901L, "s3://dataos-data-api-exports/x.csv", null, expiresAt)).isTrue();
        var succeeded = service.findExport(export.id()).orElseThrow();
        assertThat(succeeded.rowCount()).isEqualTo(12345);
        assertThat(succeeded.fileBytes()).isEqualTo(678901L);
        assertThat(succeeded.artifactUri()).isEqualTo("s3://dataos-data-api-exports/x.csv");
        assertThat(succeeded.expiresAt()).isEqualTo(expiresAt);

        // 管理面列表可见
        assertThat(service.exports(serviceId, null, 10)).hasSize(1);

        // SUCCEEDED → FAILED 违反状态机
        assertThatThrownBy(() -> service.finalizeExport(export.id(), DataServiceExport.ExportStatus.FAILED,
                0, null, null, null, null)).isInstanceOf(ConflictException.class);
    }

    @Test
    void failedAndReapedTransitions() {
        var serviceId = publishedService();
        var export = service.createExport(serviceCodeOf(serviceId), "hash-" + UUID.randomUUID(), null);
        service.claimExport(export.id());
        assertThat(service.finalizeExport(export.id(), DataServiceExport.ExportStatus.FAILED,
                0, null, null, "Doris 超时", null)).isTrue();
        assertThat(service.findExport(export.id()).orElseThrow().error()).isEqualTo("Doris 超时");

        // 孤儿清算：RUNNING 且 updated_at 早于阈值 → FAILED
        var stuck = service.createExport(serviceCodeOf(serviceId), "hash-" + UUID.randomUUID(), null);
        service.claimExport(stuck.id());
        assertThat(service.reapStaleRunning(Instant.now().plusSeconds(1))).isGreaterThanOrEqualTo(1);
        assertThat(service.findExport(stuck.id()).orElseThrow().status())
                .isEqualTo(DataServiceExport.ExportStatus.FAILED);
    }

    @Test
    void expiredSucceededExportsAreMarked() {
        var serviceId = publishedService();
        var export = service.createExport(serviceCodeOf(serviceId), "hash-" + UUID.randomUUID(), null);
        service.claimExport(export.id());
        // 已过期的 expires_at（过去时间）→ 清理立即生效
        service.finalizeExport(export.id(), DataServiceExport.ExportStatus.SUCCEEDED,
                1, 10L, "s3://bucket/x.csv", null, Instant.now().minusSeconds(60));
        assertThat(service.expireExports()).isGreaterThanOrEqualTo(1);
        assertThat(service.findExport(export.id()).orElseThrow().status())
                .isEqualTo(DataServiceExport.ExportStatus.EXPIRED);
    }

    @Test
    void exportCallReportCountsTowardQuotaWithKind() {
        var serviceId = publishedService();
        var code = serviceCodeOf(serviceId);
        var issued = service.issueKey(serviceId, null, "导出调用方", List.of("*"), 10);
        var keyHash = DataApiAdminService.sha256Hex(issued.apiKey());

        assertThat(service.recordCall(code, keyHash, null, 9999, true, 8000, 200,
                "exp-idem-" + UUID.randomUUID(), "export")).isTrue();

        var registry = service.registry();
        assertThat(registry.get("keys").toString()).contains("usedToday=1");

        var calls = service.calls(serviceId, null, 10);
        assertThat(calls.get(0)).containsEntry("rowCount", 9999);
    }

    @Test
    void createExportRejectsUnpublishedCode() {
        assertThatThrownBy(() -> service.createExport("no-such-code", "hash", null))
                .isInstanceOf(InvalidRequestException.class);
    }

    private String serviceCodeOf(String serviceId) {
        // 测试便捷：经 detail 反查 code（定义创建时已生成）
        return service.detail(serviceId, null).service().code();
    }
}
