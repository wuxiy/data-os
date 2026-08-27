package com.cywu.dataos.controlplane.dataservice;

/**
 * 数据服务生命周期。唯一合法流转：DRAFT → PUBLISHED → DEPRECATED；
 * DRAFT 可删除重建，PUBLISHED 才对执行面可见，DEPRECATED 后不可复活
 * （需要重新发布走新 code 或新版本登记）。
 */
public enum DataApiLifecycle {
    DRAFT,
    PUBLISHED,
    DEPRECATED;

    public boolean canTransitionTo(DataApiLifecycle target) {
        return switch (this) {
            case DRAFT -> target == PUBLISHED;
            case PUBLISHED -> target == DEPRECATED;
            case DEPRECATED -> false;
        };
    }
}
