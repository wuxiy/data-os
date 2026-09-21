package com.cywu.dataos.controlplane.standard;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * 数据标准仓储（G22）：JdbcTemplate + text block SQL，查询一律带 tenant_id
 * （跨租户不可见）。元素集写入为「整版本替换」，版本不可变由服务层状态机守卫。
 */
@Repository
public class StandardRepository {

    private final JdbcTemplate jdbc;

    public StandardRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ---- 标准集合 ----

    public boolean existsByCode(String tenantId, String code) {
        var found = jdbc.queryForObject(
                "SELECT COUNT(*) FROM data_os.data_standard WHERE tenant_id = ? AND code = ?",
                Integer.class, tenantId, code);
        return found != null && found > 0;
    }

    public void insertStandard(DataStandard standard) {
        jdbc.update("""
                INSERT INTO data_os.data_standard
                    (id, tenant_id, code, name, description, owner, created_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, standard.id(), standard.tenantId(), standard.code(), standard.name(),
                standard.description(), standard.owner(), standard.createdBy(),
                Timestamp.from(standard.createdAt()), Timestamp.from(standard.updatedAt()));
    }

    public void updateStandardMeta(String id, String name, String description, String owner) {
        jdbc.update("""
                UPDATE data_os.data_standard
                SET name = COALESCE(?, name), description = COALESCE(?, description),
                    owner = COALESCE(?, owner), updated_at = ?
                WHERE id = ?
                """, name, description, owner, Timestamp.from(Instant.now()), id);
    }

    public Optional<DataStandard> findStandard(String tenantId, String id) {
        return jdbc.query("""
                SELECT * FROM data_os.data_standard WHERE tenant_id = ? AND id = ?
                """, this::mapStandard, tenantId, id).stream().findFirst();
    }

    public record StandardRow(List<DataStandard> standards, long total) {
    }

    /** 服务端分页；query 匹配 code/name。 */
    public StandardRow findStandards(String tenantId, String query, int page, int size) {
        var like = "%" + (query == null ? "" : query.trim()) + "%";
        var total = jdbc.queryForObject("""
                SELECT COUNT(*) FROM data_os.data_standard
                WHERE tenant_id = ? AND (code LIKE ? OR name LIKE ?)
                """, Long.class, tenantId, like, like);
        var items = jdbc.query("""
                SELECT * FROM data_os.data_standard
                WHERE tenant_id = ? AND (code LIKE ? OR name LIKE ?)
                ORDER BY updated_at DESC LIMIT ? OFFSET ?
                """, this::mapStandard, tenantId, like, like, size, page * size);
        return new StandardRow(items, total == null ? 0 : total);
    }

    // ---- 版本 ----

    public void insertVersion(DataStandardVersion version) {
        jdbc.update("""
                INSERT INTO data_os.data_standard_version
                    (id, standard_id, tenant_id, version_no, status, created_by,
                     submitted_at, published_at, deprecated_at, sync_status, synced_at,
                     created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, version.id(), version.standardId(), version.tenantId(), version.versionNo(),
                version.status().name(), version.createdBy(), nullable(version.submittedAt()),
                nullable(version.publishedAt()), nullable(version.deprecatedAt()),
                version.syncStatus(), nullable(version.syncedAt()),
                Timestamp.from(version.createdAt()), Timestamp.from(version.updatedAt()));
    }

    public List<DataStandardVersion> findVersions(String tenantId, String standardId) {
        return jdbc.query("""
                SELECT * FROM data_os.data_standard_version
                WHERE tenant_id = ? AND standard_id = ?
                ORDER BY version_no DESC
                """, this::mapVersion, tenantId, standardId);
    }

    public Optional<DataStandardVersion> findVersion(String tenantId, String versionId) {
        return jdbc.query("""
                SELECT * FROM data_os.data_standard_version WHERE tenant_id = ? AND id = ?
                """, this::mapVersion, tenantId, versionId).stream().findFirst();
    }

    public int maxVersionNo(String tenantId, String standardId) {
        var found = jdbc.queryForObject(
                "SELECT COALESCE(MAX(version_no), 0) FROM data_os.data_standard_version "
                        + "WHERE tenant_id = ? AND standard_id = ?",
                Integer.class, tenantId, standardId);
        return found == null ? 0 : found;
    }

    public List<DataStandardVersion> findVersionsByStatus(String tenantId, String standardId,
                                                          StandardLifecycle status) {
        return jdbc.query("""
                SELECT * FROM data_os.data_standard_version
                WHERE tenant_id = ? AND standard_id = ? AND status = ?
                """, this::mapVersion, tenantId, standardId, status.name());
    }

    public int markSubmitted(String versionId) {
        return jdbc.update("""
                UPDATE data_os.data_standard_version
                SET status = 'IN_REVIEW', submitted_at = ?, updated_at = ?
                WHERE id = ? AND status = 'DRAFT'
                """, Timestamp.from(Instant.now()), Timestamp.from(Instant.now()), versionId);
    }

    public int markPublished(String versionId) {
        var now = Timestamp.from(Instant.now());
        return jdbc.update("""
                UPDATE data_os.data_standard_version
                SET status = 'PUBLISHED', published_at = ?, updated_at = ?
                WHERE id = ? AND status = 'IN_REVIEW'
                """, now, now, versionId);
    }

    public int markDeprecated(String versionId) {
        var now = Timestamp.from(Instant.now());
        return jdbc.update("""
                UPDATE data_os.data_standard_version
                SET status = 'DEPRECATED', deprecated_at = ?, updated_at = ?
                WHERE id = ? AND status = 'PUBLISHED'
                """, now, now, versionId);
    }

    public int setSyncStatus(String versionId, String syncStatus) {
        var now = Timestamp.from(Instant.now());
        return jdbc.update("""
                UPDATE data_os.data_standard_version
                SET sync_status = ?, synced_at = CASE WHEN ? = 'SYNCED' THEN ? ELSE synced_at END,
                    updated_at = ?
                WHERE id = ?
                """, syncStatus, syncStatus, now, now, versionId);
    }

    // ---- 元素与值域（整版本替换）----

    public void replaceElements(String versionId, List<DataStandardElement> elements) {
        jdbc.update("""
                DELETE FROM data_os.data_standard_value WHERE element_id IN
                    (SELECT id FROM data_os.data_standard_element WHERE version_id = ?)
                """, versionId);
        jdbc.update("DELETE FROM data_os.data_standard_element WHERE version_id = ?", versionId);
        var now = Timestamp.from(Instant.now());
        for (var element : elements) {
            jdbc.update("""
                    INSERT INTO data_os.data_standard_element
                        (id, version_id, code, name, data_type, required, definition,
                         sensitivity, asset_ref, sort_order, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, element.id(), versionId, element.code(), element.name(),
                    element.dataType(), element.required(), element.definition(),
                    element.sensitivity(), element.assetRef(), element.sortOrder(), now);
            for (var value : element.values()) {
                jdbc.update("""
                        INSERT INTO data_os.data_standard_value
                            (id, element_id, code, display_name, valid_from, valid_to, sort_order, created_at)
                        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                        """, value.id(), element.id(), value.code(), value.displayName(),
                        value.validFrom(), value.validTo(), value.sortOrder(), now);
            }
        }
    }

    public List<DataStandardElement> findElements(String tenantId, String versionId) {
        var elementRows = jdbc.query("""
                SELECT * FROM data_os.data_standard_element e
                WHERE e.version_id = ?
                  AND EXISTS (SELECT 1 FROM data_os.data_standard_version v
                              WHERE v.id = e.version_id AND v.tenant_id = ?)
                ORDER BY e.sort_order, e.code
                """, (rs, i) -> {
                    var values = new ArrayList<DataStandardValue>();
                    var element = new DataStandardElement(
                            rs.getString("id"), rs.getString("version_id"), rs.getString("code"),
                            rs.getString("name"), rs.getString("data_type"), rs.getBoolean("required"),
                            rs.getString("definition"), rs.getString("sensitivity"),
                            rs.getString("asset_ref"), rs.getInt("sort_order"),
                            rs.getTimestamp("created_at").toInstant(), values);
                    return Map.entry(element.id(), element);
                }, versionId, tenantId);
        var byId = new LinkedHashMap<String, DataStandardElement>();
        elementRows.forEach(pair -> byId.put(pair.getKey(), pair.getValue()));
        if (!byId.isEmpty()) {
            jdbc.query("""
                    SELECT v.* FROM data_os.data_standard_value v
                    WHERE v.element_id IN (
                        SELECT id FROM data_os.data_standard_element WHERE version_id = ?)
                    ORDER BY v.sort_order, v.code
                    """, (rs, i) -> {
                var value = new DataStandardValue(
                        rs.getString("id"), rs.getString("element_id"), rs.getString("code"),
                        rs.getString("display_name"), rs.getString("valid_from"),
                        rs.getString("valid_to"), rs.getInt("sort_order"),
                        rs.getTimestamp("created_at").toInstant());
                var element = byId.get(value.elementId());
                if (element != null) {
                    element.values().add(value);
                }
                return value;
            }, versionId);
        }
        return List.copyOf(byId.values());
    }

    // ---- 事件 ----

    public void insertEvent(DataStandardEvent event) {
        jdbc.update("""
                INSERT INTO data_os.data_standard_event
                    (id, standard_id, version_id, tenant_id, event_type, actor, detail, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, event.id(), event.standardId(), event.versionId(), event.tenantId(),
                event.eventType(), event.actor(), event.detail(), Timestamp.from(event.createdAt()));
    }

    public List<DataStandardEvent> findEvents(String tenantId, String standardId, int limit) {
        return jdbc.query("""
                SELECT * FROM data_os.data_standard_event
                WHERE tenant_id = ? AND standard_id = ?
                ORDER BY created_at DESC LIMIT ?
                """, this::mapEvent, tenantId, standardId, limit);
    }

    // ---- 映射 ----

    private DataStandard mapStandard(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        return new DataStandard(
                rs.getString("id"), rs.getString("tenant_id"), rs.getString("code"),
                rs.getString("name"), rs.getString("description"), rs.getString("owner"),
                rs.getString("created_by"), rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("updated_at").toInstant());
    }

    private DataStandardVersion mapVersion(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        return new DataStandardVersion(
                rs.getString("id"), rs.getString("standard_id"), rs.getString("tenant_id"),
                rs.getInt("version_no"), StandardLifecycle.valueOf(rs.getString("status")),
                rs.getString("created_by"), instant(rs, "submitted_at"), instant(rs, "published_at"),
                instant(rs, "deprecated_at"), rs.getString("sync_status"), instant(rs, "synced_at"),
                instant(rs, "created_at"), instant(rs, "updated_at"));
    }

    private DataStandardEvent mapEvent(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        return new DataStandardEvent(
                rs.getString("id"), rs.getString("standard_id"), rs.getString("version_id"),
                rs.getString("tenant_id"), rs.getString("event_type"), rs.getString("actor"),
                rs.getString("detail"), rs.getTimestamp("created_at").toInstant());
    }

    private static Instant instant(java.sql.ResultSet rs, String column) throws java.sql.SQLException {
        var timestamp = rs.getTimestamp(column);
        return timestamp == null ? null : timestamp.toInstant();
    }

    private static Timestamp nullable(Instant instant) {
        return instant == null ? null : Timestamp.from(instant);
    }

    public static String newId() {
        return UUID.randomUUID().toString();
    }
}
