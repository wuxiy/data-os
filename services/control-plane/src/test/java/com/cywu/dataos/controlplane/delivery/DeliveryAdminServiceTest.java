package com.cywu.dataos.controlplane.delivery;

import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.zip.ZipInputStream;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

import com.cywu.dataos.controlplane.ai.AICertificationRepository;
import com.cywu.dataos.controlplane.ai.AICertificationRequest;
import com.cywu.dataos.controlplane.ai.AIDataProduct;
import com.cywu.dataos.controlplane.ai.AIDataProductLifecycle;
import com.cywu.dataos.controlplane.ai.AIDataProductRepository;
import com.cywu.dataos.controlplane.ai.AIDataProductType;
import com.cywu.dataos.controlplane.ai.AIDataProductVersion;
import com.cywu.dataos.controlplane.analytics.SupersetGuestTokenService;
import com.cywu.dataos.controlplane.api.ConflictException;
import com.cywu.dataos.controlplane.api.InvalidRequestException;
import com.cywu.dataos.controlplane.dataservice.ContractNotificationRepository;
import com.cywu.dataos.controlplane.dataservice.DataApiLifecycle;
import com.cywu.dataos.controlplane.dataservice.DataServiceContractEvent;
import com.cywu.dataos.controlplane.dataservice.DataServiceDefinition;
import com.cywu.dataos.controlplane.dataservice.DataServiceRepository;
import com.cywu.dataos.controlplane.executor.AdapterUnavailableException;
import com.cywu.dataos.controlplane.lineage.LineageAssetService;
import com.cywu.dataos.controlplane.quality.QualityAssetTestsService;
import com.cywu.dataos.controlplane.quality.QualityRunRepository;
import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * 交付中心业务规则（G25）：生命周期与逐项阻断、快照/状态动作幂等（同键一份）、
 * 证据包白名单（无 SQL 模板/连接串/幂等键/患者标识形态）、验收钉住快照、
 * 证据源不可用 503 诚实失败。OM/Superset/质量读模型以 MockBean 承载。
 */
@SpringBootTest
@ActiveProfiles("test")
class DeliveryAdminServiceTest {

    private static final ObjectMapper JSON = new ObjectMapper();
    private static final String TENANT = "default";

    @Autowired
    private DeliveryAdminService service;

    @Autowired
    private DeliveryRepository repository;

    @Autowired
    private DataServiceRepository dataServices;

    @Autowired
    private ContractNotificationRepository contractEvents;

    @Autowired
    private AIDataProductRepository aiProducts;

    @Autowired
    private AICertificationRepository certifications;

    @MockBean
    private LineageAssetService lineage;

    @MockBean
    private SupersetGuestTokenService superset;

    @MockBean
    private QualityAssetTestsService qualityTests;

    // ---- 夹具 ----

    private String createProject(String code) {
        var created = service.create(TENANT, new CreateDeliveryRequest(code, code + "项目",
                "门诊处方数据交付", "张三", LocalDate.of(2026, 9, 30), null), "tester");
        return (String) ((Map<?, ?>) created.get("project")).get("id");
    }

    /** PUBLISHED 数据服务（带一条合同事件）。sqlTemplate 故意含敏感形态供白名单断言。 */
    private String publishedDataService(String code) {
        var definition = dataServices.save(new DataServiceDefinition(
                UUID.randomUUID().toString(), TENANT, code, code + "服务", "desc", "v2",
                DataApiLifecycle.PUBLISHED,
                "SELECT mr.id_card FROM ods.ep_mz_cfzb mr WHERE mr.record_id = :record_id",
                "[]", "[]", 100, 30, "team", Instant.now(), Instant.now()));
        contractEvents.recordEventAndFanOut(new DataServiceContractEvent(
                UUID.randomUUID().toString(), definition.id(), TENANT, code,
                "PUBLISHED", "v1", "v2", "{\"columns\":[]}", Instant.now()));
        return definition.id();
    }

    /** SERVING AI 产品（当前版本 + 已批准认证）。 */
    private String servingAiProduct(String name) {
        var productId = UUID.randomUUID().toString();
        aiProducts.save(new AIDataProduct(productId, TENANT, name, AIDataProductType.RAG_CORPUS,
                "team", "DATA_JUICER", "来源", "v1", AIDataProductLifecycle.SERVING,
                Instant.now(), Instant.now()));
        aiProducts.saveVersion(new AIDataProductVersion(UUID.randomUUID().toString(), productId,
                "v1", "recipe.yaml", "abc123", LocalDate.of(2026, 9, 1),
                "{\"overall\":0.8654,\"gate\":{\"certification\":\"CANDIDATE\"}}",
                "SUCCEEDED", Instant.now()));
        certifications.save(new AICertificationRequest(UUID.randomUUID().toString(), productId,
                "v1", 0.8654, "CANDIDATE", "APPROVED", "", "tester", "admin",
                Instant.now(), Instant.now()));
        return productId;
    }

    private void addDataItem(String projectId, String refId) {
        service.addItem(TENANT, projectId, new AddDeliveryItemRequest("DATA_SERVICE", refId, "处方服务"), "tester");
    }

    private String startedProjectWithDeliverableItem(String code) {
        var projectId = createProject(code);
        addDataItem(projectId, publishedDataService("svc-" + code));
        service.start(TENANT, projectId, "key-start-" + code, "tester");
        return projectId;
    }

    private static String status(Map<String, Object> detail) {
        return String.valueOf(((Map<?, ?>) detail.get("project")).get("status"));
    }

    // ---- 生命周期主链 ----

    @Test
    void lifecycleHappyPathWithEvents() {
        var projectId = startedProjectWithDeliverableItem("dl-happy");
        var snapshot = service.snapshot(TENANT, projectId, "key-snap-happy", "tester");
        assertThat(snapshot.get("replayed")).isEqualTo(false);

        var submitted = service.submit(TENANT, projectId, "key-submit-happy", "tester");
        assertThat(status(submitted)).isEqualTo("READY_FOR_ACCEPTANCE");

        var accepted = service.accept(TENANT, projectId, "key-accept-happy", "admin");
        assertThat(status(accepted)).isEqualTo("ACCEPTED");
        assertThat(((Map<?, ?>) accepted.get("project")).get("acceptedSnapshotId"))
                .isEqualTo(snapshot.get("snapshotId"));

        var archived = service.archive(TENANT, projectId, "key-archive-happy", "admin");
        assertThat(status(archived)).isEqualTo("ARCHIVED");

        var eventTypes = ((List<?>) accepted.get("events")).stream()
                .map(event -> String.valueOf(((Map<?, ?>) event).get("eventType"))).toList();
        assertThat(eventTypes).contains("CREATED", "ITEM_ADDED", "STARTED", "SNAPSHOT_CREATED",
                "SUBMITTED", "ACCEPTED");
    }

    @Test
    void codeMustBeWellFormedAndUnique() {
        assertThatThrownBy(() -> service.create(TENANT, new CreateDeliveryRequest(
                "bad code!", "x", "", "", null, null), "tester"))
                .isInstanceOf(InvalidRequestException.class);
        service.create(TENANT, new CreateDeliveryRequest("dl-dup", "a", "", "", null, null), "tester");
        assertThatThrownBy(() -> service.create(TENANT, new CreateDeliveryRequest("dl-dup", "b",
                "", "", null, null), "tester"))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    void emptyProjectCannotStartSnapshotOrSubmit() {
        var projectId = createProject("dl-empty");
        assertThatThrownBy(() -> service.start(TENANT, projectId, "k1", "tester"))
                .isInstanceOf(InvalidRequestException.class)
                .hasMessageContaining("交付项为空");
        addDataItem(projectId, publishedDataService("svc-empty"));
        service.start(TENANT, projectId, "k2", "tester");
        // 提交前先走一遍（快照在 READY 前后都允许）
        service.submit(TENANT, projectId, "k3", "tester");
        assertThatThrownBy(() -> service.start(TENANT, projectId, "k4", "tester"))
                .isInstanceOf(ConflictException.class);
    }

    @Test
    void updateAndItemsOnlyBeforeReady() {
        var projectId = startedProjectWithDeliverableItem("dl-edit");
        service.update(TENANT, projectId, new UpdateDeliveryRequest("改名", "范围", "李四",
                LocalDate.of(2026, 10, 15)), "tester");
        service.snapshot(TENANT, projectId, "key-edit-snap", "tester");
        service.submit(TENANT, projectId, "key-edit-submit", "tester");
        assertThatThrownBy(() -> service.update(TENANT, projectId, new UpdateDeliveryRequest(
                "再改", "", "", null), "tester"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("READY_FOR_ACCEPTANCE");
        assertThatThrownBy(() -> service.addItem(TENANT, projectId, new AddDeliveryItemRequest(
                "DATA_SERVICE", publishedDataService("svc-late"), ""), "tester"))
                .isInstanceOf(ConflictException.class);
    }

    // ---- 幂等 ----

    @Test
    void idempotencyKeyIsRequiredOnSnapshotAndStateActions() {
        var projectId = createProject("dl-key");
        addDataItem(projectId, publishedDataService("svc-key"));
        List<Runnable> actions = List.of(
                () -> service.start(TENANT, projectId, null, "t"),
                () -> service.snapshot(TENANT, projectId, "", "t"),
                () -> service.submit(TENANT, projectId, null, "t"),
                () -> service.accept(TENANT, projectId, null, "t"),
                () -> service.archive(TENANT, projectId, null, "t"));
        for (Runnable action : actions) {
            assertThatThrownBy(action::run).isInstanceOf(InvalidRequestException.class)
                    .hasMessageContaining("Idempotency-Key");
        }
    }

    @Test
    void sameSnapshotKeyGeneratesOnlyOneSnapshot() {
        var projectId = startedProjectWithDeliverableItem("dl-snap-idem");
        var first = service.snapshot(TENANT, projectId, "snap-key-1", "tester");
        var replay = service.snapshot(TENANT, projectId, "snap-key-1", "tester");
        assertThat(replay.get("replayed")).isEqualTo(true);
        assertThat(replay.get("snapshotId")).isEqualTo(first.get("snapshotId"));
        assertThat(repository.findSnapshots(TENANT, projectId)).hasSize(1);

        // 跨项目复用同键 → 409
        var other = startedProjectWithDeliverableItem("dl-snap-idem-2");
        assertThatThrownBy(() -> service.snapshot(TENANT, other, "snap-key-1", "tester"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("幂等键已被其他项目使用");
    }

    @Test
    void stateActionReplayIsIdempotentWhileKeyReuseAcrossActionsIsRejected() {
        var projectId = createProject("dl-act-idem");
        addDataItem(projectId, publishedDataService("svc-act-idem"));
        var first = service.start(TENANT, projectId, "act-key-1", "tester");
        assertThat(first.get("replayed")).isEqualTo(false);
        var replay = service.start(TENANT, projectId, "act-key-1", "tester");
        assertThat(replay.get("replayed")).isEqualTo(true);
        // 同键用于其他动作 → 409
        assertThatThrownBy(() -> service.submit(TENANT, projectId, "act-key-1", "tester"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("幂等键已被使用");
        // 快照与事件键空间独立：快照可以用同名键
        service.snapshot(TENANT, projectId, "act-key-1", "tester");
    }

    @Test
    void duplicateAcceptanceIsExplicitlyRejected() {
        var projectId = startedProjectWithDeliverableItem("dl-accept-idem");
        service.snapshot(TENANT, projectId, "acc-snap", "tester");
        service.submit(TENANT, projectId, "acc-submit", "tester");
        service.accept(TENANT, projectId, "acc-accept-1", "admin");
        // 不同键重复验收 → 明确 409（不静默成功）
        assertThatThrownBy(() -> service.accept(TENANT, projectId, "acc-accept-2", "admin"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("不能重复验收");
        // 同键重放 → 幂等成功（replayed=true）
        var replay = service.accept(TENANT, projectId, "acc-accept-1", "admin");
        assertThat(replay.get("replayed")).isEqualTo(true);
    }

    @Test
    void acceptRequiresSnapshot() {
        var projectId = startedProjectWithDeliverableItem("dl-no-snap");
        service.submit(TENANT, projectId, "ns-submit", "tester");
        assertThatThrownBy(() -> service.accept(TENANT, projectId, "ns-accept", "admin"))
                .isInstanceOf(InvalidRequestException.class)
                .hasMessageContaining("没有验收快照");
    }

    // ---- 逐项阻断（G25-2）----

    @Test
    void submitIsBlockedWithExplicitReasonsAndStaysInProgress() {
        var projectId = createProject("dl-block");
        // 引用不存在（本地类型加入时不校验存在——走 service 内部 addItem 的宽松路径不可得，
        // 这里直接以仓储插入不存在的 DATA_SERVICE id）
        repository.insertItem(new DeliveryItem(UUID.randomUUID().toString(), projectId, TENANT,
                DeliveryRefType.DATA_SERVICE, "missing-service-id", "note", "tester", Instant.now()));
        service.start(TENANT, projectId, "blk-start", "tester");

        var blocked = (DeliveryBlockedException) catchSubmit(projectId, "blk-submit");
        var blocker = blocked.blockers().get(0);
        assertThat(blocker.get("refType")).isEqualTo("DATA_SERVICE");
        assertThat((List<?>) blocker.get("reasons")).anyMatch(reason ->
                String.valueOf(reason).contains("引用不存在"));

        // 状态未变；BLOCKED 事件留痕；新键重试可行
        assertThat(status(service.detail(TENANT, projectId))).isEqualTo("IN_PROGRESS");
        var events = ((List<?>) service.detail(TENANT, projectId).get("events")).stream()
                .map(event -> String.valueOf(((Map<?, ?>) event).get("eventType"))).toList();
        assertThat(events).contains("SUBMIT_BLOCKED");
    }

    @Test
    void referenceTakenOfflineBlocksSubmit() {
        var serviceId = publishedDataService("svc-offline");
        var projectId = startedProjectWithDeliverableItem("dl-offline");
        // 同项目追加该服务，随后把它 DEPRECATED（引用下线）
        service.addItem(TENANT, projectId, new AddDeliveryItemRequest("DATA_SERVICE", serviceId, ""), "tester");
        dataServices.updateStatus(serviceId, TENANT, DataApiLifecycle.DEPRECATED, Instant.now());

        var blocked = (DeliveryBlockedException) catchSubmit(projectId, "off-submit");
        var reasons = flattenReasons(blocked);
        assertThat(reasons).anyMatch(reason -> reason.contains("状态不可交付：DEPRECATED"));
        assertThat(status(service.detail(TENANT, projectId))).isEqualTo("IN_PROGRESS");
    }

    @Test
    void emptyContractHistoryIsHonestEvidenceButNotABlocker() {
        // PUBLISHED 但没有合同事件（seed 旁路创建的形态）：不阻断提交——合同证据
        // 的「可读取」指定义行（版本/状态）可读；事件清单在证据包中如实为空。
        var definition = dataServices.save(new DataServiceDefinition(
                UUID.randomUUID().toString(), TENANT, "svc-nocontract", "n", "", "v1",
                DataApiLifecycle.PUBLISHED, "SELECT 1", "[]", "[]", 10, 30, "t",
                Instant.now(), Instant.now()));
        var projectId = createProject("dl-nocontract");
        addDataItem(projectId, definition.id());
        service.start(TENANT, projectId, "nc-start", "tester");
        service.submit(TENANT, projectId, "nc-submit", "tester");
        assertThat(status(service.detail(TENANT, projectId))).isEqualTo("READY_FOR_ACCEPTANCE");
        var snapshot = service.snapshot(TENANT, projectId, "nc-snap", "tester");
        var manifest = repository.findSnapshot(TENANT, String.valueOf(snapshot.get("snapshotId")))
                .map(DeliverySnapshot::manifestJson).orElse("");
        assertThat(manifest).contains("\"contractEvents\" : [ ]");
    }

    @Test
    void aiProductMustBeServingWithApprovedCertification() {
        var productId = servingAiProduct("dl-ai-产品");
        var projectId = createProject("dl-ai");
        service.addItem(TENANT, projectId, new AddDeliveryItemRequest("AI_DATA_PRODUCT", productId, ""), "tester");
        service.start(TENANT, projectId, "ai-start", "tester");
        service.submit(TENANT, projectId, "ai-submit", "tester");
        assertThat(status(service.detail(TENANT, projectId))).isEqualTo("READY_FOR_ACCEPTANCE");

        // 撤下（非 SERVING）→ 新项目提交被阻断
        aiProducts.updateLifecycle(productId, TENANT, AIDataProductLifecycle.DEPRECATED, Instant.now());
        var projectId2 = createProject("dl-ai-2");
        service.addItem(TENANT, projectId2, new AddDeliveryItemRequest("AI_DATA_PRODUCT", productId, ""), "tester");
        service.start(TENANT, projectId2, "ai2-start", "tester");
        var blocked = (DeliveryBlockedException) catchSubmit(projectId2, "ai2-submit");
        assertThat(flattenReasons(blocked)).anyMatch(reason -> reason.contains("状态不可交付：DEPRECATED"));
    }

    @Test
    void aiProductWithoutApprovedCertificationBlocks() {
        var productId = UUID.randomUUID().toString();
        aiProducts.save(new AIDataProduct(productId, TENANT, "无认证产品", AIDataProductType.RAG_CORPUS,
                "t", "DATA_JUICER", "", "v1", AIDataProductLifecycle.SERVING,
                Instant.now(), Instant.now()));
        var projectId = createProject("dl-nocert");
        service.addItem(TENANT, projectId, new AddDeliveryItemRequest("AI_DATA_PRODUCT", productId, ""), "tester");
        service.start(TENANT, projectId, "ncert-start", "tester");
        var blocked = (DeliveryBlockedException) catchSubmit(projectId, "ncert-submit");
        assertThat(flattenReasons(blocked)).anyMatch(reason -> reason.contains("认证证据缺失"));
    }

    // ---- ASSET / DASHBOARD 证据面 ----

    @Test
    void assetQualityEvidenceGatesSubmit() {
        var fqn = "doris-dataos.default.ods_ep.ep_mz_cfzb";
        var detail = new LineageAssetService.AssetDetail("ep_mz_cfzb", fqn, "处方主表",
                "d", List.of(), "2026-09-01T00:00:00Z");
        when(lineage.getAsset(fqn)).thenReturn(detail);

        var projectId = createProject("dl-asset");
        repository.insertItem(new DeliveryItem(UUID.randomUUID().toString(), projectId, TENANT,
                DeliveryRefType.ASSET, fqn, "", "tester", Instant.now()));
        service.start(TENANT, projectId, "as-start", "tester");

        // 规则无终态运行 → 阻断（质量证据缺失）
        when(qualityTests.listTests(fqn)).thenReturn(List.of(new QualityAssetTestsService.QualityTestView(
                "rule-1", "ods_ep.ep_mz_cfzb", "selector", null)));
        var blocked = (DeliveryBlockedException) catchSubmit(projectId, "as-submit-1");
        assertThat(flattenReasons(blocked)).anyMatch(reason -> reason.contains("质量证据缺失"));

        // 最近一次运行未通过 → 阻断（质量未通过）
        when(qualityTests.listTests(fqn)).thenReturn(List.of(new QualityAssetTestsService.QualityTestView(
                "rule-1", "ods_ep.ep_mz_cfzb", "selector",
                new QualityRunRepository.QualityRuleLastRun("FAILED", false, null))));
        blocked = (DeliveryBlockedException) catchSubmit(projectId, "as-submit-2");
        assertThat(flattenReasons(blocked)).anyMatch(reason -> reason.contains("质量未通过"));

        // 通过 → 可交付
        when(qualityTests.listTests(fqn)).thenReturn(List.of(new QualityAssetTestsService.QualityTestView(
                "rule-1", "ods_ep.ep_mz_cfzb", "selector",
                new QualityRunRepository.QualityRuleLastRun("SUCCEEDED", true,
                        java.sql.Timestamp.from(Instant.now())))));
        service.submit(TENANT, projectId, "as-submit-3", "tester");
        assertThat(status(service.detail(TENANT, projectId))).isEqualTo("READY_FOR_ACCEPTANCE");
    }

    @Test
    void assetNotFoundBlocksWhileAdapterDownFailsClosed() {
        var fqn = "doris-dataos.default.ods_ep.missing_table";
        when(lineage.getAsset(fqn)).thenThrow(new IllegalStateException("资产不存在：" + fqn));
        var projectId = createProject("dl-asset-404");
        repository.insertItem(new DeliveryItem(UUID.randomUUID().toString(), projectId, TENANT,
                DeliveryRefType.ASSET, fqn, "", "tester", Instant.now()));
        service.start(TENANT, projectId, "a404-start", "tester");
        var blocked = (DeliveryBlockedException) catchSubmit(projectId, "a404-submit");
        assertThat(flattenReasons(blocked)).anyMatch(reason -> reason.contains("引用不存在"));

        // OM 不可达（503）→ fail-closed，不静默跳过
        when(lineage.getAsset(anyString())).thenThrow(new AdapterUnavailableException("OpenMetadata 暂时不可用"));
        assertThatThrownBy(() -> service.submit(TENANT, projectId, "a404-submit-2", "tester"))
                .isInstanceOf(AdapterUnavailableException.class);
    }

    @Test
    void dashboardRequiresWhitelistAndSupersetReachable() {
        when(superset.listDashboards()).thenReturn(List.of(
                new SupersetGuestTokenService.EmbeddableDashboard("dash-1", "门诊运营总览", "uuid-1")));

        var projectId = createProject("dl-dash");
        service.addItem(TENANT, projectId, new AddDeliveryItemRequest("DASHBOARD", "dash-1", ""), "tester");
        service.start(TENANT, projectId, "db-start", "tester");
        service.submit(TENANT, projectId, "db-submit", "tester");
        assertThat(status(service.detail(TENANT, projectId))).isEqualTo("READY_FOR_ACCEPTANCE");

        // 白名单外 → 阻断；Superset 503 → fail-closed
        var projectId2 = createProject("dl-dash-2");
        service.addItem(TENANT, projectId2, new AddDeliveryItemRequest("DASHBOARD", "dash-404", ""), "tester");
        service.start(TENANT, projectId2, "db2-start", "tester");
        var blocked = (DeliveryBlockedException) catchSubmit(projectId2, "db2-submit");
        assertThat(flattenReasons(blocked)).anyMatch(reason -> reason.contains("引用不存在：仪表盘"));

        when(superset.listDashboards()).thenThrow(new AdapterUnavailableException("Superset 暂时不可用"));
        assertThatThrownBy(() -> service.submit(TENANT, projectId2, "db2-submit-2", "tester"))
                .isInstanceOf(AdapterUnavailableException.class);
    }

    // ---- 证据包白名单（G25-4）----

    @Test
    void evidenceZipContainsOnlyWhitelistedContentAndVerifiableChecksum() throws Exception {
        var projectId = startedProjectWithDeliverableItem("dl-zip");
        var productId = servingAiProduct("dl-zip-ai");
        service.addItem(TENANT, projectId, new AddDeliveryItemRequest("AI_DATA_PRODUCT", productId, ""), "tester");
        when(superset.listDashboards()).thenReturn(List.of(new SupersetGuestTokenService.EmbeddableDashboard(
                "dash-1", "总览", "uuid-1")));
        service.addItem(TENANT, projectId, new AddDeliveryItemRequest("DASHBOARD", "dash-1", ""), "tester");

        var snapshot = service.snapshot(TENANT, projectId, "zip-snap", "tester");
        var pack = service.evidenceZip(TENANT, projectId);

        var entries = new java.util.HashMap<String, byte[]>();
        try (var zip = new ZipInputStream(new java.io.ByteArrayInputStream(pack.zipBytes()))) {
            var entry = zip.getNextEntry();
            while (entry != null) {
                entries.put(entry.getName(), zip.readAllBytes());
                entry = zip.getNextEntry();
            }
        }
        assertThat(entries.keySet()).containsExactlyInAnyOrder("manifest.json", "CHECKSUM.txt");

        var manifest = new String(entries.get("manifest.json"), java.nio.charset.StandardCharsets.UTF_8);
        // 白名单：不含 SQL 模板 / 参数 / 连接串 / 幂等键 / 证件号形态
        assertThat(manifest).doesNotContain("SELECT", "id_card", "sql_template", "sqlTemplate",
                "parametersJson", "jdbc:", "record_id");
        assertThat(manifest).doesNotContainPattern("(?i)password|secret|bearer|token");
        assertThat(manifest).doesNotContainPattern("(?i)idempotency");
        assertThat(manifest).doesNotContainPattern("\\d{15,}");
        // 结构：manifest 版本、逐项证据、事件清单、算法声明
        var root = JSON.readTree(manifest);
        assertThat(root.path("manifestVersion").asInt()).isEqualTo(1);
        assertThat(root.path("checksumAlgorithm").asText()).isEqualTo("SHA-256");
        assertThat(root.path("items").size()).isEqualTo(3);
        assertThat(root.path("events").size()).isGreaterThanOrEqualTo(3);
        // checksum 可复核：sha256(manifest.json) == CHECKSUM.txt == 快照 checksum
        var digest = java.security.MessageDigest.getInstance("SHA-256");
        var computed = java.util.HexFormat.of().formatHex(
                digest.digest(entries.get("manifest.json")));
        var checksumFile = new String(entries.get("CHECKSUM.txt"), java.nio.charset.StandardCharsets.UTF_8).trim();
        assertThat(checksumFile).isEqualTo("sha256 " + snapshot.get("checksum"));
        assertThat(computed).isEqualTo(snapshot.get("checksum"));
        // 逐项证据里的聚合面
        JsonNode dataItem = null;
        for (JsonNode item : root.path("items")) {
            if ("DATA_SERVICE".equals(item.path("refType").asText())) {
                dataItem = item;
            }
        }
        assertThat(dataItem).isNotNull();
        assertThat(dataItem.path("evidence").path("status").asText()).isEqualTo("PUBLISHED");
        assertThat(dataItem.path("evidence").has("contractEvents")).isTrue();
    }

    @Test
    void evidenceWithoutSnapshotCannotDownload() {
        var projectId = createProject("dl-nosnap");
        assertThatThrownBy(() -> service.evidenceZip(TENANT, projectId))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("没有证据快照");
    }

    @Test
    void sanitizerRejectsConnectionStringsAndPatientIdShapes() {
        var projectId = createProject("dl-sanitize");
        addDataItem(projectId, publishedDataService("svc-sanitize"));
        service.start(TENANT, projectId, "sz-start", "tester");
        // 连接串进项目文案 → 快照 fail-closed
        service.update(TENANT, projectId, new UpdateDeliveryRequest("改名",
                "源库 jdbc:mysql://user:pass@10.0.0.1:3306/ods", "李四", null), "tester");
        assertThatThrownBy(() -> service.snapshot(TENANT, projectId, "sz-snap-1", "tester"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("白名单");
        // 证件号形态（18 位连续数字）→ 同样拒绝
        service.update(TENANT, projectId, new UpdateDeliveryRequest("改名",
                "范围说明含 110101199001011234 的样例", "李四", null), "tester");
        assertThatThrownBy(() -> service.snapshot(TENANT, projectId, "sz-snap-2", "tester"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("白名单");
        // 修好文案后可正常生成
        service.update(TENANT, projectId, new UpdateDeliveryRequest("改名", "范围说明已脱敏", "李四", null), "tester");
        assertThat(service.snapshot(TENANT, projectId, "sz-snap-3", "tester").get("replayed"))
                .isEqualTo(false);
    }

    @Test
    void crossTenantAccessIsInvisible() {
        var projectId = startedProjectWithDeliverableItem("dl-tenant");
        assertThatThrownBy(() -> service.detail("other-tenant", projectId))
                .hasMessageContaining("交付项目不存在");
        assertThat(service.list("other-tenant", null, 0, 20).get("total")).isEqualTo(0L);
    }

    // ---- 辅助 ----

    private Throwable catchSubmit(String projectId, String key) {
        try {
            service.submit(TENANT, projectId, key, "tester");
            throw new AssertionError("提交应当被阻断");
        } catch (DeliveryBlockedException expected) {
            return expected;
        }
    }

    private static List<String> flattenReasons(Throwable blocked) {
        var reasons = new java.util.ArrayList<String>();
        for (Map<String, Object> blocker : ((DeliveryBlockedException) blocked).blockers()) {
            ((List<?>) blocker.get("reasons")).forEach(reason -> reasons.add(String.valueOf(reason)));
        }
        return reasons;
    }
}
