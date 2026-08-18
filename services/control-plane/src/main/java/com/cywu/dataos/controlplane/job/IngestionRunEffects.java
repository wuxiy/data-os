package com.cywu.dataos.controlplane.job;

import java.time.Instant;

import com.cywu.dataos.controlplane.run.RunStatus;
import com.cywu.dataos.controlplane.run.RunTerminalEffects;

/**
 * 采集运行终态的业务效果：SUCCEEDED 时在状态回写的同一事务内封顶水位
线上界并推进采集检查点。
 */
public class IngestionRunEffects implements RunTerminalEffects<IngestionRun, Void> {

    private final RunRepository runRepository;
    private final IngestionCheckpointRepository checkpointRepository;

    public IngestionRunEffects(RunRepository runRepository, IngestionCheckpointRepository checkpointRepository) {
        this.runRepository = runRepository;
        this.checkpointRepository = checkpointRepository;
    }

    @Override
    public void onTerminal(IngestionRun run, String status, Void payload, Instant startedAt, Instant finishedAt) {
        if (!RunStatus.SUCCEEDED.name().equals(status) || checkpointRepository == null) {
            return;
        }
        var lastRunAt = finishedAt != null ? finishedAt : startedAt != null ? startedAt : Instant.now();
        var watermarkEnd = runRepository.findSourceWatermarkEnd(run.id())
                .orElse(finishedAt != null ? finishedAt : lastRunAt);
        runRepository.setSourceWatermarkEndBoundary(run.id(), watermarkEnd);
        checkpointRepository.advance(run.jobId(), run.id(), watermarkEnd);
    }
}
