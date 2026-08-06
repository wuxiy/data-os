package com.cywu.dataos.controlplane.credential;

import java.util.Map;

public interface CredentialResolver {

    Map<String, Object> resolve(String reference, String tenantId, String institutionId);
}
