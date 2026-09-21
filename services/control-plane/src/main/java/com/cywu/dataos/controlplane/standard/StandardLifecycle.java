package com.cywu.dataos.controlplane.standard;

/**
 * 数据标准版本生命周期（G22）。唯一合法流转：
 * DRAFT →（提交评审）IN_REVIEW →（发布）PUBLISHED →（停用）DEPRECATED。
 * 只有 DRAFT 可改内容；PUBLISHED 不可覆盖，只能新建版本（发布时旧发布版自动停用）。
 */
public enum StandardLifecycle {
    DRAFT,
    IN_REVIEW,
    PUBLISHED,
    DEPRECATED;

    public boolean canTransitionTo(StandardLifecycle target) {
        return switch (this) {
            case DRAFT -> target == StandardLifecycle.IN_REVIEW;
            case IN_REVIEW -> target == StandardLifecycle.PUBLISHED;
            case PUBLISHED -> target == StandardLifecycle.DEPRECATED;
            case DEPRECATED -> false;
        };
    }
}
