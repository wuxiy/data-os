package com.cywu.dataos.controlplane.job;

import java.time.Instant;
import java.util.Collection;
import java.util.Map;
import java.util.Optional;

import com.cywu.dataos.controlplane.api.InvalidRequestException;
import com.cywu.dataos.controlplane.api.ResourceNotFoundException;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class JobConfigService {

    private final JobRepository jobRepository;
    private final JobConfigRepository configRepository;

    public JobConfigService(JobRepository jobRepository, JobConfigRepository configRepository) {
        this.jobRepository = jobRepository;
        this.configRepository = configRepository;
    }

    public Optional<IngestionJobConfig> findOptional(String jobId) {
        return configRepository.findByJobId(jobId);
    }

    public IngestionJobConfig get(String jobId) {
        requireJob(jobId);
        return configRepository.findByJobId(jobId)
                .orElseThrow(() -> new ResourceNotFoundException("采集任务尚未配置：" + jobId));
    }

    @Transactional
    public IngestionJobConfig save(String jobId, SaveJobConfigRequest request) {
        requireJob(jobId);
        validate(request);
        return configRepository.save(jobId, request, Instant.now());
    }

    private void validate(SaveJobConfigRequest request) {
        if (request.templateVersion() == null || request.templateVersion() < 1) {
            throw new InvalidRequestException("templateVersion 必须大于 0");
        }
        var config = request.config();
        if (!(config.get("env") instanceof Map<?, ?>)) {
            throw new InvalidRequestException("任务配置必须包含 env 对象");
        }
        requirePlugins(config, "source");
        requirePlugins(config, "sink");
        if (containsSecretKey(config)) {
            throw new InvalidRequestException("任务配置不得保存明文密码或密钥，请改用凭据引用");
        }
    }

    private void requirePlugins(Map<String, Object> config, String key) {
        if (!(config.get(key) instanceof Collection<?> plugins) || plugins.isEmpty()) {
            throw new InvalidRequestException("任务配置必须包含非空 " + key + " 插件列表");
        }
    }

    private boolean containsSecretKey(Object value) {
        if (value instanceof Map<?, ?> map) {
            for (var entry : map.entrySet()) {
                var key = String.valueOf(entry.getKey()).toLowerCase(java.util.Locale.ROOT);
                if (key.contains("password") || key.contains("secret") || key.equals("token")) return true;
                if (containsSecretKey(entry.getValue())) return true;
            }
        } else if (value instanceof Collection<?> collection) {
            for (var item : collection) if (containsSecretKey(item)) return true;
        }
        return false;
    }

    private void requireJob(String jobId) {
        if (jobRepository.findById(jobId).isEmpty()) {
            throw new ResourceNotFoundException("未找到采集作业：" + jobId);
        }
    }
}
