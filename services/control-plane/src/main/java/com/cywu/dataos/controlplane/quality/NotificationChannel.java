package com.cywu.dataos.controlplane.quality;

import com.cywu.dataos.controlplane.governance.GovernanceNotification;

public interface NotificationChannel {

    boolean supports(String channel);

    NotificationDeliveryResult send(GovernanceNotification notification);

    /** 「是否配置好」由通道自答——消费方不自行读通道配置键推算。 */
    default boolean configured() {
        return true;
    }

    /** 配置问题的用户可读原因；配置完好返回空串（供运行状态警告）。 */
    default String configurationProblem() {
        return "";
    }
}
