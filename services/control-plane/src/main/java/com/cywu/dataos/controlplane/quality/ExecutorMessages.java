package com.cywu.dataos.controlplane.quality;

import java.util.ArrayList;
import java.util.Locale;

/**
 * 执行器输出进人工字段（处理说明/治理事件）前的摘要（2026-10-05 critique P0-2）：
 * 运行记录保留全文，人工字段只落「行数 + 失败摘要」——此前 dbt 控制台全文
 * 直灌 processingNote，责任人提交时会把执行器日志当处理结论存回审计链。
 */
public final class ExecutorMessages {

    private ExecutorMessages() {
    }

    /** 单行/双行短文直通；多行输出收敛为行数 + 前三条 FAIL 摘要，尾部截断到 500 字符。 */
    public static String summarizeForHumanField(String raw) {
        if (raw == null || raw.isBlank()) {
            return null;
        }
        var text = raw.strip();
        var lines = text.split("\n", -1);
        if (lines.length <= 2 && text.length() <= 160) {
            return text;
        }
        var fails = new ArrayList<String>();
        for (var line : lines) {
            var stripped = line.strip();
            // 大小写不敏感：dbt 同时产出「Failure in test …」与「FAIL 42 (rows…)」两种形态。
            if (!stripped.isEmpty() && stripped.toLowerCase(java.util.Locale.ROOT).contains("fail")) {
                fails.add(stripped.length() > 120 ? stripped.substring(0, 120) + "…" : stripped);
                if (fails.size() == 3) {
                    break;
                }
            }
        }
        var summary = new StringBuilder("执行器输出 ").append(lines.length).append(" 行（完整内容见质量运行记录）");
        if (!fails.isEmpty()) {
            summary.append("：").append(String.join("；", fails));
        }
        return summary.length() <= 500 ? summary.toString() : summary.substring(0, 500);
    }
}
