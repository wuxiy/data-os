package com.cywu.dataos.controlplane.source;

import java.util.ArrayList;
import java.util.List;

import org.springframework.boot.context.properties.ConfigurationProperties;

@ConfigurationProperties(prefix = "data-os.source-network")
public class SourceNetworkProperties {

    private boolean allowHttp = false;
    private boolean allowPrivateNetworks = false;
    private boolean allowTestProtocols = false;
    private int maxResponseBytes = 65536;
    private List<String> allowedHosts = new ArrayList<>();

    public boolean isAllowHttp() {
        return allowHttp;
    }

    public void setAllowHttp(boolean allowHttp) {
        this.allowHttp = allowHttp;
    }

    public boolean isAllowPrivateNetworks() {
        return allowPrivateNetworks;
    }

    public void setAllowPrivateNetworks(boolean allowPrivateNetworks) {
        this.allowPrivateNetworks = allowPrivateNetworks;
    }

    public boolean isAllowTestProtocols() {
        return allowTestProtocols;
    }

    public void setAllowTestProtocols(boolean allowTestProtocols) {
        this.allowTestProtocols = allowTestProtocols;
    }

    public int getMaxResponseBytes() {
        return maxResponseBytes;
    }

    public void setMaxResponseBytes(int maxResponseBytes) {
        this.maxResponseBytes = maxResponseBytes;
    }

    public List<String> getAllowedHosts() {
        return allowedHosts;
    }

    public void setAllowedHosts(List<String> allowedHosts) {
        this.allowedHosts = allowedHosts == null ? new ArrayList<>() : new ArrayList<>(allowedHosts);
    }
}
