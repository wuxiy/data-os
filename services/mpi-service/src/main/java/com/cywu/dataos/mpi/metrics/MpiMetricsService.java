package com.cywu.dataos.mpi.metrics;

import java.util.LinkedHashMap;
import java.util.Map;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * 五项指标的真实统计（验收 #8：门户指标卡与 API 一致）。
 * identitiesLoaded/autoMatches 来自 Doris 批处理态，黄金人与复核
 * 进度来自 PG 事务态——两侧同一次 rebuild 的投影。
 */
@Service
@ConditionalOnProperty(name = "data-os.mpi.doris.url")
public class MpiMetricsService {

    private final JdbcTemplate pg;
    private final JdbcTemplate doris;

    public MpiMetricsService(JdbcTemplate pg, @Qualifier("dorisJdbc") JdbcTemplate doris) {
        this.pg = pg;
        this.doris = doris;
    }

    public Map<String, Long> metrics(String tenantId) {
        Map<String, Long> metrics = new LinkedHashMap<>();
        metrics.put("identitiesLoaded", count(doris.queryForObject(
                "SELECT COUNT(*) FROM dataos_mpi.mpi_source_identity WHERE tenant_id = ?",
                Long.class, tenantId)));
        metrics.put("goldenPersons", count(pg.queryForObject(
                "SELECT COUNT(*) FROM data_os_mpi.mpi_person WHERE tenant_id = ? AND status = 'ACTIVE'",
                Long.class, tenantId)));
        metrics.put("autoMatches", count(doris.queryForObject(
                "SELECT COUNT(*) FROM dataos_mpi.mpi_match_result WHERE tenant_id = ? AND outcome = 'AUTO_MATCH'",
                Long.class, tenantId)));
        metrics.put("reviewPending", count(pg.queryForObject(
                "SELECT COUNT(*) FROM data_os_mpi.mpi_review_task WHERE tenant_id = ? AND status = 'OPEN'",
                Long.class, tenantId)));
        metrics.put("reviewResolved", count(pg.queryForObject(
                "SELECT COUNT(*) FROM data_os_mpi.mpi_review_task WHERE tenant_id = ? AND status = 'RESOLVED'",
                Long.class, tenantId)));
        return metrics;
    }

    private static long count(Long value) {
        return value == null ? 0L : value;
    }
}
