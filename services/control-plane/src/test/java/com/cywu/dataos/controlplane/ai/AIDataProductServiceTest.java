package com.cywu.dataos.controlplane.ai;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.util.UUID;

import com.cywu.dataos.controlplane.api.ConflictException;
import com.cywu.dataos.controlplane.api.ResourceNotFoundException;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

@SpringBootTest
@ActiveProfiles("test")
class AIDataProductServiceTest {

    @Autowired
    private AIDataProductService service;

    @Autowired
    private AIDataProductRepository repository;

    @Autowired
    private AICertificationRepository certificationRepository;

    @Autowired
    private AIEvaluationFeedbackRepository feedbackRepository;

    @Autowired
    private com.cywu.dataos.controlplane.security.TenantScope tenantScope;

    @Autowired
    private JdbcTemplate jdbc;

    private CreateAIDataProductRequest request(String name) {
        return new CreateAIDataProductRequest(name, "RAG_CORPUS", "data-team",
                "MEDICAL_RAG", "ods_ep 处方与诊断表（合成口径）");
    }

    @Test
    void createStartsAtDraftWithInitialVersionRegistered() {
        var name = "svc-create-" + UUID.randomUUID();
        var product = service.create(request(name));

        assertThat(product.lifecycle()).isEqualTo(AIDataProductLifecycle.DRAFT);
        assertThat(product.currentVersion()).isEqualTo("v0.1.0");
        var detail = service.detail(product.id());
        assertThat(detail.versions()).hasSize(1);
        assertThat(detail.versions().get(0).versionSn()).isEqualTo("v0.1.0");
        assertThat(detail.versions().get(0).buildStatus()).isEqualTo("REGISTERED");
    }

    @Test
    void duplicateNameWithinTenantIsRejected() {
        var name = "svc-dup-" + UUID.randomUUID();
        service.create(request(name));

        assertThatThrownBy(() -> service.create(request(name)))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("同名");
    }

    @Test
    void versionUniquenessIsEnforcedByConstraint() {
        var product = service.create(request("svc-ver-" + UUID.randomUUID()));

        service.registerVersion(product.id(), "v0.2.0", "recipes/medical-rag-v1.yaml", "abc123");
        assertThatThrownBy(() -> service.registerVersion(product.id(), "v0.2.0", null, null))
                .isInstanceOf(DuplicateKeyException.class);
    }

    @Test
    void buildIsGuardedUntilEngineIsConfigured() {
        var product = service.create(request("svc-build-" + UUID.randomUUID()));

        assertThatThrownBy(() -> service.build(product.id(), null))
                .isInstanceOf(EngineNotConfiguredException.class)
                .hasMessageContaining("G9");
    }

    @Test
    void buildWritesReadinessToCurrentVersionWhenEngineConfigured() {
        var product = service.create(request("svc-build-ok-" + UUID.randomUUID()));
        AIReadyEnginePort stubEngine = new AIReadyEnginePort() {
            @Override
            public AIReadyAssessment build(AIDataProduct candidate, String recipe) {
                return AIReadyAssessment.from(java.util.Map.of(
                        "product", candidate.name(), "version", candidate.currentVersion(),
                        "profile", "medical-rag", "overall", 0.92,
                        "assessedAt", "2026-08-27T10:00:00+00:00",
                        "gate", java.util.Map.of("certification", "CANDIDATE")));
            }

            @Override
            public java.util.Map<String, Object> evaluate(AIDataProduct candidate) {
                return java.util.Map.of("mrr", 0.8, "details", java.util.List.of());
            }
        };
        org.springframework.beans.factory.ObjectProvider<AIReadyEnginePort> provider =
                new org.springframework.beans.factory.ObjectProvider<>() {
                    @Override
                    public AIReadyEnginePort getObject() {
                        return stubEngine;
                    }

                    @Override
                    public AIReadyEnginePort getIfAvailable() {
                        return stubEngine;
                    }
                };
        var wired = new AIDataProductService(repository, certificationRepository, feedbackRepository, tenantScope, provider);

        var assessment = wired.build(product.id(), "recipes/medical-rag-v1.yaml");

        org.junit.jupiter.api.Assertions.assertEquals(0.92, assessment.overall());
        var version = service.detail(product.id()).versions().get(0);
        org.junit.jupiter.api.Assertions.assertEquals("SUCCEEDED", version.buildStatus());
        org.junit.jupiter.api.Assertions.assertTrue(version.readinessJson().contains("CANDIDATE"));
    }

    @Test
    void lifecycleFollowsStateMachineAndRejectsIllegalTransition() {
        var product = service.create(request("svc-life-" + UUID.randomUUID()));

        assertThat(service.transition(product.id(), "CURATED").lifecycle())
                .isEqualTo(AIDataProductLifecycle.CURATED);
        // CURATED 不能直接到 SERVING（跳过评估与认证）
        assertThatThrownBy(() -> service.transition(product.id(), "SERVING"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("非法生命周期流转");
    }

    @Test
    void queriesAreTenantScoped() {
        var mine = service.create(request("svc-tenant-" + UUID.randomUUID()));
        var intruderId = UUID.randomUUID().toString();
        jdbc.update("""
                INSERT INTO data_os.ai_data_product
                    (id, tenant_id, name, product_type, owner, workflow_type, source_desc,
                     current_version, lifecycle, created_at, updated_at)
                VALUES (?, 'other-tenant', 'intruder', 'RAG_CORPUS', 'x', 'MEDICAL_RAG', 'x',
                        'v0.1.0', 'DRAFT', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP)
                """, intruderId);

        // 默认租户视角：只看到自己的产品；他租户资源按不存在处理
        assertThat(service.list(null)).noneMatch(item -> item.id().equals(intruderId));
        assertThat(service.list(null)).anyMatch(item -> item.id().equals(mine.id()));
        assertThatThrownBy(() -> service.detail(intruderId))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    @Test
    void missingProductMapsToNotFound() {
        assertThatThrownBy(() -> service.detail("no-such-id"))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    // ---- G11 认证审批与评测 ----

    private void assessCurrent(AIDataProduct product) {
        AIReadyEnginePort stub = new AIReadyEnginePort() {
            @Override
            public AIReadyAssessment build(AIDataProduct candidate, String recipe) {
                return AIReadyAssessment.from(java.util.Map.of(
                        "product", candidate.name(), "version", candidate.currentVersion(),
                        "profile", "medical-rag", "overall", 0.9,
                        "assessedAt", "2026-08-27T10:00:00+00:00",
                        "gate", java.util.Map.of("certification", "CANDIDATE")));
            }

            @Override
            public java.util.Map<String, Object> evaluate(AIDataProduct candidate) {
                return java.util.Map.of("mrr", 0.8);
            }
        };
        org.springframework.beans.factory.ObjectProvider<AIReadyEnginePort> provider =
                new org.springframework.beans.factory.ObjectProvider<>() {
                    @Override public AIReadyEnginePort getObject() { return stub; }
                    @Override public AIReadyEnginePort getIfAvailable() { return stub; }
                };
        new AIDataProductService(repository, certificationRepository, feedbackRepository, tenantScope, provider)
                .build(product.id(), null);
    }

    @Test
    void certificationRequiresAssessmentAndCandidateGate() {
        var product = service.create(request("cert-no-assess-" + UUID.randomUUID()));
        assertThatThrownBy(() -> service.submitCertification(product.id()))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("尚未评估");
        assessCurrent(product);
        // 已评估但未流转 ASSESSED：状态守卫
        assertThatThrownBy(() -> service.submitCertification(product.id()))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("仅「已评估」");
        service.transition(product.id(), "CURATED");
        service.transition(product.id(), "ASSESSED");
        var request = service.submitCertification(product.id());
        assertThat(request.decision()).isEqualTo("PENDING");
        assertThat(request.certification()).isEqualTo("CANDIDATE");
        assertThatThrownBy(() -> service.submitCertification(product.id()))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("已有待审批");
    }

    @Test
    void directTransitionToCertifiedIsRejected() {
        var product = service.create(request("cert-direct-" + UUID.randomUUID()));
        service.transition(product.id(), "CURATED");
        service.transition(product.id(), "ASSESSED");
        assertThatThrownBy(() -> service.transition(product.id(), "CERTIFIED"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("审批");
    }

    @Test
    void approvalFlowMovesProductToCertified() {
        var product = service.create(request("cert-flow-" + UUID.randomUUID()));
        service.transition(product.id(), "CURATED");
        service.transition(product.id(), "ASSESSED");
        assessCurrent(product);
        var request = service.submitCertification(product.id());
        var decided = service.decideCertification(request.id(), true, "同意认证");
        assertThat(decided.lifecycle()).isEqualTo(AIDataProductLifecycle.CERTIFIED);
        var history = service.certificationHistory(product.id());
        assertThat(history.get(0).decision()).isEqualTo("APPROVED");
        assertThat(history.get(0).decidedBy()).isNotBlank();
    }

    @Test
    void rejectionKeepsAssessedAndRecordsDecision() {
        var product = service.create(request("cert-reject-" + UUID.randomUUID()));
        service.transition(product.id(), "CURATED");
        service.transition(product.id(), "ASSESSED");
        assessCurrent(product);
        var request = service.submitCertification(product.id());
        var decided = service.decideCertification(request.id(), false, "评测证据不足");
        assertThat(decided.lifecycle()).isEqualTo(AIDataProductLifecycle.ASSESSED);
        assertThat(service.certificationHistory(product.id()).get(0).decision()).isEqualTo("REJECTED");
    }

    @Test
    void evaluateWritesMetricsIntoReadinessJson() {
        var product = service.create(request("cert-eval-" + UUID.randomUUID()));
        assessCurrent(product);
        AIReadyEnginePort stub = new AIReadyEnginePort() {
            @Override
            public AIReadyAssessment build(AIDataProduct candidate, String recipe) {
                throw new IllegalStateException("not used");
            }

            @Override
            public java.util.Map<String, Object> evaluate(AIDataProduct candidate) {
                return java.util.Map.of("mrr", 0.75, "details", java.util.List.of("x"));
            }
        };
        org.springframework.beans.factory.ObjectProvider<AIReadyEnginePort> provider =
                new org.springframework.beans.factory.ObjectProvider<>() {
                    @Override public AIReadyEnginePort getObject() { return stub; }
                    @Override public AIReadyEnginePort getIfAvailable() { return stub; }
                };
        var report = new AIDataProductService(repository, certificationRepository, feedbackRepository, tenantScope, provider)
                .evaluate(product.id());
        assertThat(report).containsEntry("mrr", 0.75);
        var readiness = service.detail(product.id()).versions().get(0).readinessJson();
        assertThat(readiness).contains("evaluation").contains("0.75").doesNotContain("details");
    }

    // ---- G12 飞轮与发布守卫 ----

    @Test
    void feedbackLifecycleCreatedToConsumedOrDismissed() {
        var product = service.create(request("fb-life-" + UUID.randomUUID()));
        var feedback = service.submitFeedback(product.id(), "高血压阈值检索失败", "faithfulness",
                "0", "CHUNK_QUALITY", "golden 句未在 top1 片段");
        assertThat(feedback.status()).isEqualTo("CREATED");
        // CREATED 才可处置；二次处置被拒
        var consumed = service.resolveFeedback(feedback.id(), true, "v0.2.0 chunk 参数调整吸收");
        assertThat(consumed.status()).isEqualTo("CONSUMED");
        assertThat(consumed.resolvedBy()).isNotBlank();
        assertThatThrownBy(() -> service.resolveFeedback(feedback.id(), false, "再处置"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("已处置");
    }

    @Test
    void feedbackTypeIsValidated() {
        var product = service.create(request("fb-type-" + UUID.randomUUID()));
        assertThatThrownBy(() -> service.submitFeedback(product.id(), "q", "mrr", "0", "NOT_A_TYPE", null))
                .isInstanceOf(com.cywu.dataos.controlplane.api.InvalidRequestException.class);
    }

    @Test
    void servingRequiresApprovedCertification() {
        var product = service.create(request("srv-guard-" + UUID.randomUUID()));
        // 推到 CERTIFIED（走完整审批链）
        service.transition(product.id(), "CURATED");
        service.transition(product.id(), "ASSESSED");
        assessCurrent(product);
        var request = service.submitCertification(product.id());
        var certified = service.decideCertification(request.id(), true, "同意");
        assertThat(certified.lifecycle()).isEqualTo(AIDataProductLifecycle.CERTIFIED);
        // 有 APPROVED -> SERVING 成功
        assertThat(service.transition(product.id(), "SERVING").lifecycle())
                .isEqualTo(AIDataProductLifecycle.SERVING);
    }

    @Test
    void servingRejectedWithoutApprovedRecord() {
        // 另一产品直接把 DB 状态推到 CERTIFIED（绕过审批模拟脏数据），SERVING 仍须审批记录
        var product = service.create(request("srv-none-" + UUID.randomUUID()));
        service.transition(product.id(), "CURATED");
        service.transition(product.id(), "ASSESSED");
        new AIDataProductRepository(jdbc).updateLifecycle(product.id(), product.tenantId(),
                AIDataProductLifecycle.CERTIFIED, java.time.Instant.now());
        assertThatThrownBy(() -> service.transition(product.id(), "SERVING"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("已批准的认证记录");
    }

    @Test
    void overviewAggregatesFromTables() {
        var before = service.overview();
        var product = service.create(request("ov-" + UUID.randomUUID()));
        var after = service.overview();
        assertThat(after.get("products")).isEqualTo(((Number) before.get("products")).intValue() + 1);
        assertThat(after).containsKeys("certified", "averageOverall", "latestMrr", "openFeedback");
    }
}
