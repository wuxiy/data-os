package com.cywu.dataos.controlplane.governance;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.dao.DuplicateKeyException;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * 通知发件箱的仓储：入队幂等、租约抢占外发与终态回写。外发通道与重试
 * 策略在 NotificationService，这里只拥有 governance_notifications 表。
 */
@Repository
public class NotificationOutboxRepository {

    private final JdbcTemplate jdbc;

    public NotificationOutboxRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public GovernanceNotification enqueueNotification(String issueId, String eventId, String channel,
                                                       String tenantId, String institutionId, String recipient,
                                                       String recipientId, String subject, String body,
                                                       String idempotencyKey, Instant now) {
        var existing = findNotificationByKey(idempotencyKey);
        if (existing.isPresent()) return existing.get();
        var id = UUID.randomUUID().toString();
        try {
            jdbc.update("""
                    INSERT INTO data_os.governance_notifications
                        (id, issue_id, event_id, tenant_id, institution_id, channel, recipient, recipient_id, subject, body, status,
                         idempotency_key, attempt_count, next_attempt_at, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'PENDING', ?, 0, ?, ?, ?)
                    """, id, issueId, eventId, tenantId, institutionId, channel, recipient, recipientId, subject, body,
                    idempotencyKey, timestamp(now), timestamp(now), timestamp(now));
        } catch (DuplicateKeyException duplicate) {
            return findNotificationByKey(idempotencyKey).orElseThrow(() -> duplicate);
        }
        return findNotificationById(id).orElseThrow(() -> new IllegalStateException("通知记录创建失败"));
    }

    public List<GovernanceNotification> findNotifications(String issueId) {
        return jdbc.query(notificationSelect() + " WHERE issue_id = ? ORDER BY created_at DESC",
                this::mapNotification, issueId);
    }

    public List<GovernanceNotification> claimPendingNotifications(Instant now, Instant lockedUntil, String workerId) {
        var candidates = jdbc.query(notificationSelect()
                        + " WHERE ((status IN ('PENDING', 'FAILED')"
                        + " AND (next_attempt_at IS NULL OR next_attempt_at <= ?))"
                        + " OR (status = 'SENDING' AND (locked_until IS NULL OR locked_until <= ?)))"
                        + " ORDER BY created_at LIMIT 100",
                this::mapNotification, timestamp(now), timestamp(now));
        var claimed = new ArrayList<GovernanceNotification>();
        for (var candidate : candidates) {
            var updated = jdbc.update("""
                    UPDATE data_os.governance_notifications
                    SET status = 'SENDING', locked_until = ?, locked_by = ?, updated_at = ?
                    WHERE id = ?
                      AND ((status IN ('PENDING', 'FAILED')
                           AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
                       OR (status = 'SENDING' AND (locked_until IS NULL OR locked_until <= ?)))
                    """, timestamp(lockedUntil), workerId, timestamp(now), candidate.id(),
                    timestamp(now), timestamp(now));
            if (updated == 1) findNotificationById(candidate.id()).ifPresent(claimed::add);
        }
        return claimed;
    }

    public int markNotificationSent(String id, String workerId, Instant sentAt) {
        return jdbc.update("""
                UPDATE data_os.governance_notifications
                SET status = 'SENT', attempt_count = attempt_count + 1, sent_at = ?,
                    last_error = NULL, next_attempt_at = NULL, locked_until = NULL, locked_by = NULL,
                    updated_at = ?
                WHERE id = ? AND status = 'SENDING' AND locked_by = ?
                """, timestamp(sentAt), timestamp(sentAt), id, workerId);
    }

    public int markNotificationSkipped(String id, String workerId, String message, Instant at) {
        return jdbc.update("""
                UPDATE data_os.governance_notifications
                SET status = 'SKIPPED', attempt_count = attempt_count + 1, last_error = ?,
                    next_attempt_at = NULL, locked_until = NULL, locked_by = NULL, updated_at = ?
                WHERE id = ? AND status = 'SENDING' AND locked_by = ?
                """, safe(message), timestamp(at), id, workerId);
    }

    public int markNotificationFailed(String id, String workerId, String message,
                                       Instant nextAttemptAt, Instant at) {
        return jdbc.update("""
                UPDATE data_os.governance_notifications
                SET status = 'FAILED', attempt_count = attempt_count + 1, last_error = ?,
                    next_attempt_at = ?, locked_until = NULL, locked_by = NULL, updated_at = ?
                WHERE id = ? AND status = 'SENDING' AND locked_by = ?
                """, safe(message), timestamp(nextAttemptAt), timestamp(at), id, workerId);
    }

    public Optional<GovernanceNotification> findNotificationByIdempotencyKey(String key) {
        if (key == null || key.isBlank()) return Optional.empty();
        return findNotificationByKey(key);
    }

    private Optional<GovernanceNotification> findNotificationByKey(String key) {
        return jdbc.query(notificationSelect() + " WHERE idempotency_key = ?",
                this::mapNotification, key).stream().findFirst();
    }

    private Optional<GovernanceNotification> findNotificationById(String id) {
        return jdbc.query(notificationSelect() + " WHERE id = ?", this::mapNotification, id).stream().findFirst();
    }

    private GovernanceNotification mapNotification(java.sql.ResultSet resultSet, int rowNumber)
            throws java.sql.SQLException {
        return new GovernanceNotification(
                resultSet.getString("id"), resultSet.getString("issue_id"), resultSet.getString("event_id"),
                resultSet.getString("tenant_id"), resultSet.getString("institution_id"),
                resultSet.getString("channel"), resultSet.getString("recipient"), resultSet.getString("recipient_id"),
                resultSet.getString("subject"),
                resultSet.getString("body"), resultSet.getString("status"), resultSet.getString("idempotency_key"),
                resultSet.getInt("attempt_count"), resultSet.getString("last_error"),
                instant(resultSet.getTimestamp("next_attempt_at")), instant(resultSet.getTimestamp("locked_until")),
                resultSet.getString("locked_by"), instant(resultSet.getTimestamp("sent_at")),
                instant(resultSet.getTimestamp("created_at")), instant(resultSet.getTimestamp("updated_at")));
    }

    private String notificationSelect() {
        return """
                SELECT id, issue_id, event_id, tenant_id, institution_id, channel, recipient, recipient_id, subject, body, status,
                       idempotency_key, attempt_count, last_error, next_attempt_at, locked_until, locked_by, sent_at,
                       created_at, updated_at
                FROM data_os.governance_notifications
                """;
    }

    private String safe(String value) {
        if (value == null || value.isBlank()) return null;
        return value.length() > 1000 ? value.substring(0, 1000) : value;
    }

    private Instant instant(Timestamp value) {
        return value == null ? null : value.toInstant();
    }

    private Timestamp timestamp(Instant value) {
        return value == null ? null : Timestamp.from(value);
    }
}
