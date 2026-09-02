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
import com.cywu.dataos.mpi.matcher.MpiScoreMatcher;
import com.cywu.dataos.mpi.matcher.MpiWeights;
import com.cywu.dataos.mpi.matcher.Outcome;
import com.cywu.dataos.mpi.person.MpiPersonService;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * 决策编排：候选对 → Hard Constraint 前置 → T5 混合引擎判定 → 三态分派。
 * AUTO_MATCH 自动建/并黄金人；REVIEW 生成复核任务（人工已裁决的 pair
 * 不再重建）；否决带（V2 分数 < tVeto）把规则层的复核对直接判 NO_MATCH。
 * match_result 每轮全量重算（先清后写），人工终态（复核决议）在 PG，
 * 不受重算影响。
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

    private static final String HYBRID_RULES_JSON_SNAPSHOT = """
            {"rules":["M-ep1","M-ep2","P-ep1","P-ep2","P-fallback",
                      "P-ep1/V2-VETO","P-ep2/V2-VETO","P-fallback/V2-VETO","H-ep1","H-ep2"],
             "blocking":["B3","B4","B6(contact)"],
             "policy":"conjunction-guards-decide-auto; fs-score-vetoes-review-below-tVeto=0.42; hard-constraint-first"}""";

    static final String INSERT_RULE_VERSION = """
            INSERT INTO data_os_mpi.mpi_rule_version
              (version, description, rules_json, activated_by, activated_at)
            SELECT ?, ?, ?, 'system', CURRENT_TIMESTAMP
            WHERE NOT EXISTS (SELECT 1 FROM data_os_mpi.mpi_rule_version WHERE version = ?)
            """;

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
        // G15 决策权切换：T5 混合引擎（V1 合取守卫定 AUTO + V2 分数否决带）
        // 为生产判定引擎；评测与 dev 影子核验见 docs/validation/
        // gate-mpi-g15-20260902.md。纯 V2 三态保留为对照证据行。
        var weights = MpiWeights.packaged().withNameUFrequency(loadNameFrequency(tenantId));
        var scoreMatcher = new MpiScoreMatcher(weights);
        var hybridMatcher = new MpiHybridMatcher(matcher, scoreMatcher, weights.tVeto());
        for (var row : pairs) {
            var pair = row.matchPair();
            var a = pair.a();
            String ruleId;
            Outcome outcome;
            List<EvidenceItem> ruleEvidence;
            if (audit.rejectedAsDifferentPerson(tenantId, row.pairId())) {
                // H-ep1：人工已判不同人——最高优先级否决（高于混合引擎）。
                ruleId = "H-ep1";
                outcome = Outcome.HARD_CONFLICT;
                ruleEvidence = List.of();
                hard++;
            } else if (audit.separatedBySplit(tenantId, row.identityA(), row.identityB())) {
                // H-ep2：人工已拆开——永不再自动合并（高于混合引擎）。
                ruleId = "H-ep2";
                outcome = Outcome.HARD_CONFLICT;
                ruleEvidence = List.of();
                hard++;
            } else {
                var decision = hybridMatcher.evaluate(pair);
                ruleId = decision.ruleId();
                outcome = decision.outcome();
                ruleEvidence = decision.ruleEvidence();
            }
            var shadow = scoreMatcher.evaluate(pair);
            List<EvidenceItem> evidence = new ArrayList<>(ruleEvidence);
            evidence.add(new EvidenceItem("v2Score",
                    String.valueOf(shadow.score()), shadow.outcome().name(),
                    shadow.outcome() == outcome));
            switch (outcome) {
                case AUTO_MATCH -> {
                    auto++;
                    persons.applyAutoMatch(tenantId, institutionId, row.pairId(), row.identityA(),
                            row.identityB(), a.name(), a.gender(), ruleId,
                            hybridMatcher.version());
                }
                case REVIEW -> {
                    review++;
                    if (!pairsWithTask.contains(row.pairId())) {
                        pg.update(INSERT_REVIEW_TASK, UUID.randomUUID().toString(), tenantId,
                                institutionId, row.pairId());
                        pairsWithTask.add(row.pairId());
                    }
                }
                case NO_MATCH -> noMatch++;
                default -> { /* HARD_CONFLICT 已在上方计入 hard */ }
            }
            resultBatch.add(new Object[] {row.pairId(), tenantId, row.identityA(), row.identityB(),
                    ruleId, hybridMatcher.version(),
                    outcome.name(), writeEvidence(evidence), now});
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

    /** 版本登记：v1 保留为历史版本；v1+v2（现行判定引擎）幂等登记。 */
    private void registerRuleVersion() {
        pg.update(INSERT_RULE_VERSION, MpiRuleMatcher.RULE_VERSION, "EP 适配确定性规则集",
                RULES_JSON_SNAPSHOT, MpiRuleMatcher.RULE_VERSION);
        pg.update(INSERT_RULE_VERSION, MpiHybridMatcher.HYBRID_VERSION,
                "T5 混合：合取守卫定 AUTO + 分数否决带（G15 切换）",
                HYBRID_RULES_JSON_SNAPSHOT, MpiHybridMatcher.HYBRID_VERSION);
    }
}
