package com.cywu.dataos.controlplane.operations;

/**
 * MPI 域事实客户端（G24）：mpi-service 是独立服务（自有 PostgreSQL），
 * 控制面经其 /api/v1/mpi/metrics 只读拉取待复核计数。未配置
 * data-os.operations.mpi-base-url 时实现不装配，投影局部 NOT_CONFIGURED（不伪造 0）。
 */
public interface MpiFactsClient {

    /** 待人工复核候选对数（OPEN）。不可达抛异常，由投影侧落 UNKNOWN。 */
    long reviewPending();
}
