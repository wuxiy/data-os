package com.cywu.dataos.mpi.candidate;

import java.sql.Timestamp;
import java.time.Instant;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;

import org.springframework.beans.factory.annotation.Qualifier;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.jdbc.core.JdbcTemplate;
import org.springframework.stereotype.Service;

/**
 * 候选召回（Blocking）：三条确定性规则在 mpi_source_identity 上自 JOIN 找对。
 * Blocking 只负责召回——判定完全交给规则层；跨召回规则按身份组对去重。
 * 身份组标识 = source_system|source_key（复合，保证跨源同主键是两个身份）。
 */
@Service
@ConditionalOnProperty(name = "data-os.mpi.doris.url")
public class MpiBlockingService {

    /** B3：同机构、同患者主键、跨源系统（EP 单源恒 0 对，规则为多源就绪）。 */
    static final String BLOCK_B3 = """
            SELECT CONCAT(a.source_system, '|', a.source_key), CONCAT(b.source_system, '|', b.source_key)
            FROM dataos_mpi.mpi_source_identity a
            JOIN dataos_mpi.mpi_source_identity b
              ON a.tenant_id = b.tenant_id AND a.institution_code = b.institution_code
             AND a.patient_id = b.patient_id AND a.source_system < b.source_system
            WHERE a.tenant_id = ?
            """;

    /** B4：同机构、归一卡号相同（卡号复用是 EP 真实形态，P-ep1 的召回来源）。 */
    static final String BLOCK_B4 = """
            SELECT CONCAT(a.source_system, '|', a.source_key), CONCAT(b.source_system, '|', b.source_key)
            FROM dataos_mpi.mpi_source_identity a
            JOIN dataos_mpi.mpi_source_identity b
              ON a.tenant_id = b.tenant_id AND a.institution_code = b.institution_code
             AND a.card_no_norm IS NOT NULL AND a.card_no_norm = b.card_no_norm
             AND CONCAT(a.source_system, '|', a.source_key) < CONCAT(b.source_system, '|', b.source_key)
            WHERE a.tenant_id = ?
            """;

    /** B6'：同名同性别（EP 无出生日期的替代召回；性别缺失 U 不召回，防同名噪声）。 */
    static final String BLOCK_B6 = """
            SELECT CONCAT(a.source_system, '|', a.source_key), CONCAT(b.source_system, '|', b.source_key)
            FROM dataos_mpi.mpi_source_identity a
            JOIN dataos_mpi.mpi_source_identity b
              ON a.tenant_id = b.tenant_id
             AND a.name_norm = b.name_norm AND a.gender = b.gender
             AND a.gender IN ('M', 'F')
             AND CONCAT(a.source_system, '|', a.source_key) < CONCAT(b.source_system, '|', b.source_key)
            WHERE a.tenant_id = ?
            """;

    static final String INSERT_PAIR = """
            INSERT INTO dataos_mpi.mpi_candidate_pair
              (pair_id, tenant_id, identity_a, identity_b, blocking_rule, generated_at)
            VALUES (?, ?, ?, ?, ?, ?)
            """;

    private static final int BATCH_SIZE = 500;

    private final JdbcTemplate doris;

    public MpiBlockingService(@Qualifier("dorisJdbc") JdbcTemplate doris) {
        this.doris = doris;
    }

    public record BlockingResult(int totalPairs, int byB3, int byB4, int byB6) {
    }

    private record PairKey(String a, String b) {
    }

    public BlockingResult generate(String tenantId) {
        // 跨规则去重：保留字典序最小的召回规则（B3 < B4 < B6）。
        Map<PairKey, String> deduped = new LinkedHashMap<>();
        for (var rule : List.of("B3", "B4", "B6")) {
            String sql = switch (rule) {
                case "B3" -> BLOCK_B3;
                case "B4" -> BLOCK_B4;
                default -> BLOCK_B6;
            };
            doris.query(sql, (rs, i) -> {
                var left = rs.getString(1);
                var right = rs.getString(2);
                var first = left.compareTo(right) <= 0 ? left : right;
                var second = left.compareTo(right) <= 0 ? right : left;
                deduped.putIfAbsent(new PairKey(first, second), rule);
                return null;
            }, tenantId);
        }
        var now = Timestamp.from(Instant.now());
        List<Object[]> batch = new ArrayList<>();
        for (var entry : deduped.entrySet()) {
            batch.add(new Object[] {
                    MpiPairId.of(tenantId, entry.getKey().a(), entry.getKey().b()), tenantId,
                    entry.getKey().a(), entry.getKey().b(), entry.getValue(), now});
        }
        for (int start = 0; start < batch.size(); start += BATCH_SIZE) {
            doris.batchUpdate(INSERT_PAIR, batch.subList(start, Math.min(start + BATCH_SIZE, batch.size())));
        }
        return new BlockingResult(deduped.size(),
                countRule(deduped, "B3"), countRule(deduped, "B4"), countRule(deduped, "B6"));
    }

    private static int countRule(Map<PairKey, String> deduped, String rule) {
        return (int) deduped.values().stream().filter(rule::equals).count();
    }
}
