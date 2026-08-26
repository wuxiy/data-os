package com.cywu.dataos.controlplane.ai;

import java.util.EnumSet;
import java.util.Map;
import java.util.Objects;
import java.util.Set;

/**
 * AI Data Product 生命周期状态机（G8 计划 §2.1）。
 *
 * <p>合法流转只有一份定义：</p>
 * <pre>
 * DRAFT → CURATED → ASSESSED → CERTIFIED → SERVING
 *                                  └──────────────┐
 * CERTIFIED / SERVING / DEPRECATED → DEPRECATED ──┘（终态可弃用；DEPRECATED 重复弃用幂等）
 * </pre>
 *
 * <p>本 enum 是状态词汇与流转规则的唯一来源（参考
 * {@code docs/agents/architecture.md}「单一来源清单」）：仓储、API、
 * 前端一律引用此处，不得散落裸状态字符串或复制第二份流转表。</p>
 */
public enum AIDataProductLifecycle {
    DRAFT,
    CURATED,
    ASSESSED,
    CERTIFIED,
    SERVING,
    DEPRECATED;

    private static final Map<AIDataProductLifecycle, Set<AIDataProductLifecycle>> ALLOWED_TRANSITIONS = Map.of(
            DRAFT, EnumSet.of(CURATED),
            CURATED, EnumSet.of(ASSESSED),
            ASSESSED, EnumSet.of(CERTIFIED),
            CERTIFIED, EnumSet.of(SERVING, DEPRECATED),
            SERVING, EnumSet.of(DEPRECATED),
            DEPRECATED, EnumSet.of(DEPRECATED));

    /** 是否允许从当前状态流转到 {@code target}。 */
    public boolean canTransitionTo(AIDataProductLifecycle target) {
        Objects.requireNonNull(target, "target lifecycle must not be null");
        return ALLOWED_TRANSITIONS.get(this).contains(target);
    }

    /**
     * 执行流转：合法时返回目标状态，非法流转抛出
     * {@link IllegalArgumentException}（P2 服务层据此映射 409）。
     */
    public AIDataProductLifecycle transitionTo(AIDataProductLifecycle target) {
        if (!canTransitionTo(target)) {
            throw new IllegalArgumentException(
                    "非法生命周期流转: " + name() + " -> " + target.name());
        }
        return target;
    }
}
