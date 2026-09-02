package com.cywu.dataos.mpi.decision;

import java.sql.Timestamp;

import com.cywu.dataos.mpi.identity.SourceIdentity;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.ToDoubleFunction;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

import com.cywu.dataos.mpi.audit.MpiAuditService;
import com.cywu.dataos.mpi.matcher.MatchPair;
import com.cywu.dataos.mpi.matcher.MpiHybridMatcher;
import com.cywu.dataos.mpi.matcher.MpiRuleMatcher;
import com.cywu.dataos.mpi.matcher.MpiRuleMatcher.EvidenceItem;
import com.cywu.dataos.mpi.matcher.MpiRuleMatcher.RuleDecision;
import com.cywu.dataos.mpi.matcher.MpiScoreMatcher;
import com.cywu.dataos.mpi.matcher.MpiWeights;
import com.cywu.dataos.mpi.matcher.Outcome;
import com.cywu.dataos.mpi.person.MpiPersonService;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * 决策编排：候选对 → Hard Constraint 前置 → 规则评估 → 三态分派。
 * AUTO_MATCH 自动建/并黄金人；REVIEW 生成复核任务（人工已裁决的 pair
 * 不再重建）；HARD_CONFLICT 落库但永不建任务。match_result 每轮全量
 * 重算（先清后写），人工终态（复核决议）在 PG，不受重算影响。
 */
@Service
public class MpiDecisionService {

    static final String SELECT_PAIRS_WITH_ATTRIBUTES = """
            SELECT p.pair_id, p.identity_a, p.identity_b,
                   a.institution_code, a.patient_id, a.card_no_norm, a.name_norm, a.gender, a.contact_hash,
                   b.institution_code, b.patient_id, b.card_no_norm, b.name_norm, b.gender, b.contact_hash
            FROM dataos_mpi.mpi_candidate_pair p
            JOIN dataos_mpi.mpi_source_identity a
              ON a.tenant_id = p.tenant_id AND %1$s = p.identity_a
            JOIN dataos_mpi.mpi_source_identity b
              ON b.tenant_id = p.tenant_id AND %2$s = p.identity_b
            WHERE p.tenant_id = ?
            """.formatted(SourceIdentity.sqlProjection("a"), SourceIdentity.sqlProjection("b"));

    static final String CLEAR_RESULTS = "DELETE FROM dataos_mpi.mpi_match_result WHERE tenant_id = ?";

    static final String INSERT_RESULT = """
            INSERT INTO dataos_mpi.mpi_match_result
              (pair_id, tenant_id, identity_a, identity_b, rule_id, rule_version, outcome, evidence, decided_at)
            VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
            """;

    static final String INSERT_REVIEW_TASK = """
            INSERT INTO data_os_mpi.mpi_review_task
              (id, tenant_id, institution_id, pair_id, status, created_at)
            VALUES (?, ?, ?, ?, 'OPEN', CURRENT_TIMESTAMP)
            """;

    private static final String RULES_JSON_SNAPSHOT = """
            {"rules":["M-ep1","M-ep2","P-ep1","P-ep2","H-ep1","H-ep2"],
             "blocking":["B3","B4","B6(contact)"],
             "policy":"hard-constraint-first; weak identifiers never auto-merge alone"}""";

    private final JdbcTemplate doris;
    private final JdbcTemplate pg;
    private final MpiPersonService persons;
    private final MpiAuditService audit;
    private final ObjectMapper objectMapper;

    public MpiDecisionService(@Qualifier("dorisJdbc") JdbcTemplate doris, JdbcTemplate pg,
                              MpiPersonService persons, MpiAuditService audit, ObjectMapper objectMapper) {
        this.doris = doris;
        this.pg = pg;
        this.persons = persons;
        this.audit = audit;
        this.objectMapper = objectMapper;
    }

    public record DecisionStats(int autoMatch, int review, int noMatch, int hardConflict) {
    }

    /** 候选对行：对标识 + 统一输入（行映射器直接构造域形状，无二次胶水）。 */
    public record PairRow(long pairId, String identityA, String identityB, MatchPair matchPair) {
    }

    public DecisionStats decideAll(String tenantId, String institutionId, String actor) {
        registerRuleVersion();
        var pairs = doris.query(SELECT_PAIRS_WITH_ATTRIBUTES, (rs, i) -> new PairRow(
                rs.getLong(1), rs.getString(2), rs.getString(3),
                new MatchPair(
                        new MatchPair.Side(rs.getString(4), rs.getString(5), rs.getString(6),
                                rs.getString(7), rs.getString(8), rs.getString(9)),
                        new MatchPair.Side(rs.getString(10), rs.getString(11), rs.getString(12),
                                rs.getString(13), rs.getString(14), rs.getString(15)))), tenantId);
        doris.update(CLEAR_RESULTS, tenantId);

        // 已有任何复核任务的 pair 不再自动建任务（人工已介入或已裁决）。
        Set<Long> pairsWithTask = new HashSet<>(pg.queryForList(
                "SELECT DISTINCT pair_id FROM data_os_mpi.mpi_review_task WHERE tenant_id = ?",
                Long.class, tenantId));

        var now = Timestamp.from(Instant.now());
        List<Object[]> resultBatch = new ArrayList<>();
        int auto = 0;
        int review = 0;
        int noMatch = 0;
        int hard = 0;
        var matcher = new MpiRuleMatcher();
        // G14 影子评分 + T5 混合影子：决策权仍在规则层（评测结论见
        // docs/validation/gate-mpi-g14-*.md 与 gate-mpi-g15-*.md）；V2 分数
        // 与 T5 混合三态（守卫定 AUTO + 分数否决带）作为证据落库，供复核
        // 排序与决策权切换裁决，不改变本表 outcome。
        var weights = MpiWeights.packaged().withNameUFrequency(loadNameFrequency(tenantId));
        var scoreMatcher = new MpiScoreMatcher(weights);
        var hybridMatcher = new MpiHybridMatcher(matcher, scoreMatcher, weights.tVeto());
        for (var row : pairs) {
            var pair = row.matchPair();
            var a = pair.a();
            RuleDecision decision;
            if (audit.rejectedAsDifferentPerson(tenantId, row.pairId())) {
                // H-ep1：人工已判不同人——最高优先级否决。
                decision = new RuleDecision("H-ep1", Outcome.HARD_CONFLICT,
                        List.of());
                hard++;
            } else if (audit.separatedBySplit(tenantId, row.identityA(), row.identityB())) {
                // H-ep2：人工已拆开——永不再自动合并。
                decision = new RuleDecision("H-ep2", Outcome.HARD_CONFLICT,
                        List.of());
                hard++;
            } else {
                decision = matcher.evaluate(pair);
            }
            var shadow = scoreMatcher.evaluate(pair);
            var hybrid = hybridMatcher.evaluate(pair);
            List<EvidenceItem> evidence = new ArrayList<>(decision.evidence());
            evidence.add(new EvidenceItem("v2Score",
                    String.valueOf(shadow.score()), shadow.outcome().name(),
                    shadow.outcome() == decision.outcome()));
            evidence.add(new EvidenceItem("hybrid",
                    String.valueOf(hybrid.score()),
                    hybrid.outcome().name() + (hybrid.vetoed() ? "/V2-VETO" : ""),
                    hybrid.outcome() == decision.outcome()));
            switch (decision.outcome()) {
                case AUTO_MATCH -> {
                    auto++;
                    persons.applyAutoMatch(tenantId, institutionId, row.pairId(), row.identityA(),
                            row.identityB(), a.name(), a.gender(), decision.ruleId(),
                            MpiRuleMatcher.RULE_VERSION);
                }
                case REVIEW -> {
                    review++;
                    if (!pairsWithTask.contains(row.pairId())) {
                        pg.update(INSERT_REVIEW_TASK, UUID.randomUUID().toString(), tenantId,
                                institutionId, row.pairId());
                        pairsWithTask.add(row.pairId());
                    }
                }
                default -> noMatch++;
            }
            resultBatch.add(new Object[] {row.pairId(), tenantId, row.identityA(), row.identityB(),
                    decision.ruleId(), MpiRuleMatcher.RULE_VERSION,
                    decision.outcome().name(), writeEvidence(evidence), now});
        }
        if (!resultBatch.isEmpty()) {
            doris.batchUpdate(INSERT_RESULT, resultBatch);
        }
        return new DecisionStats(auto, review, noMatch, hard);
    }

    /** 姓名频率 u 细化（运行时从身份表实时计算；未见姓名退回全局 u）。 */
    private ToDoubleFunction<String> loadNameFrequency(String tenantId) {
        var counts = new HashMap<String, Double>();
        long[] total = {0};
        doris.query("""
                SELECT name_norm, COUNT(*) FROM dataos_mpi.mpi_source_identity
                WHERE tenant_id = ? AND name_norm IS NOT NULL AND name_norm <> ''
                GROUP BY name_norm
                """, (rs, row) -> {
            counts.put(rs.getString(1), (double) rs.getLong(2));
            total[0] += rs.getLong(2);
            return null;
        }, tenantId);
        if (total[0] == 0) {
            return name -> MpiWeights.packaged().name().uAgree();
        }
        double denominator = total[0];
        double fallback = counts.values().stream().mapToDouble(Double::doubleValue).average()
                .orElse(MpiWeights.packaged().name().uAgree()) / denominator;
        return name -> counts.getOrDefault(name, fallback) / denominator;
    }

    private String writeEvidence(Object evidence) {
        try {
            return objectMapper.writeValueAsString(evidence);
        } catch (Exception exception) {
            throw new IllegalStateException("证据序列化失败", exception);
        }
    }

    private void registerRuleVersion() {
        pg.update("""
                INSERT INTO data_os_mpi.mpi_rule_version
                  (version, description, rules_json, activated_by, activated_at)
                SELECT ?, 'EP 适配确定性规则集', ?, 'system', CURRENT_TIMESTAMP
                WHERE NOT EXISTS (SELECT 1 FROM data_os_mpi.mpi_rule_version WHERE version = ?)
                """, MpiRuleMatcher.RULE_VERSION, RULES_JSON_SNAPSHOT, MpiRuleMatcher.RULE_VERSION);
    }
}
