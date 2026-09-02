package com.cywu.dataos.mpi.audit;

import java.util.List;
import java.util.Map;

/**
 * 审计事件的具名工厂：每个业务动作的 detail 形状与 subject 口径在此一次
 * 声明（此前 5 个写方手工拼 Map、读方以字符串键跨包对齐——改名编译期
 * 无感知）。H-ep2 的事实源键 {@link #KEY_SEPARATED_IDENTITIES} 读写同源。
 */
public final class MpiAuditEvents {

    /** SPLIT 事件的分离集合键：MpiAuditService.separatedBySplit（H-ep2）按此读取。 */
    public static final String KEY_SEPARATED_IDENTITIES = "separatedIdentities";

    private MpiAuditEvents() {
    }

    /** 规则自动匹配（subject=PAIR）。 */
    public static void autoMatch(MpiAuditService audit, String tenantId, String institutionId,
                                 long pairId, String ruleId, String personId,
                                 List<String> identities, String ruleVersion) {
        audit.append(tenantId, institutionId, "AUTO_MATCH", "system", "SYSTEM",
                "PAIR", String.valueOf(pairId),
                Map.of("ruleId", ruleId, "personId", personId, "identities", identities),
                ruleVersion);
    }

    /** 人工并人（subject=PERSON，keep 为主体）。 */
    public static void merge(MpiAuditService audit, String tenantId, String institutionId,
                             String keepId, String dropId, List<String> movedIdentities,
                             String actor, String reason) {
        audit.append(tenantId, institutionId, "MERGE", actor, "USER", "PERSON", keepId,
                Map.of("mergedPersonId", dropId, "movedIdentities", movedIdentities,
                        "reason", reason == null ? "" : reason),
                null);
    }

    /** 人工拆分（subject=PERSON；分离集合是 H-ep2 的事实源）。 */
    public static void split(MpiAuditService audit, String tenantId, String institutionId,
                             String personId, List<String> separated, String newPersonId,
                             String splitIdentity, String actor, String reason) {
        audit.append(tenantId, institutionId, "SPLIT", actor, "USER", "PERSON", personId,
                Map.of(KEY_SEPARATED_IDENTITIES, separated, "newPersonId", newPersonId,
                        "splitIdentity", splitIdentity, "reason", reason == null ? "" : reason),
                null);
    }

    /** 人工复核裁决（subject=REVIEW_TASK）。 */
    public static void decision(MpiAuditService audit, String tenantId, String institutionId,
                                String taskId, String resolution, long pairId,
                                List<String> identities, String mergedPersonId,
                                String actor, String reason) {
        audit.append(tenantId, institutionId, "DECISION", actor, "USER", "REVIEW_TASK", taskId,
                Map.of("resolution", resolution, "pairId", pairId, "identities", identities,
                        "mergedPersonId", mergedPersonId == null ? "" : mergedPersonId,
                        "reason", reason == null ? "" : reason),
                null);
    }

    /** 全量重算（subject=TENANT）。 */
    public static void rebuild(MpiAuditService audit, String tenantId, String institutionId,
                               String actor, int identitiesLoaded, int candidatePairs,
                               int autoMatches, int reviewPairs, int hardConflicts,
                               String ruleVersion) {
        audit.append(tenantId, institutionId, "REBUILD", actor, "USER", "TENANT", tenantId,
                Map.of("identitiesLoaded", identitiesLoaded, "candidatePairs", candidatePairs,
                        "autoMatches", autoMatches, "reviewPairs", reviewPairs,
                        "hardConflicts", hardConflicts),
                ruleVersion);
    }
}
