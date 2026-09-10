package com.cywu.dataos.controlplane.dataservice;

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
import com.cywu.dataos.controlplane.api.ResourceNotFoundException;

/**
 * 合同通知面（P8 余项）：事件产出（PUBLISHED/UPDATED/DEPRECATED + diff +
 * 版本自增）、订阅自助生命周期与归属、轮询与画像。
 */
@SpringBootTest
@ActiveProfiles("test")
class DataServiceContractNotificationTest {

    @Autowired
    private DataApiAdminService service;

    @Autowired
    private ContractNotificationRepository contracts;

    private record Setup(DataServiceDefinition definition, DataApiAdminService.IssuedKey key) {
    }

    private Setup publishedService() {
        var code = "ct-" + UUID.randomUUID().toString().substring(0, 8);
        var request = new CreateDataServiceRequest(
                code, "合同验证服务", "P8 余项测试",
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
        var key = service.issueKey(definition.id(), null, "合同订阅方", List.of("*"), 100);
        return new Setup(definition, key);
    }

    @Test
    void publishUpdateDeprecateProduceContractEventsWithFanOut() {
        var setup = publishedService();
        var issued = service.createSubscription(
                DataApiAdminService.sha256Hex(setup.key().apiKey()),
                "http://127.0.0.1:9/notify", null);
        assertThat(issued.webhookSecret()).startsWith("dataos_cw_").hasSize("dataos_cw_".length() + 32);

        // PUBLISHED 事件已 fan-out 到订阅
        var events = service.contractEventsOfService(setup.definition().id(), null, 10);
        assertThat(events).anyMatch(item -> "PUBLISHED".equals(item.get("changeType")));

        // PUBLISHED 态更新：maxRows 变化 → v1→v2 + UPDATED 事件带 diff
        var updated = service.update(setup.definition().id(), null, new UpdateDataServiceRequest(
                null, null, null, null, null, 800, null));
        assertThat(updated.versionSn()).isEqualTo("v2");
        events = service.contractEventsOfService(setup.definition().id(), null, 10);
        var updatedEvent = events.stream()
                .filter(item -> "UPDATED".equals(item.get("changeType"))).findFirst().orElseThrow();
        assertThat(updatedEvent.get("fromVersion")).isEqualTo("v1");
        assertThat(updatedEvent.get("toVersion")).isEqualTo("v2");
        assertThat(String.valueOf(updatedEvent.get("diff"))).contains("maxRows").contains("500").contains("800");

        // 无实际变更：幂等，不产事件不升版
        var before = service.contractEventsOfService(setup.definition().id(), null, 100).size();
        var unchanged = service.update(setup.definition().id(), null, new UpdateDataServiceRequest(
                null, null, null, null, null, 800, null));
        assertThat(unchanged.versionSn()).isEqualTo("v2");
        assertThat(service.contractEventsOfService(setup.definition().id(), null, 100)).hasSize(before);

        // 下线：DEPRECATED 事件
        service.deprecate(setup.definition().id(), null);
        assertThat(service.contractEventsOfService(setup.definition().id(), null, 10))
                .anyMatch(item -> "DEPRECATED".equals(item.get("changeType")));

        // 轮询通道（按 Key）能看到全部事件
        var polled = service.contractEventsByKeyHash(DataApiAdminService.sha256Hex(setup.key().apiKey()), 100);
        assertThat(polled).extracting(item -> item.get("changeType"))
                .contains("UPDATED", "PUBLISHED", "DEPRECATED");
    }

    @Test
    void updateGuards() {
        var setup = publishedService();
        // DEPRECATED 后拒改（合同封存）
        service.deprecate(setup.definition().id(), null);
        assertThatThrownBy(() -> service.update(setup.definition().id(), null,
                new UpdateDataServiceRequest("新名字", null, null, null, null, null, null)))
                .isInstanceOf(ConflictException.class);
        // 模板变更重校验：DELETE 模板被拒
        var setup2 = publishedService();
        assertThatThrownBy(() -> service.update(setup2.definition().id(), null,
                new UpdateDataServiceRequest(null, null, "DELETE FROM ods_ep.ep_mz_cfzb", null, null, null, null)))
                .isInstanceOf(InvalidRequestException.class);
        // DRAFT 态：自由修改、不产事件
        var code = "draft-" + UUID.randomUUID().toString().substring(0, 8);
        var draft = service.create(null, new CreateDataServiceRequest(
                code, "草稿", "测试", "SELECT 1 AS x FROM ods_ep.ep_mz_cfzb WHERE cf_date BETWEEN :start_date AND :end_date",
                List.of(new CreateDataServiceRequest.ParameterContract("start_date", "date", true, "开始", null, null),
                        new CreateDataServiceRequest.ParameterContract("end_date", "date", true, "结束", null, null)),
                List.of(), 100, 30, "data-team"));
        var draftUpdated = service.update(draft.id(), null, new UpdateDataServiceRequest("改名", null, null, null, null, null, null));
        assertThat(draftUpdated.name()).isEqualTo("改名");
        assertThat(draftUpdated.versionSn()).isEqualTo("v1");
        assertThat(service.contractEventsOfService(draft.id(), null, 10)).isEmpty();
    }

    @Test
    void subscriptionLifecycleAndOwnership() {
        var setup = publishedService();
        var keyHash = DataApiAdminService.sha256Hex(setup.key().apiKey());
        var issued = service.createSubscription(keyHash, "http://127.0.0.1:9/hook", null);
        assertThat(service.subscriptionsByKeyHash(keyHash)).hasSize(1);

        // TEST 事件走正常 fan-out（事件表可见，交付待投递引擎）
        var testResult = service.testSubscription(issued.subscriptionId(), keyHash);
        assertThat(testResult).containsKey("eventId");

        // 归属校验：他人 Key 吊销 → 与不存在同观
        var stranger = "6" + "f".repeat(63);
        assertThatThrownBy(() -> service.revokeSubscription(issued.subscriptionId(), stranger))
                .isInstanceOf(ResourceNotFoundException.class);
        service.revokeSubscription(issued.subscriptionId(), keyHash);
        assertThat(service.subscriptionsByKeyHash(keyHash).get(0).get("status")).isEqualTo("REVOKED");

        // 短 secret 被拒；坏 URL 被拒（策略默认仅 HTTPS）
        assertThatThrownBy(() -> service.createSubscription(keyHash, "http://127.0.0.1:9/hook", "short"))
                .isInstanceOf(InvalidRequestException.class);
        assertThatThrownBy(() -> service.createSubscription(keyHash, "ftp://x.example/hook", null))
                .isInstanceOf(InvalidRequestException.class);
    }

    @Test
    void keyProfileAndCalls() {
        var setup = publishedService();
        var keyHash = DataApiAdminService.sha256Hex(setup.key().apiKey());
        var profile = service.keyProfile(keyHash);
        assertThat(profile).containsEntry("callerName", "合同订阅方")
                .containsEntry("version", "v1")
                .containsEntry("dailyQuota", 100);

        service.recordCall(setup.definition().code(), keyHash, "{}", 7, false, 12, 200,
                "idem-" + UUID.randomUUID(), "query");
        var calls = service.keyCalls(keyHash, 10);
        assertThat(calls).hasSize(1);
        assertThat(calls.get(0)).containsEntry("rowCount", 7);
    }
}
