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
        AIReadyEnginePort stubEngine = (candidate, recipe) -> AIReadyAssessment.from(java.util.Map.of(
                "product", candidate.name(), "version", candidate.currentVersion(),
                "profile", "medical-rag", "overall", 0.92,
                "assessedAt", "2026-08-27T10:00:00+00:00",
                "gate", java.util.Map.of("certification", "CANDIDATE")));
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
        var wired = new AIDataProductService(repository, tenantScope, provider);

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
}
