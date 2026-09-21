package com.cywu.dataos.controlplane.mapping;

/**
 * 标准映射版本生命周期（G23）。唯一常规流转：
 * DRAFT →（提交评审）IN_REVIEW →（生效，需同 checksum PASS 验证）ACTIVE →（停用）RETIRED。
 * RETIRED → ACTIVE 仅允许经回退端点（历史事件不删除）。
 */
public enum MappingLifecycle {
    DRAFT,
    IN_REVIEW,
    ACTIVE,
    RETIRED;

    public boolean canTransitionTo(MappingLifecycle target) {
        return switch (this) {
            case DRAFT -> target == MappingLifecycle.IN_REVIEW;
            case IN_REVIEW -> target == MappingLifecycle.ACTIVE;
            case ACTIVE -> target == MappingLifecycle.RETIRED;
            case RETIRED -> false; // 回退走专用端点
        };
    }
}
