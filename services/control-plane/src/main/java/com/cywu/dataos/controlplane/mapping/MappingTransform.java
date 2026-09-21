package com.cywu.dataos.controlplane.mapping;

import java.util.regex.Pattern;

/**
 * 受控转换白名单（G23）：COPY / TRIM / UPPER / DATE_FORMAT / VALUE_MAP。
 * 禁止任意 SQL、脚本或表达式——param 只承载声明性数据（格式串或值映射 JSON），
 * 质量执行器侧对列名与数据集再做二次校验后按固定模板聚合。
 */
public enum MappingTransform {
    COPY,
    TRIM,
    UPPER,
    DATE_FORMAT,
    VALUE_MAP;

    private static final Pattern FORMAT_PATTERN = Pattern.compile("^[yYMdDHhmsS\\-/:. T]{1,32}$");

    /** 校验 param 形态与目标数据元类型约束；返回归一化后的 param（VALUE_MAP 键序稳定）。 */
    public String validateParam(String param, String targetElementType) {
        var value = param == null ? "" : param.trim();
        return switch (this) {
            case COPY, TRIM, UPPER -> {
                if (!value.isEmpty()) {
                    throw new IllegalArgumentException(name() + " 不携带转换参数");
                }
                if (this != COPY && !"STRING".equals(targetElementType)) {
                    throw new IllegalArgumentException(name() + " 目标必须是 STRING 数据元");
                }
                yield "";
            }
            case DATE_FORMAT -> {
                if (value.isEmpty() || !FORMAT_PATTERN.matcher(value).matches()) {
                    throw new IllegalArgumentException("DATE_FORMAT 参数必须是简单日期格式串（如 yyyy-MM-dd）");
                }
                if (!"DATE".equals(targetElementType) && !"DATETIME".equals(targetElementType)) {
                    throw new IllegalArgumentException("DATE_FORMAT 目标必须是 DATE/DATETIME 数据元");
                }
                yield value;
            }
            case VALUE_MAP -> {
                if (!"CODE".equals(targetElementType)) {
                    throw new IllegalArgumentException("VALUE_MAP 目标必须是 CODE 数据元");
                }
                yield value; // 结构（{源值: 标准值}）由服务层对照值域校验
                }
        };
    }
}
