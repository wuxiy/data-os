package com.cywu.dataos.mpi.identity;

/**
 * 源身份（CONTEXT.md「患者主索引」）：机构 × 源系统 × 源主键的复合键。
 * 管道符格式「机构|源系统|源主键」的唯一属主——SQL 投影片段与 Java 解析
 * 在这里同源声明，调用方不再手工拼写 CONCAT 或 split。任何一侧改格式
 * （如源键含管道符需转义、身份加入新分量）只动这里。
 */
public record SourceIdentity(String institutionCode, String sourceSystem, String sourceKey) {

    public SourceIdentity {
        if (institutionCode == null || institutionCode.isBlank()
                || sourceSystem == null || sourceSystem.isBlank()
                || sourceKey == null || sourceKey.isBlank()) {
            throw new IllegalArgumentException("源身份三段均不能为空");
        }
        if (institutionCode.contains("|") || sourceSystem.contains("|") || sourceKey.contains("|")) {
            throw new IllegalArgumentException("源身份各段不得包含分隔符 |");
        }
    }

    /** 从落库标识解析；格式不合法立即失败（比下标取段更可诊断）。 */
    public static SourceIdentity parse(String identityGroup) {
        var parts = identityGroup == null ? new String[0] : identityGroup.split("\\|", -1);
        if (parts.length != 3) {
            throw new IllegalArgumentException("非法源身份标识（应为 机构|源系统|源主键）：" + identityGroup);
        }
        return new SourceIdentity(parts[0], parts[1], parts[2]);
    }

    /** 落库标识（mpi_source_identity.source_identifier / candidate_pair.identity_*）。 */
    public String identityGroup() {
        return institutionCode + "|" + sourceSystem + "|" + sourceKey;
    }

    /** SQL 侧投影：mpi_source_identity 三列按属主格式拼接；alias 可空（无别名查询）。 */
    public static String sqlProjection(String alias) {
        var prefix = alias == null || alias.isBlank() ? "" : alias.trim() + ".";
        return "CONCAT(" + prefix + "institution_code, '|', "
                + prefix + "source_system, '|', " + prefix + "source_key)";
    }
}
