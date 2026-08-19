package com.cywu.dataos.mpi.rebuild;

import java.util.Map;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

import com.cywu.dataos.mpi.audit.MpiAuditService;
import com.cywu.dataos.mpi.candidate.MpiBlockingService;
import com.cywu.dataos.mpi.decision.MpiDecisionService;
import com.cywu.dataos.mpi.load.MpiLoaderService;
import com.cywu.dataos.mpi.matcher.MpiRuleMatcher;

/**
 * 装载→召回→决策的编排入口：一次 rebuild = 全量幂等装载 + 候选重生成 +
 * 三态判定（AUTO 建人 / REVIEW 建任务 / 硬冲突拦截），同步返回统计
 * （演示档规模秒级；V2 起规模增长时接入外部运行生命周期）。
 * 随 Doris 访问链整体条件化——未配置 Doris 时本服务不存在，端点报 503。
 */
@Service
@ConditionalOnProperty(name = "data-os.mpi.doris.url")
public class MpiRebuildService {

    /** EP 演示档固定单源；多源接入时由调用方按数据源循环。 */
    static final String SOURCE_SYSTEM_EP = "EP";

    private final MpiLoaderService loader;
    private final MpiBlockingService blocking;
    private final MpiDecisionService decisions;
    private final MpiAuditService audit;

    public MpiRebuildService(MpiLoaderService loader, MpiBlockingService blocking,
                             MpiDecisionService decisions, MpiAuditService audit) {
        this.loader = loader;
        this.blocking = blocking;
        this.decisions = decisions;
        this.audit = audit;
    }

    public record RebuildResult(int identitiesLoaded, int identitiesSkipped, int candidatePairs,
                                int blockingB3, int blockingB4, int blockingB6,
                                int autoMatches, int reviewPairs, int noMatchPairs, int hardConflicts) {
    }

    public RebuildResult rebuild(String tenantId, String institutionId, String actor) {
        var load = loader.load(tenantId, SOURCE_SYSTEM_EP);
        var pairs = blocking.generate(tenantId);
        var decided = decisions.decideAll(tenantId, institutionId, actor);
        audit.append(tenantId, institutionId, "REBUILD", actor, "USER", "TENANT", tenantId,
                Map.of("identitiesLoaded", load.identitiesLoaded(),
                        "candidatePairs", pairs.totalPairs(),
                        "autoMatches", decided.autoMatch(),
                        "reviewPairs", decided.review(),
                        "hardConflicts", decided.hardConflict()),
                MpiRuleMatcher.RULE_VERSION);
        return new RebuildResult(load.identitiesLoaded(), load.identitiesSkipped(),
                pairs.totalPairs(), pairs.byB3(), pairs.byB4(), pairs.byB6(),
                decided.autoMatch(), decided.review(), decided.noMatch(), decided.hardConflict());
    }
}
