package com.cywu.dataos.controlplane.ai;

import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.cywu.dataos.controlplane.api.ConflictException;
import com.cywu.dataos.controlplane.api.InvalidRequestException;
import com.cywu.dataos.controlplane.api.ResourceNotFoundException;
import com.cywu.dataos.controlplane.security.TenantScope;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * AI Data Product 域服务：创建（semver 起始 v0.1.0）、生命周期流转、
 * 版本登记与 build 守护。词汇与流转规则的唯一来源是
 * {@link AIDataProductType} / {@link AIDataProductLifecycle}。
 */
@Service
public class AIDataProductService {

    static final String INITIAL_VERSION = "v0.1.0";
    static final String BUILD_STATUS_REGISTERED = "REGISTERED";

    private final AIDataProductRepository repository;
    private final TenantScope tenantScope;
    private final ObjectProvider<AIReadyEnginePort> enginePort;

    public AIDataProductService(AIDataProductRepository repository, TenantScope tenantScope,
                                ObjectProvider<AIReadyEnginePort> enginePort) {
        this.repository = repository;
        this.tenantScope = tenantScope;
        this.enginePort = enginePort;
    }

    public List<AIDataProduct> list(String tenantId) {
        var scope = tenantScope.resolve(tenantId, null);
        return repository.findAll(scope.tenantId());
    }

    @Transactional
    public AIDataProduct create(CreateAIDataProductRequest request) {
        var scope = tenantScope.resolve(null, null);
        var name = request.name().trim();
        if (repository.existsByName(scope.tenantId(), name)) {
            throw new ConflictException("同名 AI Data Product 已存在：" + name);
        }
        var now = Instant.now();
        var product = new AIDataProduct(
                UUID.randomUUID().toString(),
                scope.tenantId(),
                name,
                parseType(request.type()),
                request.owner().trim(),
                request.workflow().trim().toUpperCase(),
                request.source().trim(),
                INITIAL_VERSION,
                AIDataProductLifecycle.DRAFT,
                now,
                now);
        repository.save(product);
        // 创建即登记首个版本（v0.1.0，仅登记未构建）——版本历史从创建起可追溯。
        repository.saveVersion(new AIDataProductVersion(
                UUID.randomUUID().toString(), product.id(), INITIAL_VERSION,
                null, null, null, null, BUILD_STATUS_REGISTERED, now));
        return product;
    }

    public AIDataProductDetail detail(String id) {
        var product = require(id);
        return new AIDataProductDetail(product, repository.findVersions(product.id()));
    }

    @Transactional
    public AIDataProduct transition(String id, String target) {
        var product = require(id);
        AIDataProductLifecycle next;
        try {
            next = product.lifecycle().transitionTo(parseLifecycle(target));
        } catch (IllegalArgumentException exception) {
            // 状态机的非法流转对 API 面是业务冲突（409），不是服务器错误。
            throw new ConflictException(exception.getMessage());
        }
        var updated = repository.updateLifecycle(product.id(), product.tenantId(), next, Instant.now());
        if (updated == 0) {
            throw new ConflictException("生命周期流转未生效，请重试");
        }
        return require(id);
    }

    /**
     * build 守护（G8）：引擎未装配时明确失败——不把「登记请求」冒充「构建成功」。
     * G9 引擎装配后经 {@link AIReadyEnginePort} 委托真实构建。
     */
    public String build(String id, String recipeRef) {
        require(id);
        var engine = enginePort.getIfAvailable();
        if (engine == null) {
            throw new EngineNotConfiguredException();
        }
        return engine.build(require(id), recipeRef);
    }

    /** 登记新版本（G9 build 消费；唯一性由 (product_id, version_sn) 约束保证）。 */
    @Transactional
    public AIDataProductVersion registerVersion(String id, String versionSn, String recipeRef, String gitCommit) {
        var product = require(id);
        return repository.saveVersion(new AIDataProductVersion(
                UUID.randomUUID().toString(), product.id(), versionSn.trim(),
                recipeRef, gitCommit, java.time.LocalDate.now(), null,
                BUILD_STATUS_REGISTERED, Instant.now()));
    }

    private AIDataProduct require(String id) {
        var scope = tenantScope.current();
        return repository.findById(id, scope.tenantId())
                .orElseThrow(() -> new ResourceNotFoundException("未找到 AI Data Product：" + id));
    }

    private AIDataProductType parseType(String value) {
        try {
            return AIDataProductType.valueOf(value.trim().toUpperCase());
        } catch (IllegalArgumentException exception) {
            throw new InvalidRequestException("未知的产品类型：" + value);
        }
    }

    private AIDataProductLifecycle parseLifecycle(String value) {
        if (value == null || value.isBlank()) {
            throw new InvalidRequestException("target 不能为空");
        }
        try {
            return AIDataProductLifecycle.valueOf(value.trim().toUpperCase());
        } catch (IllegalArgumentException exception) {
            throw new InvalidRequestException("未知的生命周期状态：" + value);
        }
    }

    /** 详情投影：产品 + 版本历史（按创建时间升序）。 */
    public record AIDataProductDetail(AIDataProduct product, List<AIDataProductVersion> versions) {
    }
}
