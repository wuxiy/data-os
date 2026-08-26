package com.cywu.dataos.controlplane.ai;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.List;
import java.util.Optional;

import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Repository;

/**
 * AI Data Product 仓储（{@code data_os.ai_data_product} 及版本表）。
 * 查询一律带 tenant_id 过滤，越权访问表现为不存在（404）。
 */
@Repository
public class AIDataProductRepository {

    private static final String PRODUCT_SELECT = """
            SELECT id, tenant_id, name, product_type, owner, workflow_type, source_desc,
                   current_version, lifecycle, created_at, updated_at
            FROM data_os.ai_data_product
            """;

    private final JdbcTemplate jdbc;

    public AIDataProductRepository(JdbcTemplate jdbc) {
        this.jdbc = jdbc;
    }

    public AIDataProduct save(AIDataProduct product) {
        jdbc.update("""
                INSERT INTO data_os.ai_data_product
                    (id, tenant_id, name, product_type, owner, workflow_type, source_desc,
                     current_version, lifecycle, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                product.id(), product.tenantId(), product.name(), product.productType().name(),
                product.owner(), product.workflowType(), product.sourceDesc(),
                product.currentVersion(), product.lifecycle().name(),
                Timestamp.from(product.createdAt()), Timestamp.from(product.updatedAt()));
        return product;
    }

    public List<AIDataProduct> findAll(String tenantId) {
        return jdbc.query(PRODUCT_SELECT + " WHERE tenant_id = ? ORDER BY created_at DESC",
                this::mapProduct, tenantId);
    }

    public Optional<AIDataProduct> findById(String id, String tenantId) {
        return jdbc.query(PRODUCT_SELECT + " WHERE id = ? AND tenant_id = ?",
                this::mapProduct, id, tenantId).stream().findFirst();
    }

    public boolean existsByName(String tenantId, String name) {
        var found = jdbc.queryForObject(
                "SELECT EXISTS(SELECT 1 FROM data_os.ai_data_product WHERE tenant_id = ? AND name = ?)",
                Boolean.class, tenantId, name);
        return Boolean.TRUE.equals(found);
    }

    public int updateLifecycle(String id, String tenantId, AIDataProductLifecycle lifecycle, Instant updatedAt) {
        return jdbc.update("""
                UPDATE data_os.ai_data_product
                SET lifecycle = ?, updated_at = ?
                WHERE id = ? AND tenant_id = ?
                """, lifecycle.name(), Timestamp.from(updatedAt), id, tenantId);
    }

    public AIDataProductVersion saveVersion(AIDataProductVersion version) {
        jdbc.update("""
                INSERT INTO data_os.ai_data_product_version
                    (id, product_id, version_sn, recipe_ref, git_commit, snapshot_at,
                     readiness_json, build_status, created_at)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
                """,
                version.id(), version.productId(), version.versionSn(), version.recipeRef(),
                version.gitCommit(), version.snapshotAt(), version.readinessJson(),
                version.buildStatus(), Timestamp.from(version.createdAt()));
        return version;
    }

    public List<AIDataProductVersion> findVersions(String productId) {
        return jdbc.query("""
                SELECT id, product_id, version_sn, recipe_ref, git_commit, snapshot_at,
                       readiness_json, build_status, created_at
                FROM data_os.ai_data_product_version
                WHERE product_id = ?
                ORDER BY created_at ASC
                """, this::mapVersion, productId);
    }

    /** 评估结论回写当前版本（G9-6）：readiness_json + build_status。 */
    public int updateVersionReadiness(String productId, String versionSn,
                                      String readinessJson, String buildStatus) {
        return jdbc.update("""
                UPDATE data_os.ai_data_product_version
                SET readiness_json = ?, build_status = ?
                WHERE product_id = ? AND version_sn = ?
                """, readinessJson, buildStatus, productId, versionSn);
    }

    private AIDataProduct mapProduct(java.sql.ResultSet rs, int rowNumber) throws java.sql.SQLException {
        return new AIDataProduct(
                rs.getString("id"),
                rs.getString("tenant_id"),
                rs.getString("name"),
                AIDataProductType.valueOf(rs.getString("product_type")),
                rs.getString("owner"),
                rs.getString("workflow_type"),
                rs.getString("source_desc"),
                rs.getString("current_version"),
                AIDataProductLifecycle.valueOf(rs.getString("lifecycle")),
                rs.getTimestamp("created_at").toInstant(),
                rs.getTimestamp("updated_at").toInstant());
    }

    private AIDataProductVersion mapVersion(java.sql.ResultSet rs, int rowNumber) throws java.sql.SQLException {
        return new AIDataProductVersion(
                rs.getString("id"),
                rs.getString("product_id"),
                rs.getString("version_sn"),
                rs.getString("recipe_ref"),
                rs.getString("git_commit"),
                rs.getDate("snapshot_at") == null ? null : rs.getDate("snapshot_at").toLocalDate(),
                rs.getString("readiness_json"),
                rs.getString("build_status"),
                rs.getTimestamp("created_at").toInstant());
    }
}
