package com.cywu.dataos.controlplane.job;

import java.time.Instant;
import java.util.UUID;

import com.cywu.dataos.controlplane.api.ResourceNotFoundException;
import com.cywu.dataos.controlplane.executor.AdapterConfigurationException;
import com.cywu.dataos.controlplane.executor.AdapterUnavailableException;
import com.cywu.dataos.controlplane.executor.ExecutorAdapter;
import org.springframework.stereotype.Service;

@Service
public class RunService {

    private final JobRepository jobRepository;
    private final RunRepository runRepository;
    private final java.util.List<ExecutorAdapter> adapters;

    public RunService(JobRepository jobRepository,
                      RunRepository runRepository,
                      java.util.List<ExecutorAdapter> adapters) {
        this.jobRepository = jobRepository;
        this.runRepository = runRepository;
        this.adapters = adapters;
    }

    public IngestionRun start(String jobId, CreateRunRequest request) {
        var job = jobRepository.findById(jobId)
                .orElseThrow(() -> new ResourceNotFoundException("未找到采集作业：" + jobId));
        var submittedAt = Instant.now();
        var run = new IngestionRun(
                UUID.randomUUID().toString(),
                job.id(),
                "BLOCKED_DEPENDENCY",
                job.executor(),
                null,
                "执行器未配置，运行记录已保存，待执行器可用后重试",
                submittedAt,
                null,
                null);

        var adapter = adapters.stream().filter(item -> item.supports(job.executor())).findFirst().orElse(null);
        if (adapter == null) {
            return runRepository.save(new IngestionRun(run.id(), run.jobId(), "UNSUPPORTED_EXECUTOR", run.executor(),
                    null, "暂不支持执行器：" + job.executor(), submittedAt, null, null));
        }

        try {
            var submission = adapter.submit(job, request.config());
            return runRepository.save(new IngestionRun(run.id(), run.jobId(), "SUBMITTED", run.executor(), submission.externalId(),
                    submission.message(), submittedAt, Instant.now(), null));
        } catch (AdapterConfigurationException exception) {
            return runRepository.save(new IngestionRun(run.id(), run.jobId(), "BLOCKED_CONFIGURATION", run.executor(),
                    null, exception.getMessage(), submittedAt, null, null));
        } catch (AdapterUnavailableException exception) {
            return runRepository.save(new IngestionRun(run.id(), run.jobId(), "BLOCKED_DEPENDENCY", run.executor(),
                    null, exception.getMessage(), submittedAt, null, null));
        } catch (RuntimeException exception) {
            return runRepository.save(new IngestionRun(run.id(), run.jobId(), "SUBMIT_FAILED", run.executor(), null,
                    "执行器提交失败：" + safeMessage(exception), submittedAt, null, Instant.now()));
        }
    }

    public java.util.List<IngestionRun> list(String jobId) {
        if (jobRepository.findById(jobId).isEmpty()) {
            throw new ResourceNotFoundException("未找到采集作业：" + jobId);
        }
        return runRepository.findAll(jobId);
    }

    private String safeMessage(Exception exception) {
        var message = exception.getMessage();
        if (message == null || message.isBlank()) {
            return "未知错误";
        }
        return message.length() > 240 ? message.substring(0, 240) : message;
    }
}
