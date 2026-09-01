package com.cywu.dataos.controlplane.job;

import java.time.Instant;
import java.util.List;
import java.util.Map;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/**
 * 配置树属主的直接测试——尤其覆盖此前分散在四个调用方、无法同树验证的
 * 组合场景（占位符插值、凭据展开与守卫互不干扰）。
 */
class JobConfigTreeTest {

    private static final Map<String, Object> CONFIG = Map.of(
            "env", Map.of("job.mode", "BATCH"),
            "source", List.of(Map.of(
                    "plugin_name", "Jdbc",
                    "query", "WHERE update_time >= '${last_success_time}' AND update_time < '${run_start_time}'",
                    "credentialRef", "cred-source")),
            "sink", List.of(Map.of("plugin_name", "Doris", "credentialRef", "cred-target")));

    @Test
    void interpolateResolvesPlaceholdersAndInjectsRunMetadata() {
        var start = Instant.parse("2026-08-01T00:00:00Z");
        var end = Instant.parse("2026-09-01T00:00:00Z");
        var result = JobConfigTree.interpolate(CONFIG, start, end, "run-1");

        @SuppressWarnings("unchecked")
        var env = (Map<String, Object>) result.get("env");
        assertThat(env).containsEntry("job.mode", "BATCH")
                .containsEntry("dataos_run_id", "run-1")
                .containsEntry("dataos.watermark.start", "2026-08-01T00:00:00Z")
                .containsEntry("dataos.watermark.end", "2026-09-01T00:00:00Z");
        var source = (Map<String, Object>) ((List<?>) result.get("source")).get(0);
        assertThat(source.get("query")).isEqualTo(
                "WHERE update_time >= '2026-08-01T00:00:00Z' AND update_time < '2026-09-01T00:00:00Z'");
        // 插值阶段不碰凭据引用：落库配置到提交前只含 credentialRef。
        assertThat(source).containsEntry("credentialRef", "cred-source");
    }

    @Test
    void resolveCredentialsExpandsReferencesAndDualWritesUser() {
        var config = Map.<String, Object>of(
                "sink", List.of(Map.<String, Object>of(
                        "plugin_name", "Doris", "credentialRef", "cred-target", "fenodes", "fe:8030")));
        var resolver = (com.cywu.dataos.controlplane.credential.CredentialResolver) (reference, tenant, institution)
                -> Map.of("username", "readonly", "password", "runtime-only");

        var result = JobConfigTree.resolveCredentials(config, resolver, "tenant-1", "inst-1");

        var sink = (Map<String, Object>) ((List<?>) result.get("sink")).get(0);
        // JDBC source 读 user、Doris sink 读 username：两种凭据形状都双写。
        assertThat(sink).containsEntry("username", "readonly").containsEntry("user", "readonly");
        assertThat(sink).doesNotContainKey("credentialRef");
    }

    @Test
    void unresolvableCredentialReferenceFailsLoudly() {
        var resolver = (com.cywu.dataos.controlplane.credential.CredentialResolver) (reference, tenant, institution) -> {
            throw new IllegalStateException("vault down");
        };
        assertThatThrownBy(() -> JobConfigTree.resolveCredentials(CONFIG, resolver, "t", "i"))
                .isInstanceOf(IllegalStateException.class)
                .hasMessageContaining("credentialRef 无法解析");
    }

    @Test
    void guardsDetectSecretKeysAndDemoPluginsAnywhere() {
        var config = Map.of(
                "source", List.of(Map.of("plugin_name", "FakeSource")),
                "sink", List.of(Map.of("doris.config", Map.of("token", "x"))));
        assertThat(JobConfigTree.containsPlugin(config, "fakesource")).isTrue();
        assertThat(JobConfigTree.containsPlugin(config, "JDBC")).isFalse();
        assertThat(JobConfigTree.containsSecretKey(config)).isTrue();
        // credentialRef 引用本身不是明文密钥，保存守卫不误伤。
        assertThat(JobConfigTree.containsSecretKey(CONFIG)).isFalse();
    }
}
