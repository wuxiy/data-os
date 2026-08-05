package com.cywu.dataos.controlplane.quality;

import com.cywu.dataos.controlplane.governance.GovernanceNotification;

public interface NotificationChannel {

    boolean supports(String channel);

    NotificationDeliveryResult send(GovernanceNotification notification);
}
