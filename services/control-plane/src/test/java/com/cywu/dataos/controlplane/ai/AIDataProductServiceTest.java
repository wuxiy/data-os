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
    private AIBuildJobRepository jobRepository;

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

        assertThatThrownBy(() -> service.submitBuild(product.id(), null))
                .isInstanceOf(EngineNotConfiguredException.class)
                .hasMessageContaining("G9");
    }

    /** 换线装配：stub 引擎 + 手工 worker（测试里同步跑队列，生产为 @Scheduled 认领）。 */
    private record Wired(AIDataProductService wired, AIBuildJobWorker worker) {
    }

    private Wired wired(AIReadyEnginePort engine) {
        org.springframework.beans.factory.ObjectProvider<AIReadyEnginePort> provider =
                new org.springframework.beans.factory.ObjectProvider<>() {
                    @Override
                    public AIReadyEnginePort getObject() {
                        return engine;
                    }

                    @Override
                    public AIReadyEnginePort getIfAvailable() {
                        return engine;
                    }
                };
        var svc = new AIDataProductService(repository, certificationRepository, feedbackRepository,
                jobRepository, tenantScope, provider);
        return new Wired(svc, new AIBuildJobWorker(jobRepository, repository, svc));
    }

    private AIReadyEnginePort engineWith(double overall, String certification,
                                         java.util.Map<String, Object> constructResult) {
        return new AIReadyEnginePort() {
            @Override
            public AIReadyAssessment build(AIDataProduct candidate, String recipe) {
                return AIReadyAssessment.from(java.util.Map.of(
                        "product", candidate.name(), "version", candidate.currentVersion(),
                        "profile", "medical-rag", "overall", overall,
                        "assessedAt", "2026-09-16T10:00:00+00:00",
                        "gate", java.util.Map.of("certification", certification)));
            }

            @Override
            public java.util.Map<String, Object> construct(AIDataProduct candidate, String recipeRef) {
                return constructResult;
            }

            @Override
            public java.util.Map<String, Object> evaluate(AIDataProduct candidate, String recipeRef) {
                return java.util.Map.of("mrr", 0.8);
            }
        };
    }

    @Test
    void buildJobRunsConstructAssessAndWritesVersion() {
        var product = service.create(request("svc-build-ok-" + UUID.randomUUID()));
        var wired = wired(engineWith(0.92, "CANDIDATE", java.util.Map.of("chunks", 8)));

        var job = wired.wired().submitBuild(product.id(), "recipes/medical-rag-v1.yaml");
        assertThat(job.status()).isEqualTo("QUEUED");
        assertThat(job.recipeRef()).isEqualTo("recipes/medical-rag-v1.yaml");
        // 排队期间版本行即 RUNNING（互斥信号）
        assertThat(service.detail(product.id()).versions().get(0).buildStatus()).isEqualTo("RUNNING");
        // 活动任务互斥：排队中二次投递 409
        assertThatThrownBy(() -> wired.wired().submitBuild(product.id(), null))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("排队或执行中的构建任务");

        wired.worker().runPendingNow();

        var done = wired.wired().buildJobs(product.id()).get(0);
        assertThat(done.status()).isEqualTo("SUCCEEDED");
        assertThat(done.resultJson()).contains("CANDIDATE").contains("\"chunks\":8");
        var version = service.detail(product.id()).versions().get(0);
        assertThat(version.buildStatus()).isEqualTo("SUCCEEDED");
        assertThat(version.readinessJson()).contains("CANDIDATE");
    }

    @Test
    void buildJobResolvesRecipeRefFromRegisteredVersionWhenRequestBlank() {
        // G18 解析序（异步化后不变）：投递时解析并固化进任务行（请求空 body 时由当前
        // 版本登记的 recipeRef 驱动——门户 build 按钮路径）
        var product = service.create(request("svc-buildref-" + UUID.randomUUID()));
        service.registerAndAdvance(product.id(), "v0.2.0", "ep-prescription-rag-v1", "deadbeef");
        var constructRefs = new java.util.ArrayList<String>();
        var assessRefs = new java.util.ArrayList<String>();
        AIReadyEnginePort recording = new AIReadyEnginePort() {
            @Override
            public AIReadyAssessment build(AIDataProduct candidate, String recipe) {
                assessRefs.add(recipe);
                return AIReadyAssessment.from(java.util.Map.of(
                        "product", candidate.name(), "version", candidate.currentVersion(),
                        "profile", "medical-rag", "overall", 0.9,
                        "assessedAt", "2026-09-16T10:00:00+00:00",
                        "gate", java.util.Map.of("certification", "CANDIDATE")));
            }

            @Override
            public java.util.Map<String, Object> construct(AIDataProduct candidate, String recipeRef) {
                constructRefs.add(recipeRef);
                return java.util.Map.of("chunks", 1967);
            }

            @Override
            public java.util.Map<String, Object> evaluate(AIDataProduct candidate, String recipeRef) {
                throw new IllegalStateException("not used");
            }
        };
        var wired = wired(recording);
        var job = wired.wired().submitBuild(product.id(), null);
        assertThat(job.recipeRef()).isEqualTo("ep-prescription-rag-v1");

        wired.worker().runPendingNow();

        assertThat(constructRefs).containsExactly("ep-prescription-rag-v1");
        assertThat(assessRefs).containsExactly("ep-prescription-rag-v1");
        var version = service.detail(product.id()).versions().stream()
                .filter(item -> item.versionSn().equals("v0.2.0")).findFirst().orElseThrow();
        assertThat(version.buildStatus()).isEqualTo("SUCCEEDED");
    }

    @Test
    void buildJobSkipsConstructionWhenNoRecipeRefAnywhere() {
        // v0.1.0 自动登记无 recipeRef 且请求为空 -> 仅评估（G12 前行为不变）
        var product = service.create(request("svc-buildskip-" + UUID.randomUUID()));
        var constructCalls = new java.util.ArrayList<String>();
        AIReadyEnginePort stub = new AIReadyEnginePort() {
            @Override
            public AIReadyAssessment build(AIDataProduct candidate, String recipe) {
                return AIReadyAssessment.from(java.util.Map.of(
                        "product", candidate.name(), "version", candidate.currentVersion(),
                        "profile", "medical-rag", "overall", 0.88,
                        "assessedAt", "2026-09-16T10:00:00+00:00",
                        "gate", java.util.Map.of("certification", "REVIEW_REQUIRED")));
            }

            @Override
            public java.util.Map<String, Object> construct(AIDataProduct candidate, String recipeRef) {
                constructCalls.add(recipeRef);
                return java.util.Map.of();
            }

            @Override
            public java.util.Map<String, Object> evaluate(AIDataProduct candidate, String recipeRef) {
                throw new IllegalStateException("not used");
            }
        };
        var wired = wired(stub);
        var job = wired.wired().submitBuild(product.id(), null);
        assertThat(job.recipeRef()).isNull();
        wired.worker().runPendingNow();
        assertThat(constructCalls).isEmpty();
        var done = wired.wired().buildJobs(product.id()).get(0);
        assertThat(done.status()).isEqualTo("SUCCEEDED");
        assertThat(done.resultJson()).doesNotContain("\"build\"");
        assertThat(service.detail(product.id()).versions().get(0).readinessJson())
                .contains("REVIEW_REQUIRED");
    }

    @Test
    void buildJobFailureMarksVersionFailedAndKeepsReadiness() {
        var product = service.create(request("svc-build-fail-" + UUID.randomUUID()));
        // 先成功一次，留下评估结论（显式 recipeRef 走 construct 路径）
        var ok = wired(engineWith(0.9, "CANDIDATE", java.util.Map.of("chunks", 8)));
        ok.wired().submitBuild(product.id(), "recipes/medical-rag-v1.yaml");
        ok.worker().runPendingNow();

        // 再投一次：引擎不可达（construct 抛适配器不可用）-> 任务 FAILED、版本 FAILED、
        // readiness 保留上次评估结论（不抹）
        AIReadyEnginePort broken = new AIReadyEnginePort() {
            @Override
            public AIReadyAssessment build(AIDataProduct candidate, String recipe) {
                throw new IllegalStateException("not reached");
            }

            @Override
            public java.util.Map<String, Object> construct(AIDataProduct candidate, String recipeRef) {
                throw new com.cywu.dataos.controlplane.executor.AdapterUnavailableException(
                        "AI Ready 引擎暂时不可用：连接拒绝");
            }

            @Override
            public java.util.Map<String, Object> evaluate(AIDataProduct candidate, String recipeRef) {
                throw new IllegalStateException("not used");
            }
        };
        var wired = wired(broken);
        wired.wired().submitBuild(product.id(), "recipes/medical-rag-v1.yaml");
        wired.worker().runPendingNow();

        var jobs = wired.wired().buildJobs(product.id());
        assertThat(jobs.get(0).status()).isEqualTo("FAILED");
        assertThat(jobs.get(0).error()).contains("引擎暂时不可用");
        var version = service.detail(product.id()).versions().get(0);
        assertThat(version.buildStatus()).isEqualTo("FAILED");
        assertThat(version.readinessJson()).contains("CANDIDATE");
        // 失败后版本不在 RUNNING：可重新投递
        var again = wired.wired().submitBuild(product.id(), null);
        assertThat(again.status()).isEqualTo("QUEUED");
    }

    @Test
    void startupSweepFailsOrphanedRunningJobs() {
        // 模拟上一进程遗留：任务 RUNNING + 版本行 RUNNING
        var product = service.create(request("svc-orphan-" + UUID.randomUUID()));
        var jobId = UUID.randomUUID().toString();
        jobRepository.insert(new AIBuildJob(jobId, product.id(), product.tenantId(),
                product.currentVersion(), null, AIBuildJob.STATUS_RUNNING,
                null, null, "someone", java.time.Instant.now(), java.time.Instant.now(), null));
        jdbc.update("UPDATE data_os.ai_data_product_version SET build_status = 'RUNNING' WHERE product_id = ?",
                product.id());

        var wired = wired(engineWith(0.9, "CANDIDATE", java.util.Map.of()));
        wired.worker().sweepOrphans();

        var job = jobRepository.findById(jobId).orElseThrow();
        assertThat(job.status()).isEqualTo("FAILED");
        assertThat(job.error()).contains("重启");
        assertThat(service.detail(product.id()).versions().get(0).buildStatus()).isEqualTo("FAILED");
        // 清扫后可重新投递（版本已解除 RUNNING）
        assertThat(wired.wired().submitBuild(product.id(), null).status()).isEqualTo("QUEUED");
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
        var wired = wired(engineWith(0.9, "CANDIDATE", java.util.Map.of("chunks", 8)));
        wired.wired().submitBuild(product.id(), null);
        wired.worker().runPendingNow();
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
            public java.util.Map<String, Object> construct(AIDataProduct candidate, String recipeRef) {
                return java.util.Map.of("chunks", 8);
            }

            @Override
            public java.util.Map<String, Object> evaluate(AIDataProduct candidate, String recipeRef) {
                return java.util.Map.of("mrr", 0.75, "details", java.util.List.of("x"));
            }
        };
        org.springframework.beans.factory.ObjectProvider<AIReadyEnginePort> provider =
                new org.springframework.beans.factory.ObjectProvider<>() {
                    @Override public AIReadyEnginePort getObject() { return stub; }
                    @Override public AIReadyEnginePort getIfAvailable() { return stub; }
                };
        var report = new AIDataProductService(repository, certificationRepository, feedbackRepository,
                jobRepository, tenantScope, provider)
                .evaluate(product.id());
        assertThat(report).containsEntry("mrr", 0.75);
        var readiness = service.detail(product.id()).versions().get(0).readinessJson();
        assertThat(readiness).contains("evaluation").contains("0.75").doesNotContain("details");
    }

    @Test
    void evaluatePassesCurrentVersionRecipeRefToEngine() {
        // G17 双产品契约：引擎按当前版本登记的 recipeRef 解析语料表与评测集
        var product = service.create(request("eval-ref-" + UUID.randomUUID()));
        service.registerAndAdvance(product.id(), "v0.2.0", "ep-prescription-rag-v1", "deadbeef");
        var captured = new java.util.ArrayList<String>();
        AIReadyEnginePort stub = new AIReadyEnginePort() {
            @Override
            public AIReadyAssessment build(AIDataProduct candidate, String recipe) {
                throw new IllegalStateException("not used");
            }

            @Override
            public java.util.Map<String, Object> construct(AIDataProduct candidate, String recipeRef) {
                return java.util.Map.of("chunks", 8);
            }

            @Override
            public java.util.Map<String, Object> evaluate(AIDataProduct candidate, String recipeRef) {
                captured.add(recipeRef);
                return java.util.Map.of("mrr", 0.9);
            }
        };
        org.springframework.beans.factory.ObjectProvider<AIReadyEnginePort> provider =
                new org.springframework.beans.factory.ObjectProvider<>() {
                    @Override public AIReadyEnginePort getObject() { return stub; }
                    @Override public AIReadyEnginePort getIfAvailable() { return stub; }
                };
        new AIDataProductService(repository, certificationRepository, feedbackRepository,
                jobRepository, tenantScope, provider)
                .evaluate(product.id());
        assertThat(captured).containsExactly("ep-prescription-rag-v1");
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
    void servingProductRecertifiesNewVersionViaDemotion() {
        // G19 再认证环路：SERVING 中迭代新版本 -> 撤下重评估 -> 既有审批链回上架
        var product = service.create(request("srv-re-" + UUID.randomUUID()));
        service.transition(product.id(), "CURATED");
        service.transition(product.id(), "ASSESSED");
        assessCurrent(product);
        var first = service.submitCertification(product.id());
        service.decideCertification(first.id(), true, "v0.1.0 上架");
        service.transition(product.id(), "SERVING");
        assertThat(service.detail(product.id()).product().lifecycle()).isEqualTo(AIDataProductLifecycle.SERVING);

        // 飞轮迭代：登记 v0.2.0 并评估出新的 CANDIDATE
        service.registerAndAdvance(product.id(), "v0.2.0", "ep-prescription-rag-v1-1", "beef");
        assessCurrent(product);

        // SERVING 中不能直接提交认证（G11 语义不变）——必须先显式撤下
        assertThatThrownBy(() -> service.submitCertification(product.id()))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("已评估");

        var demoted = service.transition(product.id(), "ASSESSED");
        assertThat(demoted.lifecycle()).isEqualTo(AIDataProductLifecycle.ASSESSED);

        var second = service.submitCertification(product.id());
        var reCertified = service.decideCertification(second.id(), true, "v0.2.0 再认证上架");
        assertThat(reCertified.lifecycle()).isEqualTo(AIDataProductLifecycle.CERTIFIED);
        assertThat(service.transition(product.id(), "SERVING").lifecycle())
                .isEqualTo(AIDataProductLifecycle.SERVING);
        // 认证历史完整留痕两代版本
        var history = service.certificationHistory(product.id());
        assertThat(history).hasSize(2);
        assertThat(history.stream().map(AICertificationRequest::versionSn))
                .containsExactly("v0.2.0", "v0.1.0");
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
