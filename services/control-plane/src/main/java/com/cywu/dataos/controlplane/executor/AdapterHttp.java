package com.cywu.dataos.controlplane.executor;

import java.net.http.HttpClient;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDateTime;
import java.time.ZoneId;
import java.time.OffsetDateTime;
import java.time.format.DateTimeFormatter;
import java.time.format.DateTimeParseException;
import java.util.Map;

import org.springframework.http.client.JdkClientHttpRequestFactory;
import org.springframework.web.client.RestClient;

/**
 * 外部适配器 HTTP 信封的单一属主：RestClient 构造（超时与 HTTP/1.1）、
 * 状态码瞬态分类（408/429/5xx）、厂商响应取值与时间戳解析、base-url 归一。
 * 各 adapter 只保留自己的厂商路径、报文形状与错误文案——分类谓词与传输
 * 机械不再各自复制（此前 6 份构造 + 3 种分类方言 + 解析/取值三胞胎）。
 */
public final class AdapterHttp {

    private static final DateTimeFormatter VENDOR_LOCAL_TIME =
            DateTimeFormatter.ofPattern("yyyy-MM-dd HH:mm:ss");

    private AdapterHttp() {
    }

    /**
     * 统一传输构造：JDK HttpClient + 显式超时，HTTP/1.1 固定——JDK 默认
     * HTTP/2 会对明文端点发 h2c Upgrade，uvicorn（quality-runner）与
     * DolphinScheduler 内嵌服务器会拒绝升级并丢弃请求体（实测）；
     * HTTP/1.1 是所有外部适配器的安全基线。
     */
    public static RestClient restClient(RestClient.Builder builder,
                                        Duration connectTimeout, Duration readTimeout) {
        var client = HttpClient.newBuilder().version(HttpClient.Version.HTTP_1_1)
                .connectTimeout(connectTimeout).build();
        var requestFactory = new JdkClientHttpRequestFactory(client);
        requestFactory.setReadTimeout(readTimeout);
        return builder.requestFactory(requestFactory).build();
    }

    /** 瞬态状态码（值得重试或稍后再试）：408 请求超时、429 限流、5xx。 */
    public static boolean isTransient(int statusCode) {
        return statusCode == 408 || statusCode == 429 || statusCode >= 500;
    }

    /** 厂商响应取第一个非空且非空白 的键值；map 为 null 安全返回 null。 */
    public static String first(Map<String, Object> source, String... keys) {
        if (source == null) return null;
        for (var key : keys) {
            var value = source.get(key);
            if (value != null && !String.valueOf(value).isBlank()) return String.valueOf(value);
        }
        return null;
    }

    /** {@link #first} 带缺省值。 */
    public static String firstOr(Map<String, Object> source, String fallback, String... keys) {
        var value = first(source, keys);
        return value == null ? fallback : value;
    }

    /**
     * 厂商时间戳解析：ISO Instant → ISO OffsetDateTime → ISO LocalDateTime
     * （按给定市区）→ "yyyy-MM-dd HH:mm:ss"（按给定市区）四级级联；
     * 空值或全部失败返回 null（调用方决定失败语义：跳过、试下一键或报错）。
     */
    public static Instant parseInstant(Object value, ZoneId localZone) {
        if (value == null || String.valueOf(value).isBlank()) return null;
        var text = String.valueOf(value).trim();
        try {
            return Instant.parse(text);
        } catch (DateTimeParseException ignored) {
            try {
                return OffsetDateTime.parse(text).toInstant();
            } catch (DateTimeParseException offsetIgnored) {
                try {
                    return LocalDateTime.parse(text).atZone(localZone).toInstant();
                } catch (DateTimeParseException localIgnored) {
                    try {
                        return LocalDateTime.parse(text, VENDOR_LOCAL_TIME).atZone(localZone).toInstant();
                    } catch (DateTimeParseException vendorIgnored) {
                        return null;
                    }
                }
            }
        }
    }

    /** base-url 归一：去首尾空白与结尾斜杠；null 安全返回空串。 */
    public static String normalizeBaseUrl(String value) {
        return value == null ? "" : value.trim().replaceAll("/+$", "");
    }
}
