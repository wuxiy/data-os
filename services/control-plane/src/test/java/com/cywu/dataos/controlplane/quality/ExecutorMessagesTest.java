package com.cywu.dataos.controlplane.quality;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 执行器输出摘要（critique P0-2）：dbt 全文日志不得直灌处理说明/事件等
 * 人工字段——多行输出收敛为行数 + FAIL 摘要，短消息直通。
 */
class ExecutorMessagesTest {

    private static final String DBT_LOG = """
            Running with dbt=1.10.22
            Registered adapter: doris=1.0.0
            Found 35 data tests, 1 seed, 214 models
            14:53:01  Completed successfully
            14:53:02  Failure in test ep_mz_cfzb_not_null_a1b2 (models/staging/ep_mz_cfzb.sql)
            14:53:02    FAIL 42 (rows returned)
            14:53:03  Done. PASS=38 WARN=0 ERROR=1 SKIP=0 TOTAL=39
            """;

    @Test
    void shortMessagesPassThrough() {
        assertThat(ExecutorMessages.summarizeForHumanField(null)).isNull();
        assertThat(ExecutorMessages.summarizeForHumanField("   ")).isNull();
        assertThat(ExecutorMessages.summarizeForHumanField("质量规则未通过")).isEqualTo("质量规则未通过");
        assertThat(ExecutorMessages.summarizeForHumanField("行一\n行二")).isEqualTo("行一\n行二");
    }

    @Test
    void multiLineExecutorLogBecomesBoundedSummary() {
        var summary = ExecutorMessages.summarizeForHumanField(DBT_LOG);
        assertThat(summary)
                .startsWith("执行器输出 7 行")
                .contains("Failure in test ep_mz_cfzb_not_null_a1b2")
                .doesNotContain("Running with dbt=")
                .doesNotContain("Registered adapter");
        assertThat(summary.length()).isLessThanOrEqualTo(500);
    }

    @Test
    void summaryCapsFailLinesAndLength() {
        var manyFails = "header\n" + String.join("\n",
                java.util.stream.IntStream.rangeClosed(1, 9)
                        .mapToObj(i -> "FAIL line " + i + " ".repeat(150) + "x")
                        .toArray(String[]::new));
        var summary = ExecutorMessages.summarizeForHumanField(manyFails);
        // 只取前 3 条 FAIL，单条 120 字符截断，总长 500 封顶。
        assertThat(summary).contains("执行器输出 10 行");
        assertThat(summary.split("；", -1)).hasSize(3);
        assertThat(summary.length()).isLessThanOrEqualTo(500);
    }
}
