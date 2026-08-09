package com.cywu.dataos.controlplane.quality;

import java.net.InetAddress;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.List;
import java.util.Locale;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.stereotype.Component;

/** Default-deny destination policy for the outbound responsibility webhook. */
@Component
public final class NotificationEndpointPolicy {

    private final boolean allowHttp;
    private final boolean allowPrivateNetworks;
    private final List<String> allowedHosts;

    @Autowired
    public NotificationEndpointPolicy(
            @Value("${data-os.notification.allow-http:false}") boolean allowHttp,
            @Value("${data-os.notification.allow-private-networks:false}") boolean allowPrivateNetworks,
            @Value("${data-os.notification.allowed-hosts:}") List<String> allowedHosts) {
        this.allowHttp = allowHttp;
        this.allowPrivateNetworks = allowPrivateNetworks;
        this.allowedHosts = allowedHosts == null ? List.of() : allowedHosts.stream()
                .map(item -> item == null ? "" : item.trim().toLowerCase(Locale.ROOT))
                .filter(item -> !item.isBlank()).toList();
    }

    NotificationEndpointPolicy(boolean allowHttp, boolean allowPrivateNetworks, List<String> allowedHosts, boolean testOnly) {
        this.allowHttp = allowHttp;
        this.allowPrivateNetworks = allowPrivateNetworks;
        this.allowedHosts = allowedHosts == null ? List.of() : allowedHosts.stream()
                .map(item -> item == null ? "" : item.trim().toLowerCase(Locale.ROOT))
                .filter(item -> !item.isBlank()).toList();
    }

    public void validate(String rawUrl) {
        final URI uri;
        try {
            uri = new URI(rawUrl == null ? "" : rawUrl.trim());
        } catch (URISyntaxException exception) {
            throw new IllegalArgumentException("通知端点 URL 格式无效");
        }
        var scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!("https".equals(scheme) || ("http".equals(scheme) && allowHttp))) {
            throw new IllegalArgumentException("通知端点仅允许 HTTPS；开发接收器需显式开启 HTTP");
        }
        if (uri.getUserInfo() != null || uri.getHost() == null || uri.getHost().isBlank()) {
            throw new IllegalArgumentException("通知端点不能携带用户信息且必须包含主机");
        }
        var host = uri.getHost().toLowerCase(Locale.ROOT);
        if (allowedHosts.isEmpty() || allowedHosts.stream().noneMatch(item -> host.equals(item) || host.endsWith("." + item))) {
            throw new IllegalArgumentException("通知端点主机不在允许列表中");
        }
        try {
            for (var address : InetAddress.getAllByName(host)) {
                if ((address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress()
                        || address.isSiteLocalAddress() || address.isMulticastAddress()) && !allowPrivateNetworks) {
                    throw new IllegalArgumentException("通知端点地址属于禁止访问的内网或本机地址");
                }
            }
        } catch (java.net.UnknownHostException exception) {
            throw new IllegalArgumentException("通知端点主机无法解析");
        }
    }
}
