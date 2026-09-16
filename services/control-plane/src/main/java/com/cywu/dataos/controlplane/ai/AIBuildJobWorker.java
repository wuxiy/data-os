package com.cywu.dataos.controlplane.ai;

import java.time.Instant;
import java.util.concurrent.ExecutorService;
import java.util.concurrent.Executors;

import com.cywu.dataos.controlplane.api.ErrorMessages;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.context.event.ApplicationReadyEvent;
import org.springframework.context.event.EventListener;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Component;

import jakarta.annotation.PreDestroy;

/**
 * AI Data 构建任务执行器（G20-1，backlog AI-4）：认领排队任务并执行编排内核。
 *
 * 执行串行（单线程提交池）：Doris 写面安全（reset_before_write 先清表），
 * 也不占用 Spring 调度线程跑长调用；认领 CAS 保证多认领方只有赢家执行。
 * 启动孤儿清算：上一进程遗留的 RUNNING 任务直接判 FAILED（dev 单实例口径，
 * 多实例部署时执行面需租主比对，归生产化批与 P2 编排同窗）。
 */
@Component
public class AIBuildJobWorker {

    private static final Logger log = LoggerFactory.getLogger(AIBuildJobWorker.class);

    private final AIBuildJobRepository jobRepository;
    private final AIDataProductRepository productRepository;
    private final AIDataProductService service;
    private final ExecutorService executor = Executors.newSingleThreadExecutor(runnable -> {
        var thread = new Thread(runnable, "ai-build-worker");
        thread.setDaemon(true);
        return thread;
    });

    public AIBuildJobWorker(AIBuildJobRepository jobRepository,
                            AIDataProductRepository productRepository,
                            AIDataProductService service) {
        this.jobRepository = jobRepository;
        this.productRepository = productRepository;
        this.service = service;
    }

    @Scheduled(fixedDelayString = "${data-os.ai-build.claim-interval-ms:2000}",
               initialDelayString = "${data-os.ai-build.claim-initial-delay-ms:5000}")
    public void claimQueued() {
        var next = jobRepository.peekNextQueuedId();
        if (next.isPresent()) {
            executor.submit(() -> runClaimed(next.get()));
        }
    }

    /** 测试与运维入口：同步执行全部排队任务（逐任务先 CAS 认领）。 */
    public void runPendingNow() {
        while (jobRepository.peekNextQueuedId().isPresent()) {
            runClaimed(jobRepository.peekNextQueuedId().orElseThrow());
        }
    }

    @EventListener(ApplicationReadyEvent.class)
    public void sweepOrphans() {
        for (var job : jobRepository.findRunning()) {
            jobRepository.fail(job.id(), "控制面服务重启中断，请重新发起构建", Instant.now());
            // 版本行解除 RUNNING（readiness 保留上次评估结果，不抹）
            productRepository.updateVersionBuildStatus(job.productId(), job.versionSn(),
                    AIDataProductService.BUILD_STATUS_FAILED);
            log.warn("AI 构建任务孤儿清算：job={} product={} version={}",
                    job.id(), job.productId(), job.versionSn());
        }
    }

    @PreDestroy
    void shutdown() {
        executor.shutdownNow();
    }

    private void runClaimed(String jobId) {
        if (jobRepository.claim(jobId, Instant.now()) == 0) {
            return; // 已被其他认领方执行
        }
        var job = jobRepository.findById(jobId).orElseThrow();
        try {
            var product = productRepository.findById(job.productId(), job.tenantId())
                    .orElseThrow(() -> new IllegalStateException("产品不存在：" + job.productId()));
            if (!product.currentVersion().equals(job.versionSn())) {
                throw new IllegalStateException("排队期间版本指针已推进（任务指向 " + job.versionSn()
                        + "，当前 " + product.currentVersion() + "），请对新版本重新发起构建");
            }
            var outcome = service.executeBuild(product, job.recipeRef());
            jobRepository.succeed(jobId, renderResult(outcome), Instant.now());
        } catch (Exception exception) {
            fail(job, ErrorMessages.safe(exception));
        }
    }

    private void fail(AIBuildJob job, String message) {
        jobRepository.fail(job.id(), message, Instant.now());
        // 版本行解除 RUNNING、标 FAILED；readiness_json 不动（保留上次评估结论）
        productRepository.updateVersionBuildStatus(job.productId(), job.versionSn(),
                AIDataProductService.BUILD_STATUS_FAILED);
        log.warn("AI 构建任务失败：job={} product={} version={} 原因={}",
                job.id(), job.productId(), job.versionSn(), message);
    }

    /** 任务结果（与 G18 同步响应同构：评估摘要 + 可选构建段——门户视图复用）。 */
    private static String renderResult(AIDataProductService.BuildOutcome outcome) {
        var assessment = outcome.assessment();
        var response = new java.util.LinkedHashMap<String, Object>();
        response.put("product", assessment.product());
        response.put("version", assessment.version());
        response.put("profile", assessment.profile());
        response.put("overall", assessment.overall());
        response.put("certification", assessment.certification());
        response.put("assessedAt", assessment.assessedAt());
        if (outcome.build() != null) {
            response.put("build", outcome.build());
        }
        try {
            return new com.fasterxml.jackson.databind.ObjectMapper().writeValueAsString(response);
        } catch (com.fasterxml.jackson.core.JsonProcessingException exception) {
            throw new IllegalStateException("构建结果序列化失败", exception);
        }
    }
}
