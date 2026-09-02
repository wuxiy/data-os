package com.cywu.dataos.mpi.matcher;

/**
 * 候选对统一输入：两代引擎（V1 规则 / V2 评分）共用的标准化属性视图。
 * 联系方式保留哈希原值——评分层据此区分不一致与缺失，规则层的布尔
 * 比较级见 {@link #contactSame()}。
 */
public record MatchPair(Side a, Side b) {

    /** 单侧标准化属性（来自 mpi_source_identity）。 */
    public record Side(String institution, String patientId, String card, String name,
                       String gender, String contactHash) {
    }

    /** 规则层联系方式比较级：任一侧缺失即视为不一致（保守）。 */
    public boolean contactSame() {
        return a.contactHash() != null && a.contactHash().equals(b.contactHash());
    }
}
