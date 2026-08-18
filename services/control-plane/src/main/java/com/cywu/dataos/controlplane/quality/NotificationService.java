package com.cywu.dataos.controlplane.quality;

import com.cywu.dataos.controlplane.api.ErrorMessages;

import java.time.Duration;
import java.time.Instant;
import java.util.List;
import java.util.UUID;

import com.cywu.dataos.controlplane.governance.GovernanceIssue;
import com.cywu.dataos.controlplane.governance.GovernanceIssueEvent;
import com.cywu.dataos.controlplane.governance.GovernanceNotification;
import com.cywu.dataos.controlplane.governance.GovernanceRepository;
import com.cywu.dataos.controlplane.api.ConflictException;
import com.cywu.dataos.controlplane.api.InvalidRequestException;
import com.cywu.dataos.controlplane.api.ResourceNotFoundException;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.scheduling.annotation.Scheduled;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class NotificationService {

    private final GovernanceRepository repository;
    private final List<NotificationChannel> channels;
    private final long maxAttempts;
    private final long leaseMs;
    private final String workerId = "notification-worker-" + UUID.randomUUID();

    public NotificationService(GovernanceRepository repository,
                               List<NotificationChannel> channels,
                               @Value("${data-os.notification.max-attempts:5}") long maxAttempts,
                               @Value("${data-os.notification.lease-ms:120000}") long leaseMs) {
        this.repository = repository;
        this.channels = channels;
        this.maxAttempts = Math.max(1, maxAttempts);
        this.leaseMs = Math.max(5_000, leaseMs);
    }

    public GovernanceNotification enqueue(GovernanceIssue issue, GovernanceIssueEvent event,
                                          String subject, String body) {
        var key = issue.id() + ":" + event.eventType() + ":" + event.id();
        return enqueue(issue, event, subject, body, key);
    }

    private GovernanceNotification enqueue(GovernanceIssue issue, GovernanceIssueEvent event,
                                           String subject, String body, String idempotencyKey) {
        return repository.enqueueNotification(issue.id(), event.id(), "WEBHOOK", issue.tenantId(), issue.institutionId(),
                issue.ownerName(), issue.ownerId(),
                subject, body, idempotencyKey, Instant.now());
    }

    public DeliverySummary deliverPending() {
        var processed = 0;
        var sent = 0;
        var skipped = 0;
        var failed = 0;
        var now = Instant.now();
        for (var notification : repository.claimPendingNotifications(now, now.plusMillis(leaseMs), workerId)) {
            processed++;
            var result = deliverOne(notification);
            switch (result) {
                case "SENT" -> sent++;
                case "SKIPPED" -> skipped++;
                default -> failed++;
            }
        }
        return new DeliverySummary(processed, sent, skipped, failed);
    }

    @Scheduled(
            fixedDelayString = "${data-os.notification.delivery-interval-ms:30000}",
            initialDelayString = "${data-os.notification.delivery-initial-delay-ms:10000}")
    public void scheduledDelivery() {
        deliverPending();
    }

    private String deliverOne(GovernanceNotification notification) {
        var channel = channels.stream().filter(item -> item.supports(notification.channel())).findFirst().orElse(null);
        if (channel == null) {
            repository.markNotificationSkipped(notification.id(), workerId,
                    "暂不支持通知通道：" + notification.channel(), Instant.now());
            return "SKIPPED";
        }
        NotificationDeliveryResult result;
        try {
            result = channel.send(notification);
        } catch (RuntimeException exception) {
            result = new NotificationDeliveryResult("FAILED", ErrorMessages.safe(exception));
        }
        var now = Instant.now();
        if ("SENT".equals(result.status())) {
            repository.markNotificationSent(notification.id(), workerId, now);
            return "SENT";
        }
        if ("SKIPPED".equals(result.status())) {
            repository.markNotificationSkipped(notification.id(), workerId, result.message(), now);
            return "SKIPPED";
        }
        if (notification.attemptCount() + 1 >= maxAttempts) {
            repository.markNotificationSkipped(notification.id(), workerId,
                    "已达到最大重试次数：" + result.message(), now);
            return "SKIPPED";
        }
        var backoffSeconds = Math.min(3600, 30L * (1L << Math.min(6, notification.attemptCount())));
        repository.markNotificationFailed(notification.id(), workerId, result.message(),
                now.plus(Duration.ofSeconds(backoffSeconds)), now);
        return "FAILED";
    }

    public GovernanceNotification remind(String issueId, String tenantId, String institutionId) {
        return remind(issueId, tenantId, institutionId, null);
    }

    @Transactional
    public GovernanceNotification remind(String issueId, String tenantId, String institutionId,
                                         String requestIdempotencyKey) {
        var issue = repository.findIssue(issueId, tenantId, institutionId)
                .orElseThrow(() -> new ResourceNotFoundException("未找到治理问题：" + issueId));
        if ("CLOSED".equals(issue.status())) {
            throw new ConflictException("已关闭的治理问题不需要提醒责任人");
        }
        var normalizedKey = requestIdempotencyKey == null ? "" : requestIdempotencyKey.trim();
        if (normalizedKey.length() > 96) {
            throw new InvalidRequestException("Idempotency-Key 不能超过 96 个字符");
        }
        var notificationKey = normalizedKey.isBlank() ? null
                : issue.id() + ":RESPONSIBLE_REMINDER:" + normalizedKey;
        if (notificationKey != null) {
            var existing = repository.findNotificationByIdempotencyKey(notificationKey);
            if (existing.isPresent()) return existing.get();
        }
        var now = Instant.now();
        var eventId = UUID.randomUUID().toString();
        var event = new GovernanceIssueEvent(eventId, issue.id(), "RESPONSIBLE_REMINDER_REQUESTED",
                "已向责任人发起提醒", "当前治理负责人", now);
        var notification = enqueue(issue, event, "治理问题责任人提醒",
                "问题「" + issue.title() + "」仍待处理，请责任人及时跟进。",
                notificationKey == null ? issue.id() + ":" + event.eventType() + ":" + event.id() : notificationKey);
        // 抢到幂等键的事务才有资格写事件；并发请求拿到已有通知时不重复生成事件。
        if (eventId.equals(notification.eventId())) {
            repository.insertEvent(issue.id(), event.eventType(), event.note(), event.actor(), now);
        }
        return notification;
    }

    public record DeliverySummary(int processed, int sent, int skipped, int failed) {
    }
}
