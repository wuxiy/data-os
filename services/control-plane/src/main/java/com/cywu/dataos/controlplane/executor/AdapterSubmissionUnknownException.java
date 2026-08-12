package com.cywu.dataos.controlplane.executor;

/**
 * The submit request may have reached the external executor, but the control
 * plane cannot prove whether it was accepted. Retrying must go through the
 * durable run-id reconciliation path instead of submitting a second run.
 */
public class AdapterSubmissionUnknownException extends AdapterUnavailableException {

    public AdapterSubmissionUnknownException(String message) {
        super(message);
    }
}
