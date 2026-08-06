package com.cywu.dataos.controlplane.credential;

import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;

import com.fasterxml.jackson.core.JsonProcessingException;
import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.cywu.dataos.controlplane.api.ResourceNotFoundException;
import com.cywu.dataos.controlplane.security.TenantScope;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class CredentialService implements CredentialResolver {

    private static final TypeReference<Map<String, Object>> SECRET_TYPE = new TypeReference<>() {
    };
    private static final int MAX_SECRET_JSON_BYTES = 16 * 1024;
    private static final int MAX_METADATA_JSON_BYTES = 8 * 1024;

    private final CredentialRepository repository;
    private final CredentialCipher cipher;
    private final ObjectMapper objectMapper;
    private final TenantScope tenantScope;

    public CredentialService(CredentialRepository repository, CredentialCipher cipher, ObjectMapper objectMapper,
                             TenantScope tenantScope) {
        this.repository = repository;
        this.cipher = cipher;
        this.objectMapper = objectMapper;
        this.tenantScope = tenantScope;
    }

    public List<CredentialSummary> list() {
        var scope = tenantScope.current();
        return repository.findAll(scope.tenantId(), scope.institutionId()).stream().map(this::summary).toList();
    }

    @Transactional
    public CredentialSummary create(CreateCredentialRequest request) {
        var scope = tenantScope.current();
        if (request.secret().isEmpty()) {
            throw new com.cywu.dataos.controlplane.api.InvalidRequestException("secret 不能为空");
        }
        var now = Instant.now();
        var credential = new CredentialRepository.Credential(UUID.randomUUID().toString(), scope.tenantId(),
                scope.institutionId(), request.name().trim(), request.provider().trim().toUpperCase(),
                write(request.metadata(), "凭据元数据", MAX_METADATA_JSON_BYTES),
                cipher.encrypt(write(request.secret(), "凭据内容", MAX_SECRET_JSON_BYTES)), "ACTIVE", scope.subject(), now, now);
        repository.save(credential);
        return summary(credential);
    }

    @Transactional
    public void delete(String id) {
        var scope = tenantScope.current();
        if (repository.delete(id, scope.tenantId(), scope.institutionId()) != 1) {
            throw new ResourceNotFoundException("未找到凭据引用：" + id);
        }
    }

    @Override
    public Map<String, Object> resolve(String reference, String tenantId, String institutionId) {
        if (reference == null || reference.isBlank()) {
            throw new IllegalArgumentException("credentialRef 不能为空");
        }
        var credential = repository.findById(reference.trim(), tenantId, institutionId)
                .orElseThrow(() -> new IllegalArgumentException("凭据引用不存在或不属于当前机构"));
        if (!"ACTIVE".equals(credential.status())) throw new IllegalArgumentException("凭据已停用");
        try {
            return objectMapper.readValue(cipher.decrypt(credential.secretCiphertext()), SECRET_TYPE);
        } catch (JsonProcessingException exception) {
            throw new IllegalStateException("凭据内容无法解析", exception);
        }
    }

    private CredentialSummary summary(CredentialRepository.Credential credential) {
        return new CredentialSummary(credential.id(), credential.name(), credential.provider(), credential.status(),
                credential.createdBy(), credential.createdAt(), credential.updatedAt());
    }

    private String write(Map<String, Object> value, String label, int maxBytes) {
        try {
            var serialized = objectMapper.writeValueAsString(value == null ? Map.of() : value);
            if (serialized.getBytes(java.nio.charset.StandardCharsets.UTF_8).length > maxBytes) {
                throw new com.cywu.dataos.controlplane.api.InvalidRequestException(label + "不能超过 " + maxBytes + " 字节");
            }
            return serialized;
        } catch (JsonProcessingException exception) {
            throw new IllegalArgumentException("凭据内容无法序列化", exception);
        }
    }

    public record CredentialSummary(String id, String name, String provider, String status, String createdBy,
                                    Instant createdAt, Instant updatedAt) {
    }

    public record CreateCredentialRequest(String name, String provider, Map<String, Object> secret,
                                          Map<String, Object> metadata) {
        public CreateCredentialRequest {
            secret = secret == null ? Map.of() : Map.copyOf(secret);
            metadata = metadata == null ? Map.of() : Map.copyOf(metadata);
        }
    }
}
