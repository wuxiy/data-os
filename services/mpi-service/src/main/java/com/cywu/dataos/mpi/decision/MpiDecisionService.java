package com.cywu.dataos.mpi.decision;

import java.sql.Timestamp;
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
import com.cywu.dataos.mpi.matcher.MpiRuleMatcher;
import com.cywu.dataos.mpi.matcher.MpiScoreMatcher;
import com.cywu.dataos.mpi.matcher.MpiWeights;
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
              ON a.tenant_id = p.tenant_id AND CONCAT(a.institution_code, '|', a.source_system, '|', a.source_key) = p.identity_a
            JOIN dataos_mpi.mpi_source_identity b
              ON b.tenant_id = p.tenant_id AND CONCAT(b.institution_code, '|', b.source_system, '|', b.source_key) = p.identity_b
            WHERE p.tenant_id = ?
            """;

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

    public record PairRow(long pairId, String identityA, String identityB,
                          String institutionA, String patientIdA, String cardA, String nameA,
                          String genderA, String contactHashA,
                          String institutionB, String patientIdB, String cardB, String nameB,
                          String genderB, String contactHashB) {

        MpiRuleMatcher.PairAttributes toAttributes() {
            var contactSame = contactHashA != null && contactHashA.equals(contactHashB);
            return new MpiRuleMatcher.PairAttributes(institutionA, patientIdA, cardA, nameA, genderA,
                    contactSame, institutionB, patientIdB, cardB, nameB, genderB);
        }
    }

    public DecisionStats decideAll(String tenantId, String institutionId, String actor) {
        registerRuleVersion();
        var pairs = doris.query(SELECT_PAIRS_WITH_ATTRIBUTES, (rs, i) -> new PairRow(
                rs.getLong(1), rs.getString(2), rs.getString(3),
                rs.getString(4), rs.getString(5), rs.getString(6), rs.getString(7), rs.getString(8),
                rs.getString(9),
                rs.getString(10), rs.getString(11), rs.getString(12), rs.getString(13),
                rs.getString(14), rs.getString(15)), tenantId);
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
        // G14 影子评分：决策权仍在规则层（评测结论：加性 FS 自动化率低于合取
        // 规则，见 docs/validation/gate-mpi-g14-*.md）；V2 分数与三态作为证据
        // 落库，供复核排序与后续策略裁决，不改变本表 outcome。
        var scoreMatcher = new MpiScoreMatcher(
                MpiWeights.packaged().withNameUFrequency(loadNameFrequency(tenantId)));
        for (var pair : pairs) {
            MpiRuleMatcher.RuleDecision decision;
            if (audit.rejectedAsDifferentPerson(tenantId, pair.pairId())) {
                // H-ep1：人工已判不同人——最高优先级否决。
                decision = new MpiRuleMatcher.RuleDecision("H-ep1", MpiRuleMatcher.Outcome.HARD_CONFLICT,
                        List.of());
                hard++;
            } else if (audit.separatedBySplit(tenantId, pair.identityA(), pair.identityB())) {
                // H-ep2：人工已拆开——永不再自动合并。
                decision = new MpiRuleMatcher.RuleDecision("H-ep2", MpiRuleMatcher.Outcome.HARD_CONFLICT,
                        List.of());
                hard++;
            } else {
                decision = matcher.evaluate(pair.toAttributes());
            }
            var shadow = scoreMatcher.evaluate(new MpiScoreMatcher.ScorePair(
                    pair.cardA(), pair.nameA(), pair.genderA(), pair.contactHashA(),
                    pair.cardB(), pair.nameB(), pair.genderB(), pair.contactHashB()));
            List<MpiRuleMatcher.EvidenceItem> evidence = new ArrayList<>(decision.evidence());
            evidence.add(new MpiRuleMatcher.EvidenceItem("v2Score",
                    String.valueOf(shadow.score()), shadow.outcome().name(),
                    shadow.outcome() == decision.outcome()));
            switch (decision.outcome()) {
                case AUTO_MATCH -> {
                    auto++;
                    persons.applyAutoMatch(tenantId, institutionId, pair.pairId(), pair.identityA(),
                            pair.identityB(), pair.nameA(), pair.genderA(), decision.ruleId(),
                            MpiRuleMatcher.RULE_VERSION);
                }
                case REVIEW -> {
                    review++;
                    if (!pairsWithTask.contains(pair.pairId())) {
                        pg.update(INSERT_REVIEW_TASK, UUID.randomUUID().toString(), tenantId,
                                institutionId, pair.pairId());
                        pairsWithTask.add(pair.pairId());
                    }
                }
                default -> noMatch++;
            }
            resultBatch.add(new Object[] {pair.pairId(), tenantId, pair.identityA(), pair.identityB(),
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
