package com.cywu.dataos.controlplane.source;

import java.net.InetAddress;
import java.net.Inet6Address;
import java.net.URI;
import java.net.URISyntaxException;
import java.util.Locale;
import java.util.Set;

import org.springframework.stereotype.Component;

@Component
public class SourceNetworkPolicy {

    private static final Set<String> BLOCKED_HOSTS = Set.of(
            "169.254.169.254", "100.100.100.200", "metadata.google.internal", "metadata.azure.com",
            "metadata.azure.internal", "instance-data.ec2.internal");

    private final SourceNetworkProperties properties;

    public SourceNetworkPolicy(SourceNetworkProperties properties) {
        this.properties = properties;
    }

    public static SourceNetworkPolicy developmentDefaults() {
        var properties = new SourceNetworkProperties();
        properties.setAllowHttp(true);
        properties.setAllowPrivateNetworks(true);
        properties.setAllowTestProtocols(true);
        return new SourceNetworkPolicy(properties);
    }

    public boolean isLocalMode() {
        return properties.isAllowPrivateNetworks();
    }

    /** Maximum number of bytes a source health check is allowed to consume. */
    public int maxResponseBytes() {
        return properties.getMaxResponseBytes();
    }

    public void validateHttpUrl(String rawUrl) {
        var uri = parse(rawUrl);
        var scheme = lower(uri.getScheme());
        if (!("https".equals(scheme) || ("http".equals(scheme) && properties.isAllowHttp()))) {
            throw new IllegalArgumentException("数据源检查仅允许 HTTPS；开发环境需显式开启 HTTP");
        }
        if (uri.getUserInfo() != null || uri.getHost() == null || uri.getHost().isBlank()) {
            throw new IllegalArgumentException("数据源 URL 必须包含合法主机且不能携带用户信息");
        }
        validateHost(uri.getHost());
    }

    public void validateJdbcUrl(String rawUrl) {
        if (rawUrl == null || rawUrl.isBlank()) throw new IllegalArgumentException("JDBC URL 不能为空");
        var url = rawUrl.trim();
        var lower = url.toLowerCase(Locale.ROOT);
        if (properties.isAllowTestProtocols() && lower.startsWith("jdbc:h2:")) return;
        if (!(lower.startsWith("jdbc:postgresql://") || lower.startsWith("jdbc:mysql://")
                || lower.startsWith("jdbc:sqlserver://") || lower.startsWith("jdbc:oracle:thin:@//"))) {
            throw new IllegalArgumentException("生产 JDBC URL 仅允许 PostgreSQL/MySQL/SQL Server/Oracle");
        }
        var host = jdbcHost(url);
        validateHost(host);
    }

    private void validateHost(String rawHost) {
        var host = rawHost.trim().toLowerCase(Locale.ROOT);
        if (BLOCKED_HOSTS.contains(host) || "localhost".equals(host)
                || host.endsWith(".internal") || host.endsWith(".localhost")) {
            throw new IllegalArgumentException("数据源目标地址属于禁止访问的元数据或内部域名");
        }
        if (!properties.isAllowPrivateNetworks() && properties.getAllowedHosts().isEmpty()) {
            throw new IllegalArgumentException("生产数据源目标必须配置 DATAOS_SOURCE_ALLOWED_HOSTS");
        }
        if (!properties.getAllowedHosts().isEmpty() && properties.getAllowedHosts().stream()
                .map(item -> item == null ? "" : item.trim().toLowerCase(Locale.ROOT))
                .noneMatch(allowed -> host.equals(allowed) || host.endsWith("." + allowed))) {
            throw new IllegalArgumentException("数据源目标主机不在允许列表中");
        }
        try {
            for (var address : InetAddress.getAllByName(host)) {
                if (isPrivateOrLocal(address) && !properties.isAllowPrivateNetworks()) {
                    throw new IllegalArgumentException("数据源目标地址属于禁止访问的内网或本机地址");
                }
            }
        } catch (java.net.UnknownHostException exception) {
            throw new IllegalArgumentException("数据源目标主机无法解析");
        }
    }

    private boolean isPrivateOrLocal(InetAddress address) {
        if (address.isAnyLocalAddress() || address.isLoopbackAddress() || address.isLinkLocalAddress()
                || address.isSiteLocalAddress() || address.isMulticastAddress()) {
            return true;
        }
        if (address instanceof Inet6Address ipv6) {
            // RFC 4193 unique-local addresses (fc00::/7) are private even
            // though java.net.InetAddress does not classify them as site-local.
            var firstByte = ipv6.getAddress()[0] & 0xff;
            return (firstByte & 0xfe) == 0xfc;
        }
        return false;
    }

    private String jdbcHost(String url) {
        try {
            var value = url.substring(url.indexOf("://") + 3);
            var slash = value.indexOf('/');
            var query = value.indexOf('?');
            var end = value.length();
            if (slash >= 0) end = Math.min(end, slash);
            if (query >= 0) end = Math.min(end, query);
            var authority = value.substring(0, end);
            if (authority.startsWith("[")) return authority.substring(1, authority.indexOf(']'));
            var colon = authority.indexOf(':');
            return colon < 0 ? authority : authority.substring(0, colon);
        } catch (RuntimeException exception) {
            throw new IllegalArgumentException("JDBC URL 主机格式无效");
        }
    }

    private URI parse(String rawUrl) {
        try {
            return new URI(rawUrl == null ? "" : rawUrl.trim());
        } catch (URISyntaxException exception) {
            throw new IllegalArgumentException("数据源 URL 格式无效");
        }
    }

    private String lower(String value) {
        return value == null ? "" : value.toLowerCase(Locale.ROOT);
    }
}
