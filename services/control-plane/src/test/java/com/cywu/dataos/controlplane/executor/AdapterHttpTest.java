package com.cywu.dataos.controlplane.executor;

import java.time.Instant;
import java.time.ZoneId;
import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.web.client.RestClient;

import static org.assertj.core.api.Assertions.assertThat;

/** 外部适配器 HTTP 信封：瞬态分类、时间戳四级级联、厂商取值与 base-url 归一。 */
class AdapterHttpTest {

    @Test
    void transientStatusCodesAreTimeoutThrottlingAndServerErrors() {
        assertThat(AdapterHttp.isTransient(408)).isTrue();
        assertThat(AdapterHttp.isTransient(429)).isTrue();
        assertThat(AdapterHttp.isTransient(500)).isTrue();
        assertThat(AdapterHttp.isTransient(503)).isTrue();
        assertThat(AdapterHttp.isTransient(200)).isFalse();
        assertThat(AdapterHttp.isTransient(401)).isFalse();
        assertThat(AdapterHttp.isTransient(403)).isFalse();
        assertThat(AdapterHttp.isTransient(404)).isFalse();
        assertThat(AdapterHttp.isTransient(409)).isFalse();
    }

    @Test
    void parseInstantCoversIsoOffsetLocalAndVendorForms() {
        var zone = ZoneId.of("Asia/Shanghai");
        assertThat(AdapterHttp.parseInstant("2026-09-01T12:00:00Z", zone))
                .isEqualTo(Instant.parse("2026-09-01T12:00:00Z"));
        // quality-runner 返回的带时区 ISO 形式。
        assertThat(AdapterHttp.parseInstant("2026-08-05T09:00:00+08:00", zone))
                .isEqualTo(Instant.parse("2026-08-05T01:00:00Z"));
        // SeaTunnel/DolphinScheduler 的无时区秒级形式按给定市区解释。
        assertThat(AdapterHttp.parseInstant("2026-09-01 20:00:00", zone))
                .isEqualTo(Instant.parse("2026-09-01T12:00:00Z"));
        assertThat(AdapterHttp.parseInstant("2026-09-01T20:00:00", zone))
                .isEqualTo(Instant.parse("2026-09-01T12:00:00Z"));
        assertThat(AdapterHttp.parseInstant(null, zone)).isNull();
        assertThat(AdapterHttp.parseInstant("  ", zone)).isNull();
        assertThat(AdapterHttp.parseInstant("not a time", zone)).isNull();
    }

    @Test
    void firstReturnsFirstNonBlankValueAndFallsBack() {
        var payload = Map.<String, Object>of("status", "", "state", "RUNNING");
        assertThat(AdapterHttp.first(payload, "status", "state")).isEqualTo("RUNNING");
        assertThat(AdapterHttp.first(payload, "missing", "alsoMissing")).isNull();
        assertThat(AdapterHttp.firstOr(payload, "UNKNOWN", "missing")).isEqualTo("UNKNOWN");
        assertThat(AdapterHttp.first(null, "anything")).isNull();
        assertThat(AdapterHttp.firstOr(null, "UNKNOWN", "anything")).isEqualTo("UNKNOWN");
    }

    @Test
    void normalizeBaseUrlTrimsTrailingSlashes() {
        assertThat(AdapterHttp.normalizeBaseUrl(" http://x:8080/ ")).isEqualTo("http://x:8080");
        assertThat(AdapterHttp.normalizeBaseUrl("http://x:8080///")).isEqualTo("http://x:8080");
        assertThat(AdapterHttp.normalizeBaseUrl(null)).isEmpty();
    }

    @Test
    void restClientBuildsWithExplicitTimeouts() {
        // 构造不抛错即可：HTTP/1.1 固定与超时由工厂单点保证（行为面由各 adapter
        // 的 HttpServer 测试间接覆盖）。
        var client = AdapterHttp.restClient(RestClient.builder(),
                java.time.Duration.ofSeconds(3), java.time.Duration.ofSeconds(10));
        assertThat(client).isNotNull();
    }
}
