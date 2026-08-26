package com.cywu.dataos.controlplane.ai;

import java.time.Instant;
import java.time.LocalDate;

/**
 * AI Data Product 的不可变版本快照（对应 {@code data_os.ai_data_product_version} 表）。
 *
 * <p>同一产品内 {@code (productId, versionSn)} 唯一（由迁移约束
 * {@code uq_ai_data_product_version} 保证）；{@code readinessJson} 承载
 * 就绪度评估结果（G9 接入前为空），{@code buildStatus} 为构建登记状态。</p>
 */
public record AIDataProductVersion(
        String id,
        String productId,
        String versionSn,
        String recipeRef,
        String gitCommit,
        LocalDate snapshotAt,
        String readinessJson,
        String buildStatus,
        Instant createdAt) {
}
