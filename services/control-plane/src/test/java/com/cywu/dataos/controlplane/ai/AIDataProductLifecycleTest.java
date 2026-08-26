package com.cywu.dataos.controlplane.ai;

import java.util.EnumSet;
import java.util.Map;
import java.util.Set;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 生命周期状态机契约测试（G8 P1）。
 *
 * <p>流转规则只允许有一份定义——本测试用一张期望矩阵锁定
 * {@link AIDataProductLifecycle} 的全部 (from, to) 组合，任何对状态机
 * 的散落修改（复制第二份表、绕过 enum 裸改字符串）都会在这里现形。</p>
 */
class AIDataProductLifecycleTest {

    /** 期望矩阵：状态机的完整契约，除此之外一律非法。 */
    private static final Map<AIDataProductLifecycle, Set<AIDataProductLifecycle>> EXPECTED = Map.of(
            AIDataProductLifecycle.DRAFT, EnumSet.of(AIDataProductLifecycle.CURATED),
            AIDataProductLifecycle.CURATED, EnumSet.of(AIDataProductLifecycle.ASSESSED),
            AIDataProductLifecycle.ASSESSED, EnumSet.of(AIDataProductLifecycle.CERTIFIED),
            AIDataProductLifecycle.CERTIFIED, EnumSet.of(AIDataProductLifecycle.SERVING, AIDataProductLifecycle.DEPRECATED),
            AIDataProductLifecycle.SERVING, EnumSet.of(AIDataProductLifecycle.DEPRECATED),
            AIDataProductLifecycle.DEPRECATED, EnumSet.of(AIDataProductLifecycle.DEPRECATED));

    @Test
    void legalChainDRAFTToSERVINGIsAllowedStepByStep() {
        assertThat(AIDataProductLifecycle.DRAFT.canTransitionTo(AIDataProductLifecycle.CURATED)).isTrue();
        assertThat(AIDataProductLifecycle.CURATED.canTransitionTo(AIDataProductLifecycle.ASSESSED)).isTrue();
        assertThat(AIDataProductLifecycle.ASSESSED.canTransitionTo(AIDataProductLifecycle.CERTIFIED)).isTrue();
        assertThat(AIDataProductLifecycle.CERTIFIED.canTransitionTo(AIDataProductLifecycle.SERVING)).isTrue();

        AIDataProductLifecycle current = AIDataProductLifecycle.DRAFT
                .transitionTo(AIDataProductLifecycle.CURATED)
                .transitionTo(AIDataProductLifecycle.ASSESSED)
                .transitionTo(AIDataProductLifecycle.CERTIFIED)
                .transitionTo(AIDataProductLifecycle.SERVING);
        assertThat(current).isEqualTo(AIDataProductLifecycle.SERVING);
    }

    @Test
    void deprecationIsReachableFromTerminalStatesAndIdempotent() {
        assertThat(AIDataProductLifecycle.CERTIFIED.canTransitionTo(AIDataProductLifecycle.DEPRECATED)).isTrue();
        assertThat(AIDataProductLifecycle.SERVING.canTransitionTo(AIDataProductLifecycle.DEPRECATED)).isTrue();
        assertThat(AIDataProductLifecycle.DEPRECATED.canTransitionTo(AIDataProductLifecycle.DEPRECATED)).isTrue();
        assertThat(AIDataProductLifecycle.SERVING.transitionTo(AIDataProductLifecycle.DEPRECATED))
                .isEqualTo(AIDataProductLifecycle.DEPRECATED);
    }

    @Test
    void servingCannotFallBackToAssessed() {
        assertThat(AIDataProductLifecycle.SERVING.canTransitionTo(AIDataProductLifecycle.ASSESSED)).isFalse();
        assertThatThrownBy(() -> AIDataProductLifecycle.SERVING.transitionTo(AIDataProductLifecycle.ASSESSED))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("SERVING")
                .hasMessageContaining("ASSESSED");
    }

    @Test
    void skippingIntermediateStatesIsRejected() {
        assertThat(AIDataProductLifecycle.DRAFT.canTransitionTo(AIDataProductLifecycle.CERTIFIED)).isFalse();
        assertThatThrownBy(() -> AIDataProductLifecycle.DRAFT.transitionTo(AIDataProductLifecycle.CERTIFIED))
                .isInstanceOf(IllegalArgumentException.class);

        assertThat(AIDataProductLifecycle.CURATED.canTransitionTo(AIDataProductLifecycle.SERVING)).isFalse();
        assertThatThrownBy(() -> AIDataProductLifecycle.CURATED.transitionTo(AIDataProductLifecycle.SERVING))
                .isInstanceOf(IllegalArgumentException.class);
    }

    @Test
    void draftCannotBeDeprecatedDirectly() {
        // DRAFT 尚未成型，不构成可弃用的业务对象；必须先走到 CURATED 之后
        assertThat(AIDataProductLifecycle.DRAFT.canTransitionTo(AIDataProductLifecycle.DEPRECATED)).isFalse();
        assertThatThrownBy(() -> AIDataProductLifecycle.DRAFT.transitionTo(AIDataProductLifecycle.DEPRECATED))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("DRAFT")
                .hasMessageContaining("DEPRECATED");
    }

    @Test
    void noTransitionOutsideTheDeclaredMatrixIsAllowed() {
        // 状态机是唯一来源：所有 (from, to) 组合必须与期望矩阵一致，不多不少
        for (AIDataProductLifecycle from : AIDataProductLifecycle.values()) {
            for (AIDataProductLifecycle to : AIDataProductLifecycle.values()) {
                assertThat(from.canTransitionTo(to))
                        .as("canTransitionTo(%s -> %s) 应与期望矩阵一致", from, to)
                        .isEqualTo(EXPECTED.get(from).contains(to));
            }
        }
    }

    @Test
    void nullTargetIsRejected() {
        assertThatThrownBy(() -> AIDataProductLifecycle.DRAFT.canTransitionTo(null))
                .isInstanceOf(NullPointerException.class);
        assertThatThrownBy(() -> AIDataProductLifecycle.DRAFT.transitionTo(null))
                .isInstanceOf(NullPointerException.class);
    }
}
