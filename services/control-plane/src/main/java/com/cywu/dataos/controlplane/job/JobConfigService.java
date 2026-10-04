package com.cywu.dataos.controlplane.job;

import java.time.Instant;
import java.util.Collection;
import java.util.Map;
import java.util.Optional;

import com.cywu.dataos.controlplane.api.InvalidRequestException;
import com.cywu.dataos.controlplane.api.ResourceNotFoundException;
import com.cywu.dataos.controlplane.security.TenantScope;
import com.cywu.dataos.controlplane.workflow.ClinicalWorkflowCatalog;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class JobConfigService {

    private final JobRepository jobRepository;
    private final JobConfigRepository configRepository;
    private final JobConfigurationPolicy configurationPolicy;
    private final ClinicalWorkflowCatalog workflowCatalog;
    private final StructuredTaskCompiler structuredCompiler;
    private final IngestionCheckpointRepository checkpointRepository;
    private final TenantScope tenantScope;

    public JobConfigService(JobRepository jobRepository, JobConfigRepository configRepository,
                            JobConfigurationPolicy configurationPolicy, ClinicalWorkflowCatalog workflowCatalog,
                            StructuredTaskCompiler structuredCompiler,
                            IngestionCheckpointRepository checkpointRepository,
                            TenantScope tenantScope) {
        this.jobRepository = jobRepository;
        this.configRepository = configRepository;
        this.configurationPolicy = configurationPolicy;
        this.workflowCatalog = workflowCatalog;
        this.structuredCompiler = structuredCompiler;
        this.checkpointRepository = checkpointRepository;
        this.tenantScope = tenantScope;
    }

    public Optional<IngestionJobConfig> findOptional(String jobId) {
        return configRepository.findByJobId(jobId);
    }

    public IngestionJobConfig get(String jobId) {
        requireJob(jobId);
        return configRepository.findByJobId(jobId)
                .orElseThrow(() -> new ResourceNotFoundException("采集任务尚未配置：" + jobId));
    }

    /** 最近一次成功运行的水位（增量序列键的回放起点；尚无成功运行为 null）。 */
    public Instant lastSuccessWatermark(String jobId) {
        requireJob(jobId);
        return checkpointRepository.findLastSuccessWatermark(jobId).orElse(null);
    }

    @Transactional
    public IngestionJobConfig save(String jobId, SaveJobConfigRequest request) {
        var job = requireJob(jobId);
        if (request.structured() != null) {
            return saveStructured(jobId, StructuredTaskSpec.fromMap(request.structured()));
        }
        if (request.config().isEmpty()) {
            throw new InvalidRequestException("config 不能为空");
        }
        validate(request, job);
        return configRepository.save(jobId, request, Instant.now());
    }

    /** 结构化保存路径：意图先对着源目录实校验，编译产物再走与 JSON 相同的守卫。 */
    @Transactional
    public IngestionJobConfig saveStructured(String jobId, StructuredTaskSpec spec) {
        var job = requireJob(jobId);
        var normalized = structuredCompiler.validate(spec);
        var compiled = structuredCompiler.compile(normalized, jobId);
        var request = new SaveJobConfigRequest(StructuredTaskCompiler.TEMPLATE_KEY,
                StructuredTaskCompiler.TEMPLATE_VERSION, compiled, normalized.toMap());
        validate(request, job);
        return configRepository.save(jobId, request, Instant.now());
    }

    private void validate(SaveJobConfigRequest request, IngestionJob job) {
        configurationPolicy.validateTemplateForSave(request.templateKey());
        if (request.templateVersion() == null || request.templateVersion() < 1) {
            throw new InvalidRequestException("templateVersion 必须大于 0");
        }
        var config = request.config();
        if (JobConfigTree.containsSecretKey(config)) {
            throw new InvalidRequestException("任务配置不得保存明文密码或密钥，请改用凭据引用");
        }
        if (isDolphinExecutor(job)) {
            // 平台调度通道：配置即工作流绑定（projectCode/workflowDefinitionCode），
            // 不走 SeaTunnel 的 env/source/sink 形状；模板目录校验同样不适用。
            if (!(config.get("dolphinscheduler") instanceof Map<?, ?>)) {
                throw new InvalidRequestException("平台调度任务的配置必须包含 dolphinscheduler 工作流绑定对象");
            }
            return;
        }
        if (!(config.get("env") instanceof Map<?, ?>)) {
            throw new InvalidRequestException("任务配置必须包含 env 对象");
        }
        requirePlugins(config, "source");
        requirePlugins(config, "sink");
        workflowCatalog.validateConfig(request.templateKey(), request.templateVersion(), config);
    }

    private boolean isDolphinExecutor(IngestionJob job) {
        return "DOLPHINSCHEDULER".equalsIgnoreCase(job.executor())
                || "DOLPHIN_SCHEDULER".equalsIgnoreCase(job.executor());
    }

    private void requirePlugins(Map<String, Object> config, String key) {
        if (!(config.get(key) instanceof Collection<?> plugins) || plugins.isEmpty()) {
            throw new InvalidRequestException("任务配置必须包含非空 " + key + " 插件列表");
        }
    }

    private IngestionJob requireJob(String jobId) {
        var scope = tenantScope.current();
        return jobRepository.findById(jobId, scope.tenantId(), scope.institutionId())
                .orElseThrow(() -> new ResourceNotFoundException("未找到采集作业：" + jobId));
    }
}
