package com.cywu.dataos.controlplane.bootstrap;

import java.math.BigDecimal;
import java.sql.Timestamp;
import java.time.Instant;
import java.util.UUID;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.CommandLineRunner;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Component;

@Component
public class DemoDataInitializer implements CommandLineRunner {

    private final JdbcTemplate jdbc;
    private final boolean enabled;

    public DemoDataInitializer(JdbcTemplate jdbc, @Value("${data-os.seed-demo:false}") boolean enabled) {
        this.jdbc = jdbc;
        this.enabled = enabled;
    }

    @Override
    public void run(String... args) {
        if (!enabled || count("data_os.sources") > 0) {
            return;
        }

        var sourceId = UUID.randomUUID().toString();
        var now = Instant.now();
        jdbc.update("""
                INSERT INTO data_os.sources
                    (id, tenant_id, institution_id, name, system_type, protocol, status, created_at)
                VALUES (?, 'default', 'demo-hospital', 'LIS 检验系统', 'LIS', 'JDBC', 'HEALTHY', ?)
                """, sourceId, Timestamp.from(now));
        jdbc.update("""
                INSERT INTO data_os.ingestion_jobs
                    (id, source_id, name, mode, executor, status, created_at, last_run_at)
                VALUES (?, ?, '检验结果增量同步', 'CDC', 'SEATUNNEL', 'RUNNING', ?, ?)
                """, UUID.randomUUID().toString(), sourceId, Timestamp.from(now), Timestamp.from(now));

        seedMetric("standard-coverage", "标准覆盖率", "92.4", "%", "95", "较上月 +3.1%", "healthy", 1);
        seedMetric("quality-pass-rate", "质量规则通过率", "98.6", "%", "99", "目标 99% · -0.4%", "warning", 2);
        seedMetric("issue-closure-rate", "问题按时闭环率", "86.7", "%", "90", "目标 90% · +5.2%", "warning", 3);
        seedMetric("lineage-completeness", "血缘完整率", "94.1", "%", "95", "核心资产 100%", "healthy", 4);
        seedMetric("mapping-count", "标准映射覆盖", "1286", "项", "1400", "待确认 38 项", "healthy", 5);
        seedMetric("active-contracts", "有效数据合同", "42", "份", "45", "本周待变更 3 份", "healthy", 6);

        seedIssue("DQ-20260801-023", "LIS 检验结果及时率下降", "HIGH", "OVERDUE",
                "asset-lis-lab-result", "rule-timeliness-result-time", "检验科", "检验科数据管理员",
                "TICKET-20260801-023", "检验主题 / 38 张表", now.minusSeconds(3600));
        seedIssue("DQ-20260801-019", "EMR 病历诊断规范映射缺失", "HIGH", "OVERDUE",
                "asset-emr-diagnosis", "rule-icd10-mapping", "病案室", "病案室数据管理员",
                "TICKET-20260801-019", "病历主题 / 21 张表", now.minusSeconds(1200));
        seedIssue("DQ-20260731-087", "手术记录字段缺失", "MEDIUM", "IN_PROGRESS",
                "asset-surgery-record", "rule-surgery-required-fields", "麻醉科", "麻醉科数据管理员",
                "TICKET-20260731-087", "手术主题 / 12 张表", now.plusSeconds(86400));
    }

    private void seedMetric(String key, String label, String value, String unit, String target,
                            String detail, String tone, int order) {
        jdbc.update("""
                INSERT INTO data_os.governance_metrics
                    (metric_key, tenant_id, institution_id, label, metric_value, unit, target, detail, tone, display_order)
                VALUES (?, 'default', 'demo-hospital', ?, ?, ?, ?, ?, ?, ?)
                """, key, label, new BigDecimal(value), unit, new BigDecimal(target), detail, tone, order);
    }

    private void seedIssue(String id, String title, String severity, String status, String datasetId,
                           String ruleId, String department, String owner, String ticketId,
                           String impact, Instant dueAt) {
        jdbc.update("""
                INSERT INTO data_os.governance_issues
                    (id, tenant_id, institution_id, title, severity, status, dataset_id, rule_id,
                     owner_department, owner_name, ticket_id, impact, due_at)
                VALUES (?, 'default', 'demo-hospital', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
                """, id, title, severity, status, datasetId, ruleId, department, owner, ticketId, impact,
                Timestamp.from(dueAt));
    }

    private int count(String table) {
        Integer result = jdbc.queryForObject("SELECT COUNT(*) FROM " + table, Integer.class);
        return result == null ? 0 : result;
    }
}
