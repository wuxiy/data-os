package com.cywu.dataos.controlplane.dataservice;

import java.util.HashSet;
import java.util.Locale;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * 发布前 SQL 模板静态校验（G13 方案 §三）：只允许单条参数化 SELECT。
 * 校验规则：
 * <ul>
 *   <li>去注释后必须以 SELECT 或 WITH 开头；</li>
 *   <li>不允许出现分号（多语句/ stacked query 一律拒绝）；</li>
 *   <li>词边界匹配拒绝 DML/DDL/会话关键字；</li>
 *   <li>模板中的 {@code :name} 占位与参数契约声明必须一一对应。</li>
 * </ul>
 * 参数值本身由执行面经 pymysql 绑定传输，不经此校验拼入。
 */
public final class SqlTemplateValidator {

    private static final Pattern PLACEHOLDER = Pattern.compile(":([A-Za-z_][A-Za-z0-9_]*)");
    private static final Pattern FORBIDDEN = Pattern.compile(
            "\\b(insert|update|delete|merge|create|alter|drop|truncate|grant|revoke|set|call|exec|use|load|export|into outfile)\\b",
            Pattern.CASE_INSENSITIVE);
    private static final Pattern LINE_COMMENT = Pattern.compile("--[^\\n]*");
    private static final Pattern BLOCK_COMMENT = Pattern.compile("/\\*.*?\\*/", Pattern.DOTALL);

    private SqlTemplateValidator() {
    }

    /** 返回拒绝原因，null 表示通过。 */
    public static String validate(String sqlTemplate, Set<String> declaredParameters) {
        if (sqlTemplate == null || sqlTemplate.isBlank()) {
            return "SQL 模板不能为空";
        }
        var stripped = BLOCK_COMMENT.matcher(LINE_COMMENT.matcher(sqlTemplate).replaceAll(" ")).replaceAll(" ").trim();
        var lowered = stripped.toLowerCase(Locale.ROOT);
        if (!(lowered.startsWith("select") || lowered.startsWith("with"))) {
            return "SQL 模板必须以 SELECT 或 WITH 开头（只允许参数化查询）";
        }
        if (sqlTemplate.contains(";")) {
            return "SQL 模板不允许出现分号（多语句被拒绝）";
        }
        Matcher forbidden = FORBIDDEN.matcher(stripped);
        if (forbidden.find()) {
            return "SQL 模板包含被拒绝的关键字: " + forbidden.group(1).toUpperCase(Locale.ROOT);
        }
        Set<String> used = new HashSet<>();
        Matcher placeholder = PLACEHOLDER.matcher(stripped);
        while (placeholder.find()) {
            used.add(placeholder.group(1));
        }
        if (!used.equals(new HashSet<>(declaredParameters))) {
            Set<String> missing = new HashSet<>(declaredParameters);
            missing.removeAll(used);
            Set<String> undeclared = new HashSet<>(used);
            undeclared.removeAll(declaredParameters);
            if (!missing.isEmpty()) {
                return "模板缺少已声明参数的占位: " + String.join(", ", missing);
            }
            return "模板使用了未声明的参数占位: " + String.join(", ", undeclared);
        }
        return null;
    }
}
