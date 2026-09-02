package com.cywu.dataos.mpi.matcher;

import java.util.ArrayList;
import java.util.List;

/**
 * 确定性规则集 v1（EP 适配）。评估顺序即优先级：人工否决（H-ep1/H-ep2
 * 在编排层前置，见 MpiDecisionService）→ M-ep1 → M-ep2 → P-ep1 → P-ep2
 * → 兜底 NO_MATCH。弱标识纪律：卡号/姓名/性别任一单独不构成 AUTO——
 * M 级规则全部要求「机构锚点 + 至少两类属性一致」；错误合并的临床风险
 * 高于漏合并。
 */
public final class MpiRuleMatcher implements PairScorer {

    public static final String RULE_VERSION = "v1";

    /** 证据项：字段对比快照。证件类值必须先掩码（验收红线：明文证件不落库）。 */
    public record EvidenceItem(String field, String valueA, String valueB, boolean match) {
    }

    public record RuleDecision(String ruleId, Outcome outcome, List<EvidenceItem> evidence)
            implements PairDecision {
    }

    @Override
    public String version() {
        return RULE_VERSION;
    }

    @Override
    public RuleDecision evaluate(MatchPair pair) {
        var a = pair.a();
        var b = pair.b();
        var sameInstitution = equalsNullable(a.institution(), b.institution());
        var samePatientId = equalsNullable(a.patientId(), b.patientId());
        var sameCard = a.card() != null && a.card().equals(b.card());
        var sameName = equalsNullable(a.name(), b.name());
        var sameGender = a.gender() != null && a.gender().equals(b.gender())
                && !"U".equals(a.gender());
        var evidence = evidence(pair, sameInstitution, samePatientId, sameCard, sameName, sameGender);

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

    private List<EvidenceItem> evidence(MatchPair pair, boolean sameInstitution, boolean samePatientId,
                                        boolean sameCard, boolean sameName, boolean sameGender) {
        var a = pair.a();
        var b = pair.b();
        List<EvidenceItem> items = new ArrayList<>();
        items.add(new EvidenceItem("institution", a.institution(), b.institution(), sameInstitution));
        items.add(new EvidenceItem("patientId", maskTail(a.patientId()), maskTail(b.patientId()),
                samePatientId));
        items.add(new EvidenceItem("cardNo", maskCard(a.card()), maskCard(b.card()), sameCard));
        items.add(new EvidenceItem("name", a.name(), b.name(), sameName));
        items.add(new EvidenceItem("gender", a.gender(), b.gender(), sameGender));
        items.add(new EvidenceItem("contact", pair.contactSame() ? "SAME" : "DIFF", pair.contactSame() ? "SAME" : "DIFF",
                pair.contactSame()));
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
