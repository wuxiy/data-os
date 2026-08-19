package com.cywu.dataos.mpi.matcher;

import java.util.ArrayList;
import java.util.List;

/**
 * 确定性规则集 v1（EP 适配）。评估顺序即优先级：人工否决（调用方先行，
 * 见 MpiHardConstraint）→ M-ep1 → M-ep2 → P-ep1 → P-ep2 → 兜底 NO_MATCH。
 * 弱标识纪律：卡号/姓名/性别任一单独不构成 AUTO——M 级规则全部要求
 * 「机构锚点 + 至少两类属性一致」；错误合并的临床风险高于漏合并。
 */
public final class MpiRuleMatcher {

    public static final String RULE_VERSION = "v1";

    public enum Outcome {
        AUTO_MATCH, REVIEW, NO_MATCH, HARD_CONFLICT
    }

    /** 证据项：字段对比快照。证件类值必须先掩码（验收红线：明文证件不落库）。 */
    public record EvidenceItem(String field, String valueA, String valueB, boolean match) {
    }

    public record RuleDecision(String ruleId, Outcome outcome, List<EvidenceItem> evidence) {
    }

    /** 候选对两侧的标准化属性（来自 mpi_source_identity）。 */
    public record PairAttributes(String institutionA, String patientIdA, String cardA, String nameA,
                                 String genderA, boolean contactSame,
                                 String institutionB, String patientIdB, String cardB, String nameB,
                                 String genderB) {
    }

    public RuleDecision evaluate(PairAttributes p) {
        var sameInstitution = equalsNullable(p.institutionA(), p.institutionB());
        var samePatientId = equalsNullable(p.patientIdA(), p.patientIdB());
        var sameCard = p.cardA() != null && p.cardA().equals(p.cardB());
        var sameName = equalsNullable(p.nameA(), p.nameB());
        var sameGender = p.genderA() != null && p.genderA().equals(p.genderB())
                && !"U".equals(p.genderA());
        var evidence = evidence(p, sameInstitution, samePatientId, sameCard, sameName, sameGender);

        // M-ep1：同机构 + 同患者主键（跨源）+ 姓名 + 性别一致。
        if (sameInstitution && samePatientId && sameName && sameGender) {
            return new RuleDecision("M-ep1", Outcome.AUTO_MATCH, evidence);
        }
        // M-ep2：同机构 + 同卡号 + 姓名 + 性别一致。
        if (sameInstitution && sameCard && sameName && sameGender) {
            return new RuleDecision("M-ep2", Outcome.AUTO_MATCH, evidence);
        }
        // P-ep1：同机构 + 同卡号 + 姓名或性别冲突（卡号复用，宁可复核不可错并）。
        if (sameInstitution && sameCard && (!sameName || !sameGender)) {
            return new RuleDecision("P-ep1", Outcome.REVIEW, evidence);
        }
        // P-ep2：姓名 + 性别一致但卡号互异/缺失（B6 场景）。
        if (sameName && sameGender && !sameCard) {
            return new RuleDecision("P-ep2", Outcome.REVIEW, evidence);
        }
        // 兜底：召回但无规则覆盖（如跨源同主键但姓名冲突）→ 复核而非拒绝。
        return new RuleDecision("P-fallback", sameName || samePatientId ? Outcome.REVIEW : Outcome.NO_MATCH,
                evidence);
    }

    private List<EvidenceItem> evidence(PairAttributes p, boolean sameInstitution, boolean samePatientId,
                                        boolean sameCard, boolean sameName, boolean sameGender) {
        List<EvidenceItem> items = new ArrayList<>();
        items.add(new EvidenceItem("institution", p.institutionA(), p.institutionB(), sameInstitution));
        items.add(new EvidenceItem("patientId", maskTail(p.patientIdA()), maskTail(p.patientIdB()),
                samePatientId));
        items.add(new EvidenceItem("cardNo", maskCard(p.cardA()), maskCard(p.cardB()), sameCard));
        items.add(new EvidenceItem("name", p.nameA(), p.nameB(), sameName));
        items.add(new EvidenceItem("gender", p.genderA(), p.genderB(), sameGender));
        items.add(new EvidenceItem("contact", p.contactSame() ? "SAME" : "DIFF", p.contactSame() ? "SAME" : "DIFF",
                p.contactSame()));
        return items;
    }

    /** 证件号掩码：保留前 6 位（行政区划）与后 4 位，中段以 * 折叠。 */
    public static String maskCard(String card) {
        if (card == null || card.length() <= 10) return card == null ? null : "***";
        return card.substring(0, 6) + "****" + card.substring(card.length() - 4);
    }

    private static String maskTail(String value) {
        if (value == null) return null;
        return value.length() <= 2 ? "**" : value.charAt(0) + "***";
    }

    private static boolean equalsNullable(String a, String b) {
        return a != null && a.equals(b);
    }
}
