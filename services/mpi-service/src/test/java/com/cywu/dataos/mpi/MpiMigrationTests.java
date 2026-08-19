package com.cywu.dataos.mpi;

import java.util.List;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 迁移单测：H2(PostgreSQL 模式) 上执行与生产同构的 Flyway V1，
 * 五张事务表与 MPI schema 内的迁移历史必须同时存在。
 */
@ActiveProfiles("test")
@SpringBootTest
class MpiMigrationTests {

    @Autowired
    private JdbcTemplate jdbc;

    @Test
    void v1CreatesAllMpiTables() {
        // H2 大写化未加引号标识符，PG 小写：断言统一小写。
        var tables = tablesInMpiSchema().stream().map(String::toLowerCase).toList();
        assertThat(tables).contains("mpi_person", "mpi_person_link", "mpi_review_task",
                "mpi_audit_event", "mpi_rule_version");
    }

    @Test
    void flywayHistoryLivesInsideMpiSchema() {
        assertThat(tablesInMpiSchema().stream().map(String::toLowerCase).toList())
                .contains("flyway_schema_history");
    }

    // H2 将未加引号的 schema 名大写化（DATA_OS_MPI），PG 为小写：统一 UPPER 比较。
    private List<String> tablesInMpiSchema() {
        return jdbc.queryForList(
                "SELECT table_name FROM information_schema.tables"
                        + " WHERE UPPER(table_schema) = 'DATA_OS_MPI'",
                String.class);
    }
}
