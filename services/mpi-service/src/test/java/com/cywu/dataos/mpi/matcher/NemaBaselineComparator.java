package com.cywu.dataos.mpi.matcher;

/**
 * nema empi 实战参数基线（G2G 批次 6）：一代平台 7 条相似度修正规则 +
 * 双阈值（linkTh 0.9 / suspectTh 0.5）以 data-os 字段口径重写，用于与
 * T5 混合决策对拍（cross-check），不作运行时配置。
 *
 * <p>口径裁决（docs/g2g-batch6-mpi-baseline-plan-20261005.md）：证件
 * ZJHM↔card、电话 LXFS↔contactHash、姓名 XM↔name；出生日期不在
 * data-os 匹配面——SAME_ZJHM_LXFS_CSRQ 退化为 证件+电话，含
 * DIFF_ZJHM_CSRQ 的生日类规则不移植。nema 模型带（RF/加权平均分数）
 * 不可移植：规则未命中的对记 {@link NemaBand#UNCOVERED}，不参与一致性
 * 统计（不伪造模型分）。</p>
 *
 * <p>出处：nema products/identity/empi empi-common AlgoParam/FixRuleType、
 * empi-algo AlgoConstants（DEFAULT_LINK_TH=0.9 / DEFAULT_SUSPECT_TH=0.5）。
 * TOO_HIGH/TOO_LOW 依赖模型分数形态（相似度恰为 1/0 的线性修正），FS
 * 分数无此形态，不移植。</p>
 */
final class NemaBaselineComparator {

    /** nema 实战双阈值（AlgoConstants 默认值，一代生产沿用）。 */
    static final double LINK_TH = 0.9;
    static final double SUSPECT_TH = 0.5;

    /** nema 三带：LINK↔AUTO_MATCH、SUSPECT↔REVIEW、DIFFERENT↔NO_MATCH；UNCOVERED=规则不可判定。 */
    enum NemaBand {
        LINK, SUSPECT, DIFFERENT, UNCOVERED
    }

    record NemaDecision(String ruleId, NemaBand band) {
    }

    NemaDecision evaluate(MatchPair pair) {
        var a = pair.a();
        var b = pair.b();
        boolean sameName = nonBlankSame(a.name(), b.name());
        boolean sameCard = nonBlankSame(a.card(), b.card());
        boolean diffCard = nonBlankDifferent(a.card(), b.card());
        boolean diffName = nonBlankDifferent(a.name(), b.name());
        boolean sameContact = pair.contactSame();

        // 规则序即 nema FixRuleFactory 应用序：SAME 类→1.0（≥LINK_TH）。
        if (sameName && sameCard) {
            return new NemaDecision("SAME_XM_ZJHM", NemaBand.LINK);
        }
        if (sameName && sameContact) {
            return new NemaDecision("SAME_XM_LXFS", NemaBand.LINK);
        }
        // nema 原语义 证件+电话+出生日期→1；出生日期不在匹配面，退化为 证件+电话。
        if (sameCard && sameContact) {
            return new NemaDecision("SAME_ZJHM_LXFS", NemaBand.LINK);
        }
        // DIFF 类→0.0（<SUSPECT_TH）。
        if (diffCard && diffName) {
            return new NemaDecision("DIFF_ZJHM_XM", NemaBand.DIFFERENT);
        }
        // nema 模型带不可复现（FS 对数似然与 [0,1] 相似度不同构）：诚实记 UNCOVERED。
        return new NemaDecision("MODEL_BAND", NemaBand.UNCOVERED);
    }

    private static boolean nonBlankSame(String a, String b) {
        return a != null && !a.isBlank() && a.equals(b);
    }

    private static boolean nonBlankDifferent(String a, String b) {
        if (a == null || a.isBlank() || b == null || b.isBlank()) return false;
        return !a.equals(b);
    }
}
