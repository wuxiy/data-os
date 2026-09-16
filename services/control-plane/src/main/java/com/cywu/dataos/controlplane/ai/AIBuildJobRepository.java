package com.cywu.dataos.controlplane.ai;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * AI Data 构建任务仓储（{@code data_os.ai_data_build_job}）。
 * 认领与终态回写均以状态为条件（CAS），多实例/并发下只有赢家生效。
 */
@Repository
public class AIBuildJobRepository {

    private static final String JOB_SELECT = """
            SELECT id, product_id, tenant_id, version_sn, recipe_ref, status,
                   result_json, error, created_by, created_at, started_at, finished_at
            FROM data_os.ai_data_build_job
            """;

    private final JdbcTemplate jdbc;

    public AIBuildJobRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public AIBuildJob insert(AIBuildJob job) {
        jdbc.update("""
                INSERT INTO data_os.ai_data_build_job
                    (id, product_id, tenant_id, version_sn, recipe_ref, status,
                     result_json, error, created_by, created_at, started_at, finished_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                job.id(), job.productId(), job.tenantId(), job.versionSn(), job.recipeRef(),
                job.status(), job.resultJson(), job.error(), job.createdBy(),
                Timestamp.from(job.createdAt()), null, null);
        return job;
    }

    public Optional<AIBuildJob> findById(String id) {
        return jdbc.query(JOB_SELECT + " WHERE id = ?", this::mapJob, id).stream().findFirst();
    }

    /** 最近任务在前（门户「当前任务」取首条）。 */
    public List<AIBuildJob> findByProduct(String productId, int limit) {
        return jdbc.query(JOB_SELECT + " WHERE product_id = ? ORDER BY created_at DESC LIMIT ?",
                this::mapJob, productId, limit);
    }

    /** 产品级互斥信号：排队或执行中的任务存在。 */
    public boolean hasActive(String productId) {
        var found = jdbc.queryForObject(
                "SELECT EXISTS(SELECT 1 FROM data_os.ai_data_build_job "
                        + "WHERE product_id = ? AND status IN ('QUEUED', 'RUNNING'))",
                Boolean.class, productId);
        return Boolean.TRUE.equals(found);
    }

    public Optional<String> peekNextQueuedId() {
        return jdbc.query("""
                        SELECT id FROM data_os.ai_data_build_job
                        WHERE status = 'QUEUED' ORDER BY created_at ASC LIMIT 1
                        """,
                (rs, row) -> rs.getString("id")).stream().findFirst();
    }

    /** CAS 认领：仅 QUEUED 可转 RUNNING，0 行 = 已被他人认领。 */
    public int claim(String id, Instant startedAt) {
        return jdbc.update("""
                UPDATE data_os.ai_data_build_job
                SET status = 'RUNNING', started_at = ?
                WHERE id = ? AND status = 'QUEUED'
                """, Timestamp.from(startedAt), id);
    }

    public int succeed(String id, String resultJson, Instant finishedAt) {
        return jdbc.update("""
                UPDATE data_os.ai_data_build_job
                SET status = 'SUCCEEDED', result_json = ?, finished_at = ?
                WHERE id = ? AND status = 'RUNNING'
                """, resultJson, Timestamp.from(finishedAt), id);
    }

    public int fail(String id, String error, Instant finishedAt) {
        return jdbc.update("""
                UPDATE data_os.ai_data_build_job
                SET status = 'FAILED', error = ?, finished_at = ?
                WHERE id = ? AND status = 'RUNNING'
                """, truncate(error), Timestamp.from(finishedAt), id);
    }

    /** 启动孤儿清算：上一进程遗留的 RUNNING（无租主可比对，直接判死）。 */
    public List<AIBuildJob> findRunning() {
        return jdbc.query(JOB_SELECT + " WHERE status = 'RUNNING'", this::mapJob);
    }

    private static String truncate(String message) {
        var normalized = message == null ? "" : message.trim();
        return normalized.length() > 512 ? normalized.substring(0, 512) : normalized;
    }

    private AIBuildJob mapJob(java.sql.ResultSet rs, int rowNumber) throws java.sql.SQLException {
        return new AIBuildJob(
                rs.getString("id"),
                rs.getString("product_id"),
                rs.getString("tenant_id"),
                rs.getString("version_sn"),
                rs.getString("recipe_ref"),
                rs.getString("status"),
                rs.getString("result_json"),
                rs.getString("error"),
                rs.getString("created_by"),
                rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("started_at") == null ? null : rs.getTimestamp("started_at").toInstant(),
                rs.getTimestamp("finished_at") == null ? null : rs.getTimestamp("finished_at").toInstant());
    }
}
