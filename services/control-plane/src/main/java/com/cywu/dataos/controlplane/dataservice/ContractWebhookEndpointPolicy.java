package com.cywu.dataos.controlplane.dataservice;

import java.net.InetAddress;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * 合同通知 webhook 的外发端点策略（P8 余项）。与治理 webhook 的
 * {@code NotificationEndpointPolicy}（单端点 + host 白名单，default-deny）
 * 语义不同：订阅端点由调用方自报、不可枚举，防护重心是 scheme 与
 * 内网地址解析——默认仅允许公网 HTTPS，内网/HTTP 需显式放开（dev 接收器）。
 */
@Component
public final class ContractWebhookEndpointPolicy {

    private final boolean allowHttp;
    private final boolean allowPrivateNetworks;

    public ContractWebhookEndpointPolicy(
            @Value("${data-os.data-api.contract-webhook-allow-http:false}") boolean allowHttp,
            @Value("${data-os.data-api.contract-webhook-allow-private-networks:false}") boolean allowPrivateNetworks) {
        this.allowHttp = allowHttp;
        this.allowPrivateNetworks = allowPrivateNetworks;
    }

    /** 校验订阅 webhook URL；违规抛 IllegalArgumentException（落订阅创建 400）。 */
    public void validate(String rawUrl) {
        final URI uri;
        try {
            uri = new URI(rawUrl == null ? "" : rawUrl.trim());
        } catch (URISyntaxException exception) {
            throw new IllegalArgumentException("Webhook URL 格式无效");
        }
        var scheme = uri.getScheme() == null ? "" : uri.getScheme().toLowerCase(Locale.ROOT);
        if (!("https".equals(scheme) || ("http".equals(scheme) && allowHttp))) {
            throw new IllegalArgumentException("Webhook 仅允许 HTTPS；内网接收器需显式开启 HTTP");
        }
        if (uri.getUserInfo() != null || uri.getHost() == null || uri.getHost().isBlank()) {
            throw new IllegalArgumentException("Webhook 不能携带用户信息且必须包含主机");
        }
        var host = uri.getHost().toLowerCase(Locale.ROOT);
        try {
            for (var address : InetAddress.getAllByName(host)) {
                if ((address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress()
                        || address.isSiteLocalAddress() || address.isMulticastAddress()) && !allowPrivateNetworks) {
                    throw new IllegalArgumentException("Webhook 地址属于禁止访问的内网或本机地址");
                }
            }
        } catch (java.net.UnknownHostException exception) {
            throw new IllegalArgumentException("Webhook 主机无法解析");
        }
    }
}
