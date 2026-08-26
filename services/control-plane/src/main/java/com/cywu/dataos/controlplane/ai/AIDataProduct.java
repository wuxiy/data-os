package com.cywu.dataos.controlplane.ai;

import java.time.Instant;

/**
 * AI Data Product 聚合根域模型（对应 {@code data_os.ai_data_product} 表）。
 *
 * <p>生命周期流转规则唯一来源是 {@link AIDataProductLifecycle}，
 * 本模型只承载状态，不自带流转逻辑。</p>
 */
public record AIDataProduct(
        String id,
        String tenantId,
        String name,
        AIDataProductType productType,
        String owner,
        String workflowType,
        String sourceDesc,
        String currentVersion,
        AIDataProductLifecycle lifecycle,
        Instant createdAt,
        Instant updatedAt) {
}
