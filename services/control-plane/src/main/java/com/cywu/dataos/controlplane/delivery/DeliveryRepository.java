package com.cywu.dataos.controlplane.delivery;

import java.sql.Date;
import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * 交付仓储（G25）：查询一律 tenant 过滤（跨租户 404 同观）；快照与事件的
 * 幂等键租户内唯一（V19 约束），重放判定先查后插。
 */
@Repository
public class DeliveryRepository {

    private final JdbcTemplate jdbc;

    public DeliveryRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ---- 项目 ----

    public boolean existsByCode(String tenantId, String code) {
        var found = jdbc.queryForObject(
                "SELECT COUNT(*) FROM data_os.delivery_project WHERE tenant_id = ? AND code = ?",
                Integer.class, tenantId, code);
        return found != null && found > 0;
    }

    public void insertProject(DeliveryProject project) {
        jdbc.update("""
                INSERT INTO data_os.delivery_project
                    (id, tenant_id, code, name, scope, owner, target_date, status,
                     accepted_snapshot_id, created_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, project.id(), project.tenantId(), project.code(), project.name(),
                project.scope(), project.owner(), date(project.targetDate()),
                project.status().name(), project.acceptedSnapshotId(), project.createdBy(),
                Timestamp.from(project.createdAt()), Timestamp.from(project.updatedAt()));
    }

    public Optional<DeliveryProject> findProject(String tenantId, String id) {
        return jdbc.query("""
                SELECT * FROM data_os.delivery_project WHERE tenant_id = ? AND id = ?
                """, this::mapProject, tenantId, id).stream().findFirst();
    }

    public record ProjectRow(List<DeliveryProject> projects, long total) {
    }

    public ProjectRow findProjects(String tenantId, String query, int page, int size) {
        var like = "%" + (query == null ? "" : query.trim()) + "%";
        var total = jdbc.queryForObject("""
                SELECT COUNT(*) FROM data_os.delivery_project
                WHERE tenant_id = ? AND (code LIKE ? OR name LIKE ? OR owner LIKE ?)
                """, Long.class, tenantId, like, like, like);
        var items = jdbc.query("""
                SELECT * FROM data_os.delivery_project
                WHERE tenant_id = ? AND (code LIKE ? OR name LIKE ? OR owner LIKE ?)
                ORDER BY updated_at DESC LIMIT ? OFFSET ?
                """, this::mapProject, tenantId, like, like, like, size, page * size);
        return new ProjectRow(items, total == null ? 0 : total);
    }

    public int updateProject(String id, String name, String scope, String owner,
                             LocalDate targetDate) {
        return jdbc.update("""
                UPDATE data_os.delivery_project
                SET name = ?, scope = ?, owner = ?, target_date = ?, updated_at = ?
                WHERE id = ?
                """, name, scope, owner, date(targetDate), Timestamp.from(Instant.now()), id);
    }

    /** 状态推进（带期望前状态的条件更新）：返回 0 表示状态已被并发改变。 */
    public int casStatus(String id, DeliveryLifecycle expected, DeliveryLifecycle target) {
        return jdbc.update("""
                UPDATE data_os.delivery_project
                SET status = ?, updated_at = ?
                WHERE id = ? AND status = ?
                """, target.name(), Timestamp.from(Instant.now()), id, expected.name());
    }

    public int pinAcceptedSnapshot(String id, String snapshotId) {
        return jdbc.update("""
                UPDATE data_os.delivery_project
                SET accepted_snapshot_id = ?, updated_at = ?
                WHERE id = ?
                """, snapshotId, Timestamp.from(Instant.now()), id);
    }

    // ---- 交付项 ----

    public void insertItem(DeliveryItem item) {
        jdbc.update("""
                INSERT INTO data_os.delivery_item
                    (id, project_id, tenant_id, ref_type, ref_id, note, created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, item.id(), item.projectId(), item.tenantId(), item.refType().name(),
                item.refId(), item.note(), item.createdBy(), Timestamp.from(item.createdAt()));
    }

    public List<DeliveryItem> findItems(String tenantId, String projectId) {
        return jdbc.query("""
                SELECT * FROM data_os.delivery_item
                WHERE tenant_id = ? AND project_id = ? ORDER BY created_at, id
                """, this::mapItem, tenantId, projectId);
    }

    public Optional<DeliveryItem> findItem(String tenantId, String projectId, String itemId) {
        return jdbc.query("""
                SELECT * FROM data_os.delivery_item
                WHERE tenant_id = ? AND project_id = ? AND id = ?
                """, this::mapItem, tenantId, projectId, itemId).stream().findFirst();
    }

    public boolean itemRefExists(String tenantId, String projectId, DeliveryRefType refType,
                                 String refId) {
        var found = jdbc.queryForObject("""
                SELECT COUNT(*) FROM data_os.delivery_item
                WHERE tenant_id = ? AND project_id = ? AND ref_type = ? AND ref_id = ?
                """, Integer.class, tenantId, projectId, refType.name(), refId);
        return found != null && found > 0;
    }

    public int deleteItem(String tenantId, String projectId, String itemId) {
        return jdbc.update("""
                DELETE FROM data_os.delivery_item
                WHERE tenant_id = ? AND project_id = ? AND id = ?
                """, tenantId, projectId, itemId);
    }

    // ---- 快照 ----

    public void insertSnapshot(DeliverySnapshot snapshot) {
        jdbc.update("""
                INSERT INTO data_os.delivery_snapshot
                    (id, project_id, tenant_id, checksum, manifest_json, idempotency_key,
                     created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, snapshot.id(), snapshot.projectId(), snapshot.tenantId(),
                snapshot.checksum(), snapshot.manifestJson(), snapshot.idempotencyKey(),
                snapshot.createdBy(), Timestamp.from(snapshot.createdAt()));
    }

    public Optional<DeliverySnapshot> findSnapshotByIdempotencyKey(String tenantId, String key) {
        return jdbc.query("""
                SELECT * FROM data_os.delivery_snapshot
                WHERE tenant_id = ? AND idempotency_key = ?
                """, this::mapSnapshot, tenantId, key).stream().findFirst();
    }

    public Optional<DeliverySnapshot> findSnapshot(String tenantId, String snapshotId) {
        return jdbc.query("""
                SELECT * FROM data_os.delivery_snapshot
                WHERE tenant_id = ? AND id = ?
                """, this::mapSnapshot, tenantId, snapshotId).stream().findFirst();
    }

    public List<DeliverySnapshot> findSnapshots(String tenantId, String projectId) {
        return jdbc.query("""
                SELECT * FROM data_os.delivery_snapshot
                WHERE tenant_id = ? AND project_id = ? ORDER BY created_at DESC, id
                """, this::mapSnapshot, tenantId, projectId);
    }

    // ---- 事件 ----

    public void insertEvent(DeliveryEvent event) {
        jdbc.update("""
                INSERT INTO data_os.delivery_event
                    (id, project_id, tenant_id, event_type, actor, idempotency_key,
                     detail, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, event.id(), event.projectId(), event.tenantId(), event.eventType(),
                event.actor(), event.idempotencyKey(), event.detail(),
                Timestamp.from(event.createdAt()));
    }

    public Optional<DeliveryEvent> findEventByIdempotencyKey(String tenantId, String key) {
        return jdbc.query("""
                SELECT * FROM data_os.delivery_event
                WHERE tenant_id = ? AND idempotency_key = ?
                """, this::mapEvent, tenantId, key).stream().findFirst();
    }

    public List<DeliveryEvent> findEvents(String tenantId, String projectId) {
        return jdbc.query("""
                SELECT * FROM data_os.delivery_event
                WHERE tenant_id = ? AND project_id = ? ORDER BY created_at DESC, id DESC
                """, this::mapEvent, tenantId, projectId);
    }

    // ---- 行映射 ----

    private DeliveryProject mapProject(java.sql.ResultSet rs, int row) throws java.sql.SQLException {
        var targetDate = rs.getDate("target_date");
        return new DeliveryProject(
                rs.getString("id"), rs.getString("tenant_id"), rs.getString("code"),
                rs.getString("name"), rs.getString("scope"), rs.getString("owner"),
                targetDate == null ? null : targetDate.toLocalDate(),
                DeliveryLifecycle.valueOf(rs.getString("status")),
                rs.getString("accepted_snapshot_id"), rs.getString("created_by"),
                rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("updated_at").toInstant());
    }

    private DeliveryItem mapItem(java.sql.ResultSet rs, int row) throws java.sql.SQLException {
        return new DeliveryItem(
                rs.getString("id"), rs.getString("project_id"), rs.getString("tenant_id"),
                DeliveryRefType.valueOf(rs.getString("ref_type")), rs.getString("ref_id"),
                rs.getString("note"), rs.getString("created_by"),
                rs.getTimestamp("created_at").toInstant());
    }

    private DeliverySnapshot mapSnapshot(java.sql.ResultSet rs, int row) throws java.sql.SQLException {
        return new DeliverySnapshot(
                rs.getString("id"), rs.getString("project_id"), rs.getString("tenant_id"),
                rs.getString("checksum"), rs.getString("manifest_json"),
                rs.getString("idempotency_key"), rs.getString("created_by"),
                rs.getTimestamp("created_at").toInstant());
    }

    private DeliveryEvent mapEvent(java.sql.ResultSet rs, int row) throws java.sql.SQLException {
        return new DeliveryEvent(
                rs.getString("id"), rs.getString("project_id"), rs.getString("tenant_id"),
                rs.getString("event_type"), rs.getString("actor"),
                rs.getString("idempotency_key"), rs.getString("detail"),
                rs.getTimestamp("created_at").toInstant());
    }

    private static Date date(LocalDate value) {
        return value == null ? null : Date.valueOf(value);
    }

    public static String newId() {
        return UUID.randomUUID().toString();
    }
}
