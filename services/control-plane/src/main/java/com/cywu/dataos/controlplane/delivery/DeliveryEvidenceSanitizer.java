package com.cywu.dataos.controlplane.delivery;

import java.util.List;
import java.util.regex.Pattern;

/**
 * 证据包白名单防线（G25-4）：对序列化后的 manifest 全文做禁含内容扫描，
 * 命中即拒绝生成快照（fail-closed）。防线针对两类风险：① 采集器将来误把
 * 系统持有的机密/行级口径字段带进 manifest（sqlTemplate、参数 JSON、连接串、
 * 凭据词）；② 用户在项目文案里自行粘贴连接串或患者标识。命中属编程或输入
 * 问题，修好后重试，而不是静默裁剪。
 */
final class DeliveryEvidenceSanitizer {

    /** 字段名/协议/凭据词（大小写不敏感）。 */
    private static final List<Pattern> FORBIDDEN = List.of(
            Pattern.compile("(?i)sql[_ ]?template"),
            Pattern.compile("(?i)parameters[_ ]?json"),
            Pattern.compile("(?i)columns[_ ]?json"),
            Pattern.compile("(?i)jdbc:"),
            Pattern.compile("(?i)mysql://"),
            Pattern.compile("(?i)postgresql://"),
            Pattern.compile("(?i)https?://[^\\s/\"@]+:[^\\s/\"@]+@"),  // URL 内嵌用户口令（userinfo）
            Pattern.compile("(?i)password"),
            Pattern.compile("(?i)secret"),
            Pattern.compile("(?i)\\bbearer\\b"),
            Pattern.compile("(?i)api[_-]?key"),
            Pattern.compile("(?i)access[_-]?token"),
            Pattern.compile("(?i)refresh[_-]?token"),
            Pattern.compile("(?i)idempotency[_-]?key"));

    /** 连续 15 位以上数字（身份证/证件号形态；时间戳 ISO 字符串不会命中）。 */
    private static final Pattern LONG_DIGIT_RUN = Pattern.compile("\\d{15,}");

    private DeliveryEvidenceSanitizer() {
    }

    /** 校验 manifest 全文；违规抛 IllegalStateException（消息面向修复）。 */
    static void assertWhitelisted(String manifestJson) {
        for (Pattern pattern : FORBIDDEN) {
            var matcher = pattern.matcher(manifestJson);
            if (matcher.find()) {
                throw new IllegalStateException(
                        "证据包内容违反白名单（疑似 " + pattern.pattern() + "）：交付证据不得包含 SQL 模板、"
                                + "连接串、凭据或幂等键，请检查交付项文案后重试");
            }
        }
        if (LONG_DIGIT_RUN.matcher(manifestJson).find()) {
            throw new IllegalStateException(
                    "证据包内容违反白名单（疑似患者标识的连续数字串）：请检查交付范围/备注文案后重试");
        }
    }
}
