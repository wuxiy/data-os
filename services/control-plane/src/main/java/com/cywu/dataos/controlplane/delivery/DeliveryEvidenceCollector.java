package com.cywu.dataos.controlplane.delivery;

import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;

import com.cywu.dataos.controlplane.ai.AICertificationRepository;
import com.cywu.dataos.controlplane.ai.AICertificationRequest;
import com.cywu.dataos.controlplane.ai.AIDataProduct;
import com.cywu.dataos.controlplane.ai.AIDataProductRepository;
import com.cywu.dataos.controlplane.ai.AIDataProductVersion;
import com.cywu.dataos.controlplane.ai.ReadinessSnapshot;
import com.cywu.dataos.controlplane.analytics.SupersetGuestTokenService;
import com.cywu.dataos.controlplane.dataservice.ContractNotificationRepository;
import com.cywu.dataos.controlplane.dataservice.DataServiceDefinition;
import com.cywu.dataos.controlplane.dataservice.DataServiceRepository;
import com.cywu.dataos.controlplane.executor.AdapterUnavailableException;
import com.cywu.dataos.controlplane.lineage.LineageAssetService;
import com.cywu.dataos.controlplane.quality.QualityAssetTestsService;
import com.cywu.dataos.controlplane.quality.QualityRunRepository;

/**
 * 交付证据采集器（G25-2/G25-4）：对四类交付项逐项采集「存在性 + 可交付状态 +
 * 质量/认证/合同证据」，只读、不自建状态。提交（READY 前）与快照共用本采集器：
 * 提交把 blockers 作为明确阻断，快照如实记录（含未通过项，供验收方复核）。
 * 证据源不可达（OM/Superset 503）向上抛 AdapterUnavailableException——阻断而非跳过。
 */
@Service
public class DeliveryEvidenceCollector {

    private final DataServiceRepository dataServices;
    private final ContractNotificationRepository contractEvents;
    private final AIDataProductRepository aiProducts;
    private final AICertificationRepository certifications;
    private final QualityAssetTestsService qualityTests;
    private final ObjectProvider<LineageAssetService> lineage;
    private final ObjectProvider<SupersetGuestTokenService> superset;

    public DeliveryEvidenceCollector(DataServiceRepository dataServices,
                                     ContractNotificationRepository contractEvents,
                                     AIDataProductRepository aiProducts,
                                     AICertificationRepository certifications,
                                     QualityAssetTestsService qualityTests,
                                     ObjectProvider<LineageAssetService> lineage,
                                     ObjectProvider<SupersetGuestTokenService> superset) {
        this.dataServices = dataServices;
        this.contractEvents = contractEvents;
        this.aiProducts = aiProducts;
        this.certifications = certifications;
        this.qualityTests = qualityTests;
        this.lineage = lineage;
        this.superset = superset;
    }

    /** 单个交付项的采集结论：blockers 非空即不可交付（提交阻断依据）。 */
    public record ItemEvidence(DeliveryRefType refType, String refId, String displayName,
                               boolean deliverable, List<String> blockers,
                               Map<String, Object> evidence) {

        public Map<String, Object> toMap() {
            var view = new LinkedHashMap<String, Object>();
            view.put("refType", refType.name());
            view.put("refId", refId);
            view.put("displayName", displayName);
            view.put("deliverable", deliverable);
            view.put("blockers", blockers);
            view.put("evidence", evidence);
            return view;
        }
    }

    public ItemEvidence collect(String tenantId, DeliveryItem item) {
        return switch (item.refType()) {
            case DATA_SERVICE -> dataService(tenantId, item);
            case AI_DATA_PRODUCT -> aiProduct(tenantId, item);
            case ASSET -> asset(item);
            case DASHBOARD -> dashboard(item);
        };
    }

    /**
     * 本地类型（数据服务 / AI 产品）加入交付项时的即时存在性检查；
     * 远端类型（ASSET / DASHBOARD）返回 true，存在性在提交时统一核验。
     */
    public boolean existsLocally(String tenantId, DeliveryRefType refType, String refId) {
        return switch (refType) {
            case DATA_SERVICE -> dataServices.findById(refId, tenantId).isPresent();
            case AI_DATA_PRODUCT -> aiProducts.findById(refId, tenantId).isPresent();
            case ASSET, DASHBOARD -> true;
        };
    }

    // ---- DATA_SERVICE：PUBLISHED 才可交付；合同事件为证据 ----

    private ItemEvidence dataService(String tenantId, DeliveryItem item) {
        var blockers = new ArrayList<String>();
        var definition = dataServices.findById(item.refId(), tenantId).orElse(null);
        if (definition == null) {
            blockers.add("引用不存在：数据服务 " + item.refId());
            return blocked(item, blockers);
        }
        if (definition.status() != com.cywu.dataos.controlplane.dataservice.DataApiLifecycle.PUBLISHED) {
            blockers.add("状态不可交付：" + definition.status());
        }
        var events = contractEvents.findEventsByService(definition.id(), 10);
        if (events.isEmpty()) {
            blockers.add("合同证据缺失：无任何合同事件");
        }
        var evidence = new LinkedHashMap<String, Object>();
        evidence.put("code", definition.code());
        evidence.put("name", definition.name());
        evidence.put("status", definition.status().name());
        evidence.put("contractVersion", definition.versionSn());
        evidence.put("contractEvents", events.stream().map(event -> {
            var view = new LinkedHashMap<String, Object>();
            view.put("changeType", event.changeType());
            view.put("fromVersion", event.fromVersion());
            view.put("toVersion", event.toVersion());
            view.put("createdAt", event.createdAt().toString());
            return view;
        }).toList());
        evidence.put("callCount", dataServices.countCallsByService(definition.id()));
        dataServices.findCalls(definition.id(), tenantId, 1).stream().findFirst()
                .ifPresent(call -> evidence.put("lastCalledAt", call.calledAt().toString()));
        return new ItemEvidence(item.refType(), item.refId(), definition.name(),
                blockers.isEmpty(), List.copyOf(blockers), evidence);
    }

    // ---- AI_DATA_PRODUCT：SERVING 才可交付；APPROVED 认证为证据 ----

    private ItemEvidence aiProduct(String tenantId, DeliveryItem item) {
        var blockers = new ArrayList<String>();
        var product = aiProducts.findById(item.refId(), tenantId).orElse(null);
        if (product == null) {
            blockers.add("引用不存在：AI 数据产品 " + item.refId());
            return blocked(item, blockers);
        }
        if (product.lifecycle() != com.cywu.dataos.controlplane.ai.AIDataProductLifecycle.SERVING) {
            blockers.add("状态不可交付：" + product.lifecycle());
        }
        var approved = certifications.findByProduct(product.id()).stream()
                .filter(request -> "APPROVED".equals(request.decision()))
                .reduce((first, second) -> second)  // 最新一条 APPROVED
                .orElse(null);
        if (approved == null) {
            blockers.add("认证证据缺失：无已批准的认证记录");
        }
        var evidence = new LinkedHashMap<String, Object>();
        evidence.put("name", product.name());
        evidence.put("productType", product.productType() == null ? "" : product.productType().name());
        evidence.put("lifecycle", product.lifecycle().name());
        evidence.put("currentVersion", product.currentVersion());
        aiProducts.findVersions(product.id()).stream()
                .filter(version -> version.versionSn().equals(product.currentVersion()))
                .findFirst()
                .ifPresent(version -> {
                    evidence.put("buildStatus", version.buildStatus());
                    if (version.readinessJson() != null && !version.readinessJson().isBlank()) {
                        var snapshot = ReadinessSnapshot.parse(version.readinessJson());
                        evidence.put("readinessOverall", snapshot.overall());
                    }
                });
        if (approved != null) {
            var certification = new LinkedHashMap<String, Object>();
            certification.put("decision", approved.decision());
            certification.put("versionSn", approved.versionSn());
            certification.put("readinessOverall", approved.readinessOverall());
            certification.put("decidedBy", approved.decidedBy());
            certification.put("decidedAt", approved.decidedAt() == null ? "" : approved.decidedAt().toString());
            evidence.put("certification", certification);
        }
        return new ItemEvidence(item.refType(), item.refId(), product.name(),
                blockers.isEmpty(), List.copyOf(blockers), evidence);
    }

    // ---- ASSET：OM 存在性 + 质量结论（全部启用规则须有终态运行且通过）----

    private ItemEvidence asset(DeliveryItem item) {
        var service = lineage.getIfAvailable();
        if (service == null) {
            throw new AdapterUnavailableException(
                    "血缘服务未配置：请在控制面设置 data-os.openmetadata.base-url 后重启");
        }
        var blockers = new ArrayList<String>();
        com.cywu.dataos.controlplane.lineage.LineageAssetService.AssetDetail detail;
        try {
            detail = service.getAsset(item.refId());
        } catch (IllegalStateException exception) {
            // OpenMetadataClient 对 404 的收口（「资产不存在」）；503 类不可用
            // 走 AdapterUnavailableException 正常向上传播。
            blockers.add("引用不存在：" + item.refId());
            return blocked(item, blockers);
        }
        var tests = qualityTests.listTests(item.refId());
        var testViews = new ArrayList<Map<String, Object>>();
        for (QualityAssetTestsService.QualityTestView test : tests) {
            var view = new LinkedHashMap<String, Object>();
            view.put("ruleId", test.ruleId());
            view.put("datasetId", test.datasetId());
            if (test.lastRun() == null) {
                blockers.add("质量证据缺失：规则 " + test.ruleId() + " 没有终态运行");
                view.put("passed", false);
                view.put("status", "NO_TERMINAL_RUN");
            } else {
                view.put("passed", test.lastRun().passed());
                view.put("status", test.lastRun().status());
                view.put("finishedAt", test.lastRun().finishedAt() == null
                        ? "" : test.lastRun().finishedAt().toInstant().toString());
                if (!test.lastRun().passed()) {
                    blockers.add("质量未通过：规则 " + test.ruleId());
                }
            }
            testViews.add(view);
        }
        var evidence = new LinkedHashMap<String, Object>();
        evidence.put("name", detail.name());
        evidence.put("displayName", detail.displayName());
        evidence.put("columnCount", detail.columns().size());
        evidence.put("updatedAt", detail.updatedAt());
        evidence.put("qualityTests", testViews);
        return new ItemEvidence(item.refType(), item.refId(),
                detail.displayName().isBlank() ? detail.name() : detail.displayName(),
                blockers.isEmpty(), List.copyOf(blockers), evidence);
    }

    // ---- DASHBOARD：嵌入白名单 + Superset 可达即存在 ----

    private ItemEvidence dashboard(DeliveryItem item) {
        var service = superset.getIfAvailable();
        if (service == null) {
            throw new AdapterUnavailableException(
                    "分析服务未配置：请在控制面设置 data-os.analytics.superset.base-url 后重启");
        }
        var blockers = new ArrayList<String>();
        var match = service.listDashboards().stream()
                .filter(dashboard -> dashboard.id().equals(item.refId().trim()))
                .findFirst()
                .orElse(null);
        if (match == null) {
            blockers.add("引用不存在：仪表盘 " + item.refId() + " 不在嵌入白名单或 Superset 内");
            return blocked(item, blockers);
        }
        var evidence = new LinkedHashMap<String, Object>();
        evidence.put("title", match.title());
        evidence.put("embedded", match.embeddedUuid() != null && !match.embeddedUuid().isBlank());
        return new ItemEvidence(item.refType(), item.refId(), match.title(),
                true, List.of(), evidence);
    }

    private ItemEvidence blocked(DeliveryItem item, List<String> blockers) {
        return new ItemEvidence(item.refType(), item.refId(), item.refId(),
                false, List.copyOf(blockers), Map.of());
    }
}
