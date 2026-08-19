package com.cywu.dataos.mpi.rebuild;

import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Service;

import com.cywu.dataos.mpi.candidate.MpiBlockingService;
import com.cywu.dataos.mpi.load.MpiLoaderService;

/**
 * 装载与召回的编排入口：一次 rebuild = 全量幂等装载 + 候选重生成，
 * 同步返回统计（演示档规模下秒级；V2 起规模增长时接入外部运行生命周期）。
 * 随 Doris 访问链整体条件化——未配置 Doris 时本服务不存在，端点报 503。
 */
@Service
@ConditionalOnProperty(name = "data-os.mpi.doris.url")
public class MpiRebuildService {

    /** EP 演示档固定单源；多源接入时由调用方按数据源循环。 */
    static final String SOURCE_SYSTEM_EP = "EP";

    private final MpiLoaderService loader;
    private final MpiBlockingService blocking;

    public MpiRebuildService(MpiLoaderService loader, MpiBlockingService blocking) {
        this.loader = loader;
        this.blocking = blocking;
    }

    public record RebuildResult(int identitiesLoaded, int identitiesSkipped, int candidatePairs,
                                int blockingB3, int blockingB4, int blockingB6) {
    }

    public RebuildResult rebuild(String tenantId) {
        var load = loader.load(tenantId, SOURCE_SYSTEM_EP);
        var pairs = blocking.generate(tenantId);
        return new RebuildResult(load.identitiesLoaded(), load.identitiesSkipped(),
                pairs.totalPairs(), pairs.byB3(), pairs.byB4(), pairs.byB6());
    }
}
