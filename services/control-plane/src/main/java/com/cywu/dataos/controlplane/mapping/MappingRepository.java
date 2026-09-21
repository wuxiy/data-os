package com.cywu.dataos.controlplane.mapping;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * 标准映射仓储（G23）：查询一律 tenant 过滤；版本内容写入为「整版本替换 +
 * checksum 重算」；激活并发靠活动指针 CAS（见 casActivePointer）。
 */
@Repository
public class MappingRepository {

    private final JdbcTemplate jdbc;

    public MappingRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    // ---- 映射集 ----

    public boolean existsByCode(String tenantId, String code) {
        var found = jdbc.queryForObject(
                "SELECT COUNT(*) FROM data_os.standard_mapping_set WHERE tenant_id = ? AND code = ?",
                Integer.class, tenantId, code);
        return found != null && found > 0;
    }

    public void insertSet(StandardMappingSet set) {
        jdbc.update("""
                INSERT INTO data_os.standard_mapping_set
                    (id, tenant_id, code, name, source_asset, dataset, standard_id,
                     active_version_id, created_by, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, set.id(), set.tenantId(), set.code(), set.name(), set.sourceAsset(),
                set.dataset(), set.standardId(), set.activeVersionId(), set.createdBy(),
                Timestamp.from(set.createdAt()), Timestamp.from(set.updatedAt()));
    }

    public Optional<StandardMappingSet> findSet(String tenantId, String id) {
        return jdbc.query("""
                SELECT * FROM data_os.standard_mapping_set WHERE tenant_id = ? AND id = ?
                """, this::mapSet, tenantId, id).stream().findFirst();
    }

    public record SetRow(List<StandardMappingSet> sets, long total) {
    }

    public SetRow findSets(String tenantId, String query, int page, int size) {
        var like = "%" + (query == null ? "" : query.trim()) + "%";
        var total = jdbc.queryForObject("""
                SELECT COUNT(*) FROM data_os.standard_mapping_set
                WHERE tenant_id = ? AND (code LIKE ? OR name LIKE ? OR source_asset LIKE ?)
                """, Long.class, tenantId, like, like, like);
        var items = jdbc.query("""
                SELECT * FROM data_os.standard_mapping_set
                WHERE tenant_id = ? AND (code LIKE ? OR name LIKE ? OR source_asset LIKE ?)
                ORDER BY updated_at DESC LIMIT ? OFFSET ?
                """, this::mapSet, tenantId, like, like, like, size, page * size);
        return new SetRow(items, total == null ? 0 : total);
    }

    public int updateSetName(String setId, String name) {
        return jdbc.update("""
                UPDATE data_os.standard_mapping_set
                SET name = ?, updated_at = ?
                WHERE id = ?
                """, name, Timestamp.from(Instant.now()), setId);
    }

    /** 活动指针 CAS：expected 为 null 用 IS NULL 分支。返回 1=赢得并发。 */
    public int casActivePointer(String setId, String expected, String target) {
        if (expected == null) {
            return jdbc.update("""
                    UPDATE data_os.standard_mapping_set
                    SET active_version_id = ?, updated_at = ?
                    WHERE id = ? AND active_version_id IS NULL
                    """, target, Timestamp.from(Instant.now()), setId);
        }
        return jdbc.update("""
                UPDATE data_os.standard_mapping_set
                SET active_version_id = ?, updated_at = ?
                WHERE id = ? AND active_version_id = ?
                """, target, Timestamp.from(Instant.now()), setId, expected);
    }

    public void clearActivePointerIfPointing(String setId, String versionId) {
        jdbc.update("""
                UPDATE data_os.standard_mapping_set
                SET active_version_id = NULL, updated_at = ?
                WHERE id = ? AND active_version_id = ?
                """, Timestamp.from(Instant.now()), setId, versionId);
    }

    // ---- 版本 ----

    public void insertVersion(StandardMappingVersion version) {
        jdbc.update("""
                INSERT INTO data_os.standard_mapping_version
                    (id, mapping_set_id, tenant_id, version_no, status, checksum, created_by,
                     submitted_at, activated_at, retired_at, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, version.id(), version.mappingSetId(), version.tenantId(), version.versionNo(),
                version.status().name(), version.checksum(), version.createdBy(),
                nullable(version.submittedAt()), nullable(version.activatedAt()),
                nullable(version.retiredAt()), Timestamp.from(version.createdAt()),
                Timestamp.from(version.updatedAt()));
    }

    public List<StandardMappingVersion> findVersions(String tenantId, String setId) {
        return jdbc.query("""
                SELECT * FROM data_os.standard_mapping_version
                WHERE tenant_id = ? AND mapping_set_id = ? ORDER BY version_no DESC
                """, this::mapVersion, tenantId, setId);
    }

    public Optional<StandardMappingVersion> findVersion(String tenantId, String versionId) {
        return jdbc.query("""
                SELECT * FROM data_os.standard_mapping_version WHERE tenant_id = ? AND id = ?
                """, this::mapVersion, tenantId, versionId).stream().findFirst();
    }

    public int maxVersionNo(String tenantId, String setId) {
        var found = jdbc.queryForObject(
                "SELECT COALESCE(MAX(version_no), 0) FROM data_os.standard_mapping_version "
                        + "WHERE tenant_id = ? AND mapping_set_id = ?",
                Integer.class, tenantId, setId);
        return found == null ? 0 : found;
    }

    public int markSubmitted(String versionId) {
        var now = Timestamp.from(Instant.now());
        return jdbc.update("""
                UPDATE data_os.standard_mapping_version
                SET status = 'IN_REVIEW', submitted_at = ?, updated_at = ?
                WHERE id = ? AND status = 'DRAFT'
                """, now, now, versionId);
    }

    public int markActive(String versionId) {
        var now = Timestamp.from(Instant.now());
        return jdbc.update("""
                UPDATE data_os.standard_mapping_version
                SET status = 'ACTIVE', activated_at = ?, updated_at = ?
                WHERE id = ? AND status IN ('IN_REVIEW', 'RETIRED')
                """, now, now, versionId);
    }

    public int markRetired(String versionId) {
        var now = Timestamp.from(Instant.now());
        return jdbc.update("""
                UPDATE data_os.standard_mapping_version
                SET status = 'RETIRED', retired_at = ?, updated_at = ?
                WHERE id = ? AND status = 'ACTIVE'
                """, now, now, versionId);
    }

    public int updateChecksum(String versionId, String checksum) {
        return jdbc.update("""
                UPDATE data_os.standard_mapping_version
                SET checksum = ?, updated_at = ?
                WHERE id = ? AND status = 'DRAFT'
                """, checksum, Timestamp.from(Instant.now()), versionId);
    }

    public List<StandardMappingVersion> findActiveVersions(String tenantId) {
        return jdbc.query("""
                SELECT * FROM data_os.standard_mapping_version WHERE tenant_id = ? AND status = 'ACTIVE'
                """, this::mapVersion, tenantId);
    }

    // ---- 映射项（整版本替换）----

    public void replaceItems(String versionId, List<StandardMappingItem> items) {
        jdbc.update("DELETE FROM data_os.standard_mapping_item WHERE version_id = ?", versionId);
        var now = Timestamp.from(Instant.now());
        for (var item : items) {
            jdbc.update("""
                    INSERT INTO data_os.standard_mapping_item
                        (id, version_id, source_column, target_element_code, transform,
                         transform_param, conclusion, note, sort_order, created_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                    """, item.id(), versionId, item.sourceColumn(), item.targetElementCode(),
                    item.transform().name(), item.transformParam(), item.conclusion(),
                    item.note(), item.sortOrder(), now);
        }
    }

    public List<StandardMappingItem> findItems(String tenantId, String versionId) {
        return jdbc.query("""
                SELECT * FROM data_os.standard_mapping_item i
                WHERE i.version_id = ?
                  AND EXISTS (SELECT 1 FROM data_os.standard_mapping_version v
                              WHERE v.id = i.version_id AND v.tenant_id = ?)
                ORDER BY i.sort_order, i.source_column
                """, this::mapItem, versionId, tenantId);
    }

    // ---- 验证证据 ----

    public void insertValidation(StandardMappingValidation validation) {
        jdbc.update("""
                INSERT INTO data_os.standard_mapping_validation
                    (id, version_id, tenant_id, checksum, status, result_json, data_time,
                     created_by, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, validation.id(), validation.versionId(), validation.tenantId(),
                validation.checksum(), validation.status(), validation.resultJson(),
                validation.dataTime(), validation.createdBy(), Timestamp.from(validation.createdAt()));
    }

    public List<StandardMappingValidation> findValidations(String tenantId, String versionId, int limit) {
        return jdbc.query("""
                SELECT * FROM data_os.standard_mapping_validation
                WHERE tenant_id = ? AND version_id = ?
                ORDER BY created_at DESC LIMIT ?
                """, this::mapValidation, tenantId, versionId, limit);
    }

    // ---- 事件 ----

    public void insertEvent(StandardMappingEvent event) {
        jdbc.update("""
                INSERT INTO data_os.standard_mapping_event
                    (id, mapping_set_id, version_id, tenant_id, event_type, actor, detail, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?)
                """, event.id(), event.mappingSetId(), event.versionId(), event.tenantId(),
                event.eventType(), event.actor(), event.detail(), Timestamp.from(event.createdAt()));
    }

    public List<StandardMappingEvent> findEvents(String tenantId, String setId, int limit) {
        return jdbc.query("""
                SELECT * FROM data_os.standard_mapping_event
                WHERE tenant_id = ? AND mapping_set_id = ?
                ORDER BY created_at DESC LIMIT ?
                """, this::mapEvent, tenantId, setId, limit);
    }

    // ---- 覆盖率投影（ai-ready / 门户）----

    /** 已发布标准版本的 CODE 数据元（standard_id, element_code）清单。 */
    public List<Map.Entry<String, String>> publishedCodeElements(String tenantId) {
        return jdbc.query("""
                SELECT s.id AS standard_id, e.code AS element_code
                FROM data_os.data_standard_version v
                JOIN data_os.data_standard s ON s.id = v.standard_id
                JOIN data_os.data_standard_element e ON e.version_id = v.id
                WHERE v.tenant_id = ? AND v.status = 'PUBLISHED' AND e.data_type = 'CODE'
                """, (rs, i) -> Map.entry(rs.getString("standard_id"), rs.getString("element_code")),
                tenantId);
    }

    /** ACTIVE 映射版本覆盖的（standard_id, element_code）清单。 */
    public List<Map.Entry<String, String>> activeMappedElements(String tenantId) {
        return jdbc.query("""
                SELECT s.standard_id, i.target_element_code
                FROM data_os.standard_mapping_version v
                JOIN data_os.standard_mapping_set s ON s.id = v.mapping_set_id
                JOIN data_os.standard_mapping_item i ON i.version_id = v.id
                WHERE v.tenant_id = ? AND v.status = 'ACTIVE'
                """, (rs, i) -> Map.entry(rs.getString("standard_id"), rs.getString("target_element_code")),
                tenantId);
    }

    public long countActiveSets(String tenantId) {
        var found = jdbc.queryForObject(
                "SELECT COUNT(*) FROM data_os.standard_mapping_version WHERE tenant_id = ? AND status = 'ACTIVE'",
                Long.class, tenantId);
        return found == null ? 0 : found;
    }

    // ---- 映射 ----

    private StandardMappingSet mapSet(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        return new StandardMappingSet(
                rs.getString("id"), rs.getString("tenant_id"), rs.getString("code"),
                rs.getString("name"), rs.getString("source_asset"), rs.getString("dataset"),
                rs.getString("standard_id"), rs.getString("active_version_id"),
                rs.getString("created_by"), rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("updated_at").toInstant());
    }

    private StandardMappingVersion mapVersion(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        return new StandardMappingVersion(
                rs.getString("id"), rs.getString("mapping_set_id"), rs.getString("tenant_id"),
                rs.getInt("version_no"), MappingLifecycle.valueOf(rs.getString("status")),
                rs.getString("checksum"), rs.getString("created_by"),
                instant(rs, "submitted_at"), instant(rs, "activated_at"), instant(rs, "retired_at"),
                instant(rs, "created_at"), instant(rs, "updated_at"));
    }

    private StandardMappingItem mapItem(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        return new StandardMappingItem(
                rs.getString("id"), rs.getString("version_id"), rs.getString("source_column"),
                rs.getString("target_element_code"), MappingTransform.valueOf(rs.getString("transform")),
                rs.getString("transform_param"), rs.getString("conclusion"), rs.getString("note"),
                rs.getInt("sort_order"), rs.getTimestamp("created_at").toInstant());
    }

    private StandardMappingValidation mapValidation(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        return new StandardMappingValidation(
                rs.getString("id"), rs.getString("version_id"), rs.getString("tenant_id"),
                rs.getString("checksum"), rs.getString("status"), rs.getString("result_json"),
                rs.getString("data_time"), rs.getString("created_by"),
                rs.getTimestamp("created_at").toInstant());
    }

    private StandardMappingEvent mapEvent(java.sql.ResultSet rs, int i) throws java.sql.SQLException {
        return new StandardMappingEvent(
                rs.getString("id"), rs.getString("mapping_set_id"), rs.getString("version_id"),
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
