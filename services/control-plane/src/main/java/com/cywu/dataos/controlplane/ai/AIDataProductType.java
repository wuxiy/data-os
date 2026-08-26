package com.cywu.dataos.controlplane.ai;

/**
 * AI Data Product 的产品类型（词汇见 CONTEXT.md「AI Ready Data」）。
 *
 * <p>类型词汇的唯一来源：迁移、API、前端展示均以本 enum 为准，
 * 不得散落裸类型字符串。</p>
 */
public enum AIDataProductType {
    RAG_CORPUS,
    TRAINING_DATASET,
    INSTRUCTION_DATASET,
    PREFERENCE_DATASET,
    FEATURE_DATASET,
    AGENT_CONTEXT,
    EVALUATION_DATASET,
    MULTIMODAL_DATASET
}
