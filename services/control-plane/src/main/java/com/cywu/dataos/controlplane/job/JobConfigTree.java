package com.cywu.dataos.controlplane.job;

import java.time.Instant;
import java.util.Collection;
import java.util.HashMap;
import java.util.Locale;
import java.util.Map;

import com.cywu.dataos.controlplane.credential.CredentialResolver;

/**
 * 采集作业配置树（SeaTunnel HOCON 的 JSON 面）的单一属主。树的结构——
 * env 为对象、source/sink/transform 为插件列表、插件含 plugin_name 与
 * credentialRef、字符串叶子可携带 ${last_success_time}/${run_start_time}/
 * ${data_os_run_id} 占位符——以及树上的四个操作都在这里声明一次：
 *
 * <ul>
 *   <li>保存期密钥守卫 {@link #containsSecretKey}（JobConfigService）；</li>
 *   <li>运行期演示连接器守卫 {@link #containsPlugin}（JobConfigurationPolicy）；</li>
 *   <li>领取期占位符插值与运行元数据注入 {@link #interpolate}（IngestionRunService）；</li>
 *   <li>提交期凭据展开 {@link #resolveCredentials}（SeaTunnelExecutorAdapter，
 *       仅内存、落库配置永远只含 credentialRef）。</li>
 * </ul>
 *
 * 各生命周期阶段的业务校验（临床连接器契约、网络策略）仍归各自的属主，
 * 这里只拥有树的形状与遍历。凭据解析失败抛 {@link IllegalStateException}，
 * 由调用方翻译为自己的异常方言。
 */
public final class JobConfigTree {

    private JobConfigTree() {
    }

    /** 保存守卫：树中任何键名命中 password/secret/token（不区分大小写）即拒绝。 */
    public static boolean containsSecretKey(Object node) {
        if (node instanceof Map<?, ?> map) {
            for (var entry : map.entrySet()) {
                var key = String.valueOf(entry.getKey()).toLowerCase(Locale.ROOT);
                if (key.contains("password") || key.contains("secret") || key.equals("token")) return true;
                if (containsSecretKey(entry.getValue())) return true;
            }
        } else if (node instanceof Collection<?> collection) {
            for (var item : collection) if (containsSecretKey(item)) return true;
        }
        return false;
    }

    /** 演示守卫：任何 plugin_name 等于给定连接器名（不区分大小写）。 */
    public static boolean containsPlugin(Object node, String pluginName) {
        if (node instanceof Map<?, ?> map) {
            for (var entry : map.entrySet()) {
                if ("plugin_name".equalsIgnoreCase(String.valueOf(entry.getKey()))
                        && pluginName.equalsIgnoreCase(String.valueOf(entry.getValue()).trim())) {
                    return true;
                }
                if (containsPlugin(entry.getValue(), pluginName)) return true;
            }
        } else if (node instanceof Collection<?> collection) {
            for (var item : collection) if (containsPlugin(item, pluginName)) return true;
        }
        return false;
    }

    /** 领取期：全树插值占位符，并向 env 注入 dataos_run_id 与水位线
     *  dataos.watermark.start/end（时间均为 ISO-8601，起点缺省纪元零点、
     *  终点缺省当前时刻）。 */
    public static Map<String, Object> interpolate(Map<String, Object> source, Instant watermarkStart,
                                                  Instant watermarkEnd, String runId) {
        var value = interpolateNode(source, watermarkStart, watermarkEnd, runId);
        if (!(value instanceof Map<?, ?> map)) return Map.of();
        var result = new HashMap<String, Object>();
        map.forEach((key, item) -> result.put(String.valueOf(key), item));
        var resolvedEnv = new HashMap<String, Object>();
        if (result.get("env") instanceof Map<?, ?> envMap) {
            envMap.forEach((key, item) -> resolvedEnv.put(String.valueOf(key), item));
        }
        resolvedEnv.put("dataos_run_id", runId);
        resolvedEnv.put("dataos.watermark.start",
                watermarkStart == null ? "1970-01-01T00:00:00Z" : watermarkStart.toString());
        resolvedEnv.put("dataos.watermark.end",
                watermarkEnd == null ? Instant.now().toString() : watermarkEnd.toString());
        result.put("env", resolvedEnv);
        return result;
    }

    /** 提交期（仅内存）：把 credentialRef 展开为凭据键值。SeaTunnel 的 JDBC
     *  source 读 user、Doris sink 读 username——两种凭据形状都双写以保持
     *  凭据服务的中立性；credentialRef 键本身不出现在结果里。 */
    public static Map<String, Object> resolveCredentials(Map<String, Object> requestConfig,
                                                         CredentialResolver resolver,
                                                         String tenantId, String institutionId) {
        Object resolved = resolveNode(requestConfig, resolver, tenantId, institutionId);
        if (!(resolved instanceof Map<?, ?>)) {
            throw new IllegalStateException("中心采集作业配置必须是对象");
        }
        var result = new HashMap<String, Object>();
        ((Map<?, ?>) resolved).forEach((key, value) -> result.put(String.valueOf(key), value));
        return result;
    }

    private static Object interpolateNode(Object value, Instant watermarkStart, Instant watermarkEnd, String runId) {
        if (value instanceof Map<?, ?> map) {
            var result = new HashMap<String, Object>();
            map.forEach((key, item) -> result.put(String.valueOf(key),
                    interpolateNode(item, watermarkStart, watermarkEnd, runId)));
            return result;
        }
        if (value instanceof Collection<?> collection) {
            return collection.stream().map(item -> interpolateNode(item, watermarkStart, watermarkEnd, runId)).toList();
        }
        if (value instanceof String text) {
            return text.replace("${last_success_time}",
                            watermarkStart == null ? "1970-01-01T00:00:00Z" : watermarkStart.toString())
                    .replace("${run_start_time}",
                            watermarkEnd == null ? Instant.now().toString() : watermarkEnd.toString())
                    .replace("${data_os_run_id}", runId);
        }
        return value;
    }

    private static Object resolveNode(Object value, CredentialResolver resolver,
                                      String tenantId, String institutionId) {
        if (value instanceof Map<?, ?> map) {
            var result = new HashMap<String, Object>();
            Object reference = map.get("credentialRef");
            if (reference != null && !String.valueOf(reference).isBlank()) {
                try {
                    var secret = resolver.resolve(String.valueOf(reference), tenantId, institutionId);
                    secret.forEach((key, item) -> result.put(String.valueOf(key),
                            resolveNode(item, resolver, tenantId, institutionId)));
                    if (secret.containsKey("username")) {
                        result.putIfAbsent("user", resolveNode(secret.get("username"), resolver,
                                tenantId, institutionId));
                    }
                } catch (RuntimeException exception) {
                    throw new IllegalStateException("中心采集作业 credentialRef 无法解析", exception);
                }
            }
            map.forEach((key, item) -> {
                var name = String.valueOf(key);
                if (!"credentialRef".equals(name)) {
                    result.put(name, resolveNode(item, resolver, tenantId, institutionId));
                }
            });
            return result;
        }
        if (value instanceof Collection<?> collection) {
            return collection.stream()
                    .map(item -> resolveNode(item, resolver, tenantId, institutionId)).toList();
        }
        return value;
    }
}
