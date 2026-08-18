package com.cywu.dataos.controlplane.source;

import java.net.InetAddress;
import java.net.Inet6Address;
import java.net.URI;
import java.net.URISyntaxException;
import java.net.UnknownHostException;
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
        // Inline credentials are only acceptable in the isolated development
        // adapter.  A production installation may legitimately allow private
        // hospital CIDRs, but that must never turn the development credential
        // fallback back on.
        return properties.isAllowPrivateNetworks()
                && properties.isAllowTestProtocols()
                && properties.getAllowedHosts().stream().noneMatch(item -> item != null && !item.isBlank());
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
                || lower.startsWith("jdbc:sqlserver://") || lower.startsWith("jdbc:oracle:thin:@//")
                || lower.startsWith("jdbc:dm://"))) {
            throw new IllegalArgumentException("生产 JDBC URL 仅允许 PostgreSQL/MySQL/SQL Server/Oracle/Dameng");
        }
        var host = jdbcHost(url);
        validateHost(host);
    }

    /** Validate a host or host:port value used by a sink endpoint. */
    public void validateHostPort(String rawHost) {
        if (rawHost == null || rawHost.isBlank()) {
            throw new IllegalArgumentException("数据源目标主机不能为空");
        }
        var value = rawHost.trim();
        if (value.startsWith("[")) {
            var end = value.indexOf(']');
            if (end < 0) throw new IllegalArgumentException("数据源目标主机格式无效");
            validateHost(value.substring(1, end));
            return;
        }
        var colon = value.indexOf(':');
        validateHost(colon > 0 ? value.substring(0, colon) : value);
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
        var allowlist = properties.getAllowedHosts().stream()
                .filter(item -> item != null && !item.isBlank())
                .map(item -> item.trim().toLowerCase(Locale.ROOT))
                .toList();
        if (!allowlist.isEmpty() && !matchesAllowlist(host, null, allowlist)
                && allowlist.stream().noneMatch(item -> item.contains("/"))) {
            throw new IllegalArgumentException("数据源目标主机不在允许列表中");
        }
        try {
            for (var address : InetAddress.getAllByName(host)) {
                if (isAlwaysBlocked(address)) {
                    throw new IllegalArgumentException("数据源目标地址属于禁止访问的本机、链路本地或组播地址");
                }
                if (isPrivateNetwork(address) && !properties.isAllowPrivateNetworks()) {
                    throw new IllegalArgumentException("数据源目标地址属于禁止访问的内网或本机地址");
                }
                if (!allowlist.isEmpty() && !matchesAllowlist(host, address, allowlist)) {
                    throw new IllegalArgumentException("数据源解析地址不在允许列表中");
                }
            }
        } catch (UnknownHostException exception) {
            throw new IllegalArgumentException("数据源目标主机无法解析");
        }
    }

    private boolean matchesAllowlist(String host, InetAddress address, java.util.List<String> allowlist) {
        for (var allowed : allowlist) {
            if (allowed.contains("/")) {
                if (address != null && matchesCidr(address, allowed)) return true;
                continue;
            }
            if (host.equals(allowed) || host.endsWith("." + allowed)) return true;
            if (address != null && allowed.equals(address.getHostAddress().toLowerCase(Locale.ROOT))) return true;
        }
        return false;
    }

    private boolean matchesCidr(InetAddress address, String cidr) {
        try {
            var parts = cidr.split("/", 2);
            var network = InetAddress.getByName(parts[0]);
            var prefix = Integer.parseInt(parts[1]);
            var addressBytes = address.getAddress();
            var networkBytes = network.getAddress();
            if (addressBytes.length != networkBytes.length || prefix < 0 || prefix > addressBytes.length * 8) {
                return false;
            }
            var fullBytes = prefix / 8;
            var remainingBits = prefix % 8;
            for (var index = 0; index < fullBytes; index++) {
                if (addressBytes[index] != networkBytes[index]) return false;
            }
            if (remainingBits == 0) return true;
            var mask = (byte) (0xff << (8 - remainingBits));
            return (addressBytes[fullBytes] & mask) == (networkBytes[fullBytes] & mask);
        } catch (Exception exception) {
            throw new IllegalArgumentException("DATAOS_SOURCE_ALLOWED_HOSTS 中存在无效 CIDR：" + cidr, exception);
        }
    }

    private boolean isAlwaysBlocked(InetAddress address) {
        // An empty allowlist plus explicit private/test switches is the
        // isolated development mode used by the local health-check adapter.
        // Production must always provide a non-empty allowlist, so loopback
        // cannot be smuggled into a private-network exception there.
        var developmentLoopback = properties.isAllowPrivateNetworks()
                && properties.getAllowedHosts().stream().noneMatch(item -> item != null && !item.isBlank());
        return address.isAnyLocalAddress() || (address.isLoopbackAddress() && !developmentLoopback)
                || address.isLinkLocalAddress() || address.isMulticastAddress();
    }

    private boolean isPrivateNetwork(InetAddress address) {
        if (address.isSiteLocalAddress()) return true;
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
