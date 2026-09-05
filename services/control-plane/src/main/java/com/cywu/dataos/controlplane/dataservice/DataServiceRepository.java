package com.cywu.dataos.controlplane.dataservice;

import java.sql.Timestamp;
import java.time.Instant;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * 数据服务三表仓储。定义与 Key 查询一律带 tenant_id 过滤（内部 registry
 * 除外，按 key_hash 全局定位）；审计回写以 idempotency_key 幂等。
 */
@Repository
public class DataServiceRepository {

    private static final String SERVICE_SELECT = """
            SELECT id, tenant_id, code, name, description, version_sn, status,
                   sql_template, parameters_json, columns_json, max_rows, timeout_seconds,
                   owner, created_at, updated_at
            FROM data_os.data_service
            """;

    private final JdbcTemplate jdbc;

    public DataServiceRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public DataServiceDefinition save(DataServiceDefinition definition) {
        jdbc.update("""
                INSERT INTO data_os.data_service
                    (id, tenant_id, code, name, description, version_sn, status,
                     sql_template, parameters_json, columns_json, max_rows, timeout_seconds,
                     owner, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                definition.id(), definition.tenantId(), definition.code(), definition.name(),
                definition.description(), definition.versionSn(), definition.status().name(),
                definition.sqlTemplate(), definition.parametersJson(), definition.columnsJson(),
                definition.maxRows(), definition.timeoutSeconds(), definition.owner(),
                Timestamp.from(definition.createdAt()), Timestamp.from(definition.updatedAt()));
        return definition;
    }

    public List<DataServiceDefinition> findAll(String tenantId) {
        return jdbc.query(SERVICE_SELECT + " WHERE tenant_id = ? ORDER BY created_at DESC",
                this::mapDefinition, tenantId);
    }

    public Optional<DataServiceDefinition> findById(String id, String tenantId) {
        return jdbc.query(SERVICE_SELECT + " WHERE id = ? AND tenant_id = ?",
                this::mapDefinition, id, tenantId).stream().findFirst();
    }

    public Optional<DataServiceDefinition> findPublishedByCode(String code) {
        return jdbc.query(SERVICE_SELECT + " WHERE code = ? AND status = 'PUBLISHED'",
                this::mapDefinition, code).stream().findFirst();
    }

    public List<DataServiceDefinition> findPublished() {
        return jdbc.query(SERVICE_SELECT + " WHERE status = 'PUBLISHED'", this::mapDefinition);
    }

    public boolean existsByCode(String tenantId, String code) {
        var found = jdbc.queryForObject(
                "SELECT EXISTS(SELECT 1 FROM data_os.data_service WHERE tenant_id = ? AND code = ?)",
                Boolean.class, tenantId, code);
        return Boolean.TRUE.equals(found);
    }

    /** 导出投影用：按服务 id 全局取 code（导出表无租户过滤，经内部端点驱动）。 */
    public Optional<String> findCodeById(String serviceId) {
        return jdbc.query("SELECT code FROM data_os.data_service WHERE id = ?",
                (rs, rowNumber) -> rs.getString(1), serviceId).stream().findFirst();
    }

    public int updateStatus(String id, String tenantId, DataApiLifecycle status, Instant updatedAt) {
        return jdbc.update("""
                UPDATE data_os.data_service
                SET status = ?, updated_at = ?
                WHERE id = ? AND tenant_id = ?
                """, status.name(), Timestamp.from(updatedAt), id, tenantId);
    }

    // ---- API Key ----

    public DataServiceKey saveKey(DataServiceKey key) {
        jdbc.update("""
                INSERT INTO data_os.data_service_key
                    (id, service_id, tenant_id, caller_name, key_hash, key_prefix,
                     allowed_hospitals_json, daily_quota, status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                key.id(), key.serviceId(), key.tenantId(), key.callerName(), key.keyHash(),
                key.keyPrefix(), key.allowedHospitalsJson(), key.dailyQuota(),
                key.status().name(), Timestamp.from(key.createdAt()));
        return key;
    }

    public List<DataServiceKey> findKeys(String serviceId, String tenantId) {
        return jdbc.query("""
                SELECT id, service_id, tenant_id, caller_name, key_hash, key_prefix,
                       allowed_hospitals_json, daily_quota, status, created_at, last_used_at, revoked_at
                FROM data_os.data_service_key
                WHERE service_id = ? AND tenant_id = ?
                ORDER BY created_at DESC
                """, this::mapKey, serviceId, tenantId);
    }

    public List<DataServiceKey> findActiveKeys(List<String> serviceIds) {
        var placeholders = String.join(",", java.util.Collections.nCopies(serviceIds.size(), "?"));
        return jdbc.query("""
                SELECT id, service_id, tenant_id, caller_name, key_hash, key_prefix,
                       allowed_hospitals_json, daily_quota, status, created_at, last_used_at, revoked_at
                FROM data_os.data_service_key
                WHERE status = 'ACTIVE' AND service_id IN (%s)
                """.formatted(placeholders), this::mapKey, serviceIds.toArray());
    }

    public int revokeKey(String keyId, String serviceId, String tenantId, Instant revokedAt) {
        return jdbc.update("""
                UPDATE data_os.data_service_key
                SET status = 'REVOKED', revoked_at = ?
                WHERE id = ? AND service_id = ? AND tenant_id = ? AND status = 'ACTIVE'
                """, Timestamp.from(revokedAt), keyId, serviceId, tenantId);
    }

    public Optional<DataServiceKey> findKeyByHash(String keyHash) {
        return jdbc.query("""
                SELECT id, service_id, tenant_id, caller_name, key_hash, key_prefix,
                       allowed_hospitals_json, daily_quota, status, created_at, last_used_at, revoked_at
                FROM data_os.data_service_key
                WHERE key_hash = ?
                """, this::mapKey, keyHash).stream().findFirst();
    }

    public int touchKey(String keyHash, Instant lastUsedAt) {
        return jdbc.update("UPDATE data_os.data_service_key SET last_used_at = ? WHERE key_hash = ?",
                Timestamp.from(lastUsedAt), keyHash);
    }

    // ---- 调用审计 ----

    /** 幂等回写：同 idempotency_key 已存在则跳过（返回 false）。 */
    public boolean saveCall(DataServiceCall call) {
        var exists = jdbc.queryForObject(
                "SELECT EXISTS(SELECT 1 FROM data_os.data_service_call WHERE idempotency_key = ?)",
                Boolean.class, call.idempotencyKey());
        if (Boolean.TRUE.equals(exists)) {
            return false;
        }
        return jdbc.update("""
                INSERT INTO data_os.data_service_call
                    (id, service_id, tenant_id, key_id, idempotency_key, parameters_json,
                     row_count, truncated, elapsed_ms, status_code, called_at, kind)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                call.id(), call.serviceId(), call.tenantId(), call.keyId(), call.idempotencyKey(),
                call.parametersJson(), call.rowCount(), call.truncated(), call.elapsedMs(),
                call.statusCode(), Timestamp.from(call.calledAt()), call.kind()) > 0;
    }

    public List<DataServiceCall> findCalls(String serviceId, String tenantId, int limit) {
        return jdbc.query("""
                SELECT id, service_id, tenant_id, key_id, idempotency_key, parameters_json,
                       row_count, truncated, elapsed_ms, status_code, called_at, kind
                FROM data_os.data_service_call
                WHERE service_id = ? AND tenant_id = ?
                ORDER BY called_at DESC
                LIMIT ?
                """, this::mapCall, serviceId, tenantId, limit);
    }

    /** 当日各 Key 的成功调用量（registry 配额窗口）。 */
    public List<String[]> dailyUsageByKeyHash(LocalDate today) {
        return jdbc.query("""
                SELECT k.key_hash, COUNT(c.id)
                FROM data_os.data_service_key k
                JOIN data_os.data_service_call c ON c.key_id = k.id
                WHERE c.called_at >= ? AND c.status_code < 500
                GROUP BY k.key_hash
                """, (rs, rowNumber) -> new String[]{rs.getString(1), String.valueOf(rs.getInt(2))},
                Timestamp.valueOf(today.atStartOfDay()));
    }

    public long countCallsSince(Instant since) {
        var found = jdbc.queryForObject(
                "SELECT COUNT(*) FROM data_os.data_service_call WHERE called_at >= ?",
                Long.class, Timestamp.from(since));
        return found == null ? 0 : found;
    }

    public long countCallsByService(String serviceId) {
        var found = jdbc.queryForObject(
                "SELECT COUNT(*) FROM data_os.data_service_call WHERE service_id = ?", Long.class, serviceId);
        return found == null ? 0 : found;
    }

    private DataServiceDefinition mapDefinition(java.sql.ResultSet rs, int rowNumber) throws java.sql.SQLException {
        return new DataServiceDefinition(
                rs.getString("id"),
                rs.getString("tenant_id"),
                rs.getString("code"),
                rs.getString("name"),
                rs.getString("description"),
                rs.getString("version_sn"),
                DataApiLifecycle.valueOf(rs.getString("status")),
                rs.getString("sql_template"),
                rs.getString("parameters_json"),
                rs.getString("columns_json"),
                rs.getInt("max_rows"),
                rs.getInt("timeout_seconds"),
                rs.getString("owner"),
                rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("updated_at").toInstant());
    }

    private DataServiceKey mapKey(java.sql.ResultSet rs, int rowNumber) throws java.sql.SQLException {
        var lastUsed = rs.getTimestamp("last_used_at");
        var revoked = rs.getTimestamp("revoked_at");
        return new DataServiceKey(
                rs.getString("id"),
                rs.getString("service_id"),
                rs.getString("tenant_id"),
                rs.getString("caller_name"),
                rs.getString("key_hash"),
                rs.getString("key_prefix"),
                rs.getString("allowed_hospitals_json"),
                rs.getInt("daily_quota"),
                DataServiceKey.KeyStatus.valueOf(rs.getString("status")),
                rs.getTimestamp("created_at").toInstant(),
                lastUsed == null ? null : lastUsed.toInstant(),
                revoked == null ? null : revoked.toInstant());
    }

    private DataServiceCall mapCall(java.sql.ResultSet rs, int rowNumber) throws java.sql.SQLException {
        return new DataServiceCall(
                rs.getString("id"),
                rs.getString("service_id"),
                rs.getString("tenant_id"),
                rs.getString("key_id"),
                rs.getString("idempotency_key"),
                rs.getString("parameters_json"),
                rs.getInt("row_count"),
                rs.getBoolean("truncated"),
                rs.getInt("elapsed_ms"),
                rs.getInt("status_code"),
                rs.getTimestamp("called_at").toInstant(),
                rs.getString("kind"));
    }

    // ---- 导出任务（P7，H3）----

    private static final String EXPORT_SELECT = """
            SELECT id, service_id, tenant_id, key_hash, status, parameters_json,
                   row_count, file_bytes, artifact_uri, error, created_at, updated_at, expires_at
            FROM data_os.data_service_export
            """;

    public DataServiceExport saveExport(DataServiceExport export) {
        jdbc.update("""
                INSERT INTO data_os.data_service_export
                    (id, service_id, tenant_id, key_hash, status, parameters_json,
                     row_count, file_bytes, artifact_uri, error, created_at, updated_at, expires_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                export.id(), export.serviceId(), export.tenantId(), export.keyHash(),
                export.status().name(), export.parametersJson(), export.rowCount(),
                export.fileBytes(), export.artifactUri(), export.error(),
                Timestamp.from(export.createdAt()), Timestamp.from(export.updatedAt()),
                export.expiresAt() == null ? null : Timestamp.from(export.expiresAt()));
        return export;
    }

    public Optional<DataServiceExport> findExport(String id) {
        return jdbc.query(EXPORT_SELECT + " WHERE id = ?", this::mapExport, id).stream().findFirst();
    }

    public List<DataServiceExport> findPendingExports() {
        return jdbc.query(EXPORT_SELECT + " WHERE status = 'PENDING' ORDER BY created_at", this::mapExport);
    }

    public List<DataServiceExport> findExports(String serviceId, String tenantId, int limit) {
        return jdbc.query(EXPORT_SELECT + " WHERE service_id = ? AND tenant_id = ? ORDER BY created_at DESC LIMIT ?",
                this::mapExport, serviceId, tenantId, limit);
    }

    /** RUNNING 认领是 CAS：仅 PENDING 可转入，重放/并发双认领安全。 */
    public boolean claimExport(String id, Instant now) {
        return jdbc.update("""
                UPDATE data_os.data_service_export
                SET status = 'RUNNING', updated_at = ?, error = NULL
                WHERE id = ? AND status = 'PENDING'
                """, Timestamp.from(now), id) > 0;
    }

    public boolean finalizeExport(String id, DataServiceExport.ExportStatus target, long rowCount,
                                  Long fileBytes, String artifactUri, String error, Instant expiresAt, Instant now) {
        return jdbc.update("""
                UPDATE data_os.data_service_export
                SET status = ?, row_count = ?, file_bytes = ?, artifact_uri = ?, error = ?,
                    expires_at = ?, updated_at = ?
                WHERE id = ? AND status = 'RUNNING'
                """,
                target.name(), rowCount, fileBytes, artifactUri, truncate(error, 512),
                expiresAt == null ? null : Timestamp.from(expiresAt), Timestamp.from(now), id) > 0;
    }

    /** 到期清理：SUCCEEDED 且 expires_at 已过 → EXPIRED。 */
    public int expireExports(Instant now) {
        return jdbc.update("""
                UPDATE data_os.data_service_export
                SET status = 'EXPIRED', updated_at = ?
                WHERE status = 'SUCCEEDED' AND expires_at IS NOT NULL AND expires_at < ?
                """, Timestamp.from(now), Timestamp.from(now));
    }

    /** 孤儿清算：RUNNING 且 updated_at 早于 staleBefore（进程重启遗留）→ FAILED。 */
    public int reapStaleRunning(Instant staleBefore, Instant now) {
        return jdbc.update("""
                UPDATE data_os.data_service_export
                SET status = 'FAILED', error = '导出进程重启，任务中断', updated_at = ?
                WHERE status = 'RUNNING' AND updated_at < ?
                """, Timestamp.from(now), Timestamp.from(staleBefore));
    }

    private static String truncate(String value, int maxLength) {
        if (value == null) {
            return null;
        }
        return value.length() <= maxLength ? value : value.substring(0, maxLength);
    }

    private DataServiceExport mapExport(java.sql.ResultSet rs, int rowNumber) throws java.sql.SQLException {
        var fileBytes = rs.getLong("file_bytes");
        var wasNull = rs.wasNull();
        var expiresAt = rs.getTimestamp("expires_at");
        return new DataServiceExport(
                rs.getString("id"),
                rs.getString("service_id"),
                rs.getString("tenant_id"),
                rs.getString("key_hash"),
                DataServiceExport.ExportStatus.valueOf(rs.getString("status")),
                rs.getString("parameters_json"),
                rs.getLong("row_count"),
                wasNull ? null : fileBytes,
                rs.getString("artifact_uri"),
                rs.getString("error"),
                rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("updated_at").toInstant(),
                expiresAt == null ? null : expiresAt.toInstant());
    }
}
