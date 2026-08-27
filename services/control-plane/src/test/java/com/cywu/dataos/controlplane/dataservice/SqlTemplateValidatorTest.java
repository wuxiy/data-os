package com.cywu.dataos.controlplane.dataservice;

import java.util.Set;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class SqlTemplateValidatorTest {

    private static final String CLEAN = """
            SELECT visit_date, COUNT(*) AS prescriptions
            FROM ods_ep.ep_mz_cfzb
            WHERE cf_date BETWEEN :start_date AND :end_date
            GROUP BY visit_date
            """;

    @Test
    void acceptsParameterizedSelect() {
        assertThat(SqlTemplateValidator.validate(CLEAN, Set.of("start_date", "end_date"))).isNull();
    }

    @Test
    void acceptsWithCte() {
        var template = """
                WITH recent AS (SELECT * FROM ods_ep.ep_mz_cfzb WHERE cf_date >= :start_date)
                SELECT COUNT(*) FROM recent
                """;
        assertThat(SqlTemplateValidator.validate(template, Set.of("start_date"))).isNull();
    }

    @Test
    void rejectsNonSelect() {
        var rejection = SqlTemplateValidator.validate(
                "INSERT INTO t VALUES (1)", Set.of());
        assertThat(rejection).contains("SELECT");
    }

    @Test
    void rejectsSemicolonStacking() {
        var rejection = SqlTemplateValidator.validate(
                "SELECT 1; DROP TABLE t", Set.of());
        assertThat(rejection).contains("分号");
    }

    @Test
    void rejectsDmlKeyword() {
        var rejection = SqlTemplateValidator.validate(
                "SELECT * FROM t WHERE flag = 1 FOR UPDATE", Set.of());
        assertThat(rejection).contains("UPDATE");
    }

    @Test
    void rejectsUndeclaredPlaceholder() {
        var rejection = SqlTemplateValidator.validate(
                "SELECT * FROM t WHERE d = :start_date", Set.of("start_date", "end_date"));
        assertThat(rejection).contains("缺少已声明参数");
    }

    @Test
    void rejectsUndeclaredUsage() {
        var rejection = SqlTemplateValidator.validate(
                "SELECT * FROM t WHERE d = :start_date AND x = :extra", Set.of("start_date"));
        assertThat(rejection).contains("未声明");
    }

    @Test
    void keywordInsideStringLiteralIsAlsoRejectedConservatively() {
        // 保守口径：字符串字面量里的敏感词同样拒绝，调用方改写措辞即可
        var rejection = SqlTemplateValidator.validate(
                "SELECT * FROM t WHERE note = 'please insert'", Set.of());
        assertThat(rejection).contains("被拒绝的关键字");
    }

    @Test
    void commentsAreStrippedBeforeChecks() {
        var template = """
                -- select base
                /* block note */
                SELECT * FROM t WHERE d = :start_date
                """;
        assertThat(SqlTemplateValidator.validate(template, Set.of("start_date"))).isNull();
    }
}
