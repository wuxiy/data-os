package com.cywu.dataos.controlplane.executor;

/**
 * Marker contract for adapters that delegate a run to a workflow orchestrator.
 *
 * <p>The control plane still consumes the common {@link ExecutorAdapter}
 * contract so existing SeaTunnel jobs keep working.  Keeping this marker
 * separate makes the boundary explicit: DolphinScheduler owns workflow
 * execution, while data-os owns the business run and status projection.</p>
 */
public interface OrchestratorAdapter extends ExecutorAdapter {
}
