package com.cywu.dataos.controlplane.dataservice;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * 合同通知面三表仓储：订阅 CRUD、不可变事件 + fan-out 投递、发件箱
 * 租约生命周期（与 governance_notifications 同款语义）。
 */
@Repository
public class ContractNotificationRepository {

    private final JdbcTemplate jdbc;

    public ContractNotificationRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ---- 订阅 ----

    public DataServiceSubscription saveSubscription(DataServiceSubscription subscription) {
        jdbc.update("""
                INSERT INTO data_os.data_service_subscription
                    (id, service_id, tenant_id, key_id, key_hash, caller_name,
                     webhook_url, webhook_secret, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                subscription.id(), subscription.serviceId(), subscription.tenantId(), subscription.keyId(),
                subscription.keyHash(), subscription.callerName(), subscription.webhookUrl(),
                subscription.webhookSecret(), subscription.status().name(),
                Timestamp.from(subscription.createdAt()));
        return subscription;
    }

    public Optional<DataServiceSubscription> findSubscription(String id) {
        return jdbc.query(subscriptionSelect() + " WHERE id = ?", this::mapSubscription, id)
                .stream().findFirst();
    }

    /** 按 Key 列订阅（自助面归属视图；含已吊销，前端如实展示）。 */
    public List<DataServiceSubscription> findSubscriptionsByKeyHash(String keyHash) {
        return jdbc.query(subscriptionSelect() + " WHERE key_hash = ? ORDER BY created_at DESC",
                this::mapSubscription, keyHash);
    }

    public List<DataServiceSubscription> findSubscriptionsByService(String serviceId) {
        return jdbc.query(subscriptionSelect() + " WHERE service_id = ? ORDER BY created_at DESC",
                this::mapSubscription, serviceId);
    }

    public List<DataServiceSubscription> findActiveSubscriptions(String serviceId) {
        return jdbc.query(
                subscriptionSelect() + " WHERE service_id = ? AND status = 'ACTIVE' ORDER BY created_at",
                this::mapSubscription, serviceId);
    }

    public int revokeSubscription(String id, Instant revokedAt) {
        return jdbc.update("""
                UPDATE data_os.data_service_subscription
                SET status = 'REVOKED', revoked_at = ?
                WHERE id = ? AND status = 'ACTIVE'
                """, Timestamp.from(revokedAt), id);
    }

    // ---- 合同事件 + fan-out ----

    /** 记录不可变事件，并给该服务的全部 ACTIVE 订阅各排一条投递（幂等键 = 事件:订阅）。 */
    public DataServiceContractEvent recordEventAndFanOut(DataServiceContractEvent event) {
        jdbc.update("""
                INSERT INTO data_os.data_service_contract_event
                    (id, service_id, tenant_id, service_code, change_type, from_version, to_version,
                     diff_json, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                event.id(), event.serviceId(), event.tenantId(), event.serviceCode(), event.changeType(),
                event.fromVersion(), event.toVersion(), event.diffJson(), Timestamp.from(event.createdAt()));
        var subscriptions = findActiveSubscriptions(event.serviceId());
        var now = Timestamp.from(event.createdAt());
        for (var subscription : subscriptions) {
            var idempotencyKey = event.id() + ":" + subscription.id();
            var exists = jdbc.queryForObject(
                    "SELECT EXISTS(SELECT 1 FROM data_os.data_service_delivery WHERE idempotency_key = ?)",
                    Boolean.class, idempotencyKey);
            if (Boolean.TRUE.equals(exists)) {
                continue;
            }
            jdbc.update("""
                    INSERT INTO data_os.data_service_delivery
                        (id, event_id, subscription_id, tenant_id, status, attempt_count,
                         idempotency_key, created_at, updated_at)
                    VALUES (?, ?, ?, ?, 'PENDING', 0, ?, ?, ?)
                    """,
                    UUID.randomUUID().toString(), event.id(), subscription.id(), event.tenantId(),
                    idempotencyKey, now, now);
        }
        return event;
    }

    public Optional<DataServiceContractEvent> findEvent(String id) {
        return jdbc.query(eventSelect() + " WHERE id = ?", this::mapEvent, id).stream().findFirst();
    }

    public List<DataServiceContractEvent> findEventsByService(String serviceId, int limit) {
        return jdbc.query(eventSelect() + " WHERE service_id = ? ORDER BY created_at DESC LIMIT ?",
                this::mapEvent, serviceId, limit);
    }

    // ---- 投递发件箱（租约语义）----

    public List<DataServiceDelivery> claimDueDeliveries(Instant now, Instant lockedUntil, String workerId) {
        var candidates = jdbc.query(deliverySelect() + """
                        WHERE ((status IN ('PENDING', 'FAILED') AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
                           OR (status = 'SENDING' AND (locked_until IS NULL OR locked_until <= ?)))
                        ORDER BY created_at LIMIT 100
                        """,
                this::mapDelivery, Timestamp.from(now), Timestamp.from(now));
        var claimed = new java.util.ArrayList<DataServiceDelivery>();
        for (var candidate : candidates) {
            var updated = jdbc.update("""
                    UPDATE data_os.data_service_delivery
                    SET status = 'SENDING', locked_until = ?, locked_by = ?, updated_at = ?
                    WHERE id = ?
                      AND ((status IN ('PENDING', 'FAILED') AND (next_attempt_at IS NULL OR next_attempt_at <= ?))
                       OR (status = 'SENDING' AND (locked_until IS NULL OR locked_until <= ?)))
                    """,
                    Timestamp.from(lockedUntil), workerId, Timestamp.from(now), candidate.id(),
                    Timestamp.from(now), Timestamp.from(now));
            if (updated == 1) {
                findDelivery(candidate.id()).ifPresent(claimed::add);
            }
        }
        return claimed;
    }

    public int markDeliveryDelivered(String id, String workerId, Instant deliveredAt) {
        return jdbc.update("""
                UPDATE data_os.data_service_delivery
                SET status = 'DELIVERED', attempt_count = attempt_count + 1, delivered_at = ?,
                    last_error = NULL, next_attempt_at = NULL, locked_until = NULL, locked_by = NULL,
                    updated_at = ?
                WHERE id = ? AND status = 'SENDING' AND locked_by = ?
                """, Timestamp.from(deliveredAt), Timestamp.from(deliveredAt), id, workerId);
    }

    public int markDeliveryFailed(String id, String workerId, String message, Instant nextAttemptAt, Instant at) {
        return jdbc.update("""
                UPDATE data_os.data_service_delivery
                SET status = 'FAILED', attempt_count = attempt_count + 1, last_error = ?,
                    next_attempt_at = ?, locked_until = NULL, locked_by = NULL, updated_at = ?
                WHERE id = ? AND status = 'SENDING' AND locked_by = ?
                """, safe(message), Timestamp.from(nextAttemptAt), Timestamp.from(at), id, workerId);
    }

    public int markDeliverySkipped(String id, String workerId, String message, Instant at) {
        return jdbc.update("""
                UPDATE data_os.data_service_delivery
                SET status = 'SKIPPED', attempt_count = attempt_count + 1, last_error = ?,
                    next_attempt_at = NULL, locked_until = NULL, locked_by = NULL, updated_at = ?
                WHERE id = ? AND status = 'SENDING' AND locked_by = ?
                """, safe(message), Timestamp.from(at), id, workerId);
    }

    // ---- 投影 ----

    public Optional<DataServiceDelivery> findDelivery(String id) {
        return jdbc.query(deliverySelect() + " WHERE id = ?", this::mapDelivery, id)
                .stream().findFirst();
    }

    public List<DataServiceDelivery> findDeliveriesBySubscription(String subscriptionId, int limit) {
        return jdbc.query(deliverySelect() + " WHERE subscription_id = ? ORDER BY created_at DESC LIMIT ?",
                this::mapDelivery, subscriptionId, limit);
    }

    private String subscriptionSelect() {
        return """
                SELECT id, service_id, tenant_id, key_id, key_hash, caller_name,
                       webhook_url, webhook_secret, status, created_at, revoked_at
                FROM data_os.data_service_subscription
                """;
    }

    private String eventSelect() {
        return """
                SELECT id, service_id, tenant_id, service_code, change_type, from_version, to_version,
                       diff_json, created_at
                FROM data_os.data_service_contract_event
                """;
    }

    private String deliverySelect() {
        return """
                SELECT id, event_id, subscription_id, tenant_id, status, attempt_count, last_error,
                       next_attempt_at, locked_until, locked_by, delivered_at, idempotency_key,
                       created_at, updated_at
                FROM data_os.data_service_delivery
                """;
    }

    private DataServiceSubscription mapSubscription(java.sql.ResultSet rs, int rowNumber) throws java.sql.SQLException {
        var revoked = rs.getTimestamp("revoked_at");
        return new DataServiceSubscription(
                rs.getString("id"), rs.getString("service_id"), rs.getString("tenant_id"),
                rs.getString("key_id"), rs.getString("key_hash"), rs.getString("caller_name"),
                rs.getString("webhook_url"), rs.getString("webhook_secret"),
                DataServiceSubscription.SubscriptionStatus.valueOf(rs.getString("status")),
                rs.getTimestamp("created_at").toInstant(),
                revoked == null ? null : revoked.toInstant());
    }

    private DataServiceContractEvent mapEvent(java.sql.ResultSet rs, int rowNumber) throws java.sql.SQLException {
        return new DataServiceContractEvent(
                rs.getString("id"), rs.getString("service_id"), rs.getString("tenant_id"),
                rs.getString("service_code"), rs.getString("change_type"),
                rs.getString("from_version"), rs.getString("to_version"),
                rs.getString("diff_json"), rs.getTimestamp("created_at").toInstant());
    }

    private DataServiceDelivery mapDelivery(java.sql.ResultSet rs, int rowNumber) throws java.sql.SQLException {
        return new DataServiceDelivery(
                rs.getString("id"), rs.getString("event_id"), rs.getString("subscription_id"),
                rs.getString("tenant_id"), DataServiceDelivery.DeliveryStatus.valueOf(rs.getString("status")),
                rs.getInt("attempt_count"), rs.getString("last_error"),
                instant(rs.getTimestamp("next_attempt_at")), instant(rs.getTimestamp("locked_until")),
                rs.getString("locked_by"), instant(rs.getTimestamp("delivered_at")),
                rs.getString("idempotency_key"),
                rs.getTimestamp("created_at").toInstant(), rs.getTimestamp("updated_at").toInstant());
    }

    private Instant instant(Timestamp value) {
        return value == null ? null : value.toInstant();
    }

    private String safe(String value) {
        if (value == null || value.isBlank()) return null;
        return value.length() > 512 ? value.substring(0, 512) : value;
    }
}
