package com.cywu.dataos.controlplane.job;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.delete;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.HashMap;
import java.util.concurrent.ConcurrentHashMap;
import java.util.concurrent.atomic.AtomicLong;

import com.fasterxml.jackson.databind.JsonNode;
import com.fasterxml.jackson.databind.json.JsonMapper;
import com.sun.net.httpserver.HttpExchange;
import com.sun.net.httpserver.HttpServer;
import org.junit.jupiter.api.AfterAll;
import org.junit.jupiter.api.BeforeAll;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.http.MediaType;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.context.DynamicPropertyRegistry;
import org.springframework.test.context.DynamicPropertySource;
import org.springframework.test.web.servlet.MockMvc;
import org.springframework.test.web.servlet.MvcResult;

/**
 * G2G 批次 5 第一刀契约测试：周期调度接线（DS 通道任务专属）。stub DS
 * schedules API（建/改/上线/下线/删/查/预览），断言代理语义与通道守卫。
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class JobScheduleApiTest {

    private static final long PROJECT_CODE = 90;
    private static final long WORKFLOW_CODE = 77;

    private static HttpServer server;
    private static final Map<Long, Map<String, Object>> schedules = new ConcurrentHashMap<>();
    private static final AtomicLong ids = new AtomicLong(50);
    private static final List<String> calls = java.util.Collections.synchronizedList(new java.util.ArrayList<>());
    private static volatile String lastCreateQuery = "";
    private static volatile boolean previewFails = false;

    @Autowired
    private MockMvc mockMvc;

    private final JsonMapper mapper = JsonMapper.builder().build();

    @BeforeAll
    static void startStubDolphin() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", JobScheduleApiTest::dispatch);
        server.start();
    }

    @AfterAll
    static void stopStubDolphin() {
        server.stop(0);
    }

    @DynamicPropertySource
    static void dolphinProperties(DynamicPropertyRegistry registry) {
        var base = "http://127.0.0.1:" + server.getAddress().getPort();
        registry.add("data-os.dolphinscheduler.base-url", () -> base);
        registry.add("data-os.dolphinscheduler.token", () -> "schedule-test-token");
        registry.add("data-os.dolphinscheduler.tenant-code", () -> "dataos-dev");
        registry.add("data-os.dolphinscheduler.time-zone", () -> "Asia/Shanghai");
    }

    private static void dispatch(HttpExchange exchange) throws IOException {
        var path = exchange.getRequestURI().getPath();
        var method = exchange.getRequestMethod();
        var query = URLDecoder.decode(
                exchange.getRequestURI().getRawQuery() == null ? "" : exchange.getRequestURI().getRawQuery(),
                StandardCharsets.UTF_8);
        calls.add(method + " " + path + (query.isBlank() ? "" : "?" + query));
        try {
            if (previewFails && path.endsWith("/preview")) {
                respond(exchange, 503, "{\"code\":1,\"msg\":\"down\"}");
                return;
            }
            if (path.endsWith("/preview") && method.equals("POST")) {
                respond(exchange, 200, """
                        {"code":0,"data":["2026-10-05 02:30:00","2026-10-06 02:30:00",
                        "2026-10-07 02:30:00","2026-10-08 02:30:00","2026-10-09 02:30:00"]}
                        """);
                return;
            }
            if (path.equals("/projects/90/schedules") && method.equals("GET")) {
                var workflow = param(query, "workflowDefinitionCode");
                var items = schedules.values().stream()
                        .filter(item -> String.valueOf(WORKFLOW_CODE).equals(workflow))
                        .toList();
                var totalList = items.stream().map(item -> mapper().valueToTree(item)).toList();
                respond(exchange, 200, "{\"code\":0,\"data\":{\"totalList\":"
                        + jsonList(totalList) + ",\"total\":" + items.size() + ",\"currentPage\":1}}");
                return;
            }
            if (path.equals("/projects/90/schedules") && method.equals("POST")) {
                lastCreateQuery = query;
                var id = ids.incrementAndGet();
                // HashMap 允许 nextFireTime 为 null（Map.of/ConcurrentHashMap 都会 NPE→500→误判瞬态）。
                var created = new HashMap<String, Object>();
                created.put("id", id);
                created.put("crontab", crontabFromSchedule(query));
                created.put("startTime", "2026-10-05 00:00:00");
                created.put("endTime", "2099-12-31 23:59:59");
                created.put("timezoneId", "Asia/Shanghai");
                created.put("releaseState", "OFFLINE");
                created.put("warningType", "NONE");
                created.put("nextFireTime", null);
                schedules.put(id, created);
                respond(exchange, 200, "{\"code\":0,\"data\":{\"id\":" + id + "}}");
                return;
            }
            var updateMatch = java.util.regex.Pattern.compile("/projects/90/schedules/(\\d+)$").matcher(path);
            if (updateMatch.matches() && method.equals("PUT")) {
                var id = Long.parseLong(updateMatch.group(1));
                var existing = schedules.get(id);
                if (existing == null) {
                    respond(exchange, 200, "{\"code\":10003,\"msg\":\"schedule not found\"}");
                    return;
                }
                schedules.put(id, new ConcurrentHashMap<>(Map.of(
                        "id", id,
                        "crontab", crontabFromSchedule(query),
                        "startTime", "2026-10-05 00:00:00",
                        "endTime", "2099-12-31 23:59:59",
                        "timezoneId", "Asia/Shanghai",
                        "releaseState", existing.get("releaseState"),
                        "warningType", "NONE")));
                respond(exchange, 200, "{\"code\":0,\"data\":true}");
                return;
            }
            var stateMatch = java.util.regex.Pattern.compile("/projects/90/schedules/(\\d+)/(online|offline)$").matcher(path);
            if (stateMatch.matches() && method.equals("POST")) {
                var id = Long.parseLong(stateMatch.group(1));
                var existing = schedules.get(id);
                if (existing == null) {
                    respond(exchange, 200, "{\"code\":10003,\"msg\":\"schedule not found\"}");
                    return;
                }
                schedules.put(id, new ConcurrentHashMap<>(Map.of(
                        "id", id,
                        "crontab", existing.get("crontab"),
                        "startTime", existing.get("startTime"),
                        "endTime", existing.get("endTime"),
                        "timezoneId", existing.get("timezoneId"),
                        "releaseState", "online".equals(stateMatch.group(2)) ? "ONLINE" : "OFFLINE",
                        "warningType", "NONE",
                        "nextFireTime", (Object) "2026-10-05 02:30:00")));
                respond(exchange, 200, "{\"code\":0,\"data\":true}");
                return;
            }
            var deleteMatch = java.util.regex.Pattern.compile("/projects/90/schedules/(\\d+)$").matcher(path);
            if (deleteMatch.matches() && method.equals("DELETE")) {
                schedules.remove(Long.parseLong(deleteMatch.group(1)));
                respond(exchange, 200, "{\"code\":0,\"data\":true}");
                return;
            }
            respond(exchange, 404, "{\"code\":1,\"msg\":\"no route\"}");
        } catch (RuntimeException exception) {
            respond(exchange, 500, "{\"code\":1,\"msg\":\"stub error\"}");
        }
    }

    private static com.fasterxml.jackson.databind.ObjectMapper mapper() {
        return new com.fasterxml.jackson.databind.ObjectMapper();
    }

    private static String jsonList(List<?> items) {
        try {
            return mapper().writeValueAsString(items);
        } catch (IOException exception) {
            throw new IllegalStateException(exception);
        }
    }

    private static String crontabFromSchedule(String query) {
        var matcher = java.util.regex.Pattern.compile("\"crontab\"\\s*:\\s*\"([^\"]+)\"").matcher(query);
        return matcher.find() ? matcher.group(1) : "0 30 2 * * ?";
    }

    private static String param(String query, String key) {
        for (var pair : query.split("&")) {
            var kv = pair.split("=", 2);
            if (kv.length == 2 && kv[0].equals(key)) return kv[1];
        }
        return null;
    }

    private static void respond(HttpExchange exchange, int status, String body) throws IOException {
        var bytes = body.getBytes(StandardCharsets.UTF_8);
        exchange.getResponseHeaders().set("Content-Type", "application/json");
        exchange.sendResponseHeaders(status, bytes.length);
        try (var output = exchange.getResponseBody()) {
            output.write(bytes);
        }
    }

    /** 任务创建要求来源在册；每用例独立登记一个，避免共享 H2 计数断言互相干扰。 */
    private String ensureSource() throws Exception {
        MvcResult created = mockMvc.perform(post("/api/v1/sources")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"调度联调源-" + UUID.randomUUID().toString().substring(0, 8)
                                + "\",\"systemType\":\"ETL\",\"protocol\":\"JDBC\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        return mapper.readTree(created.getResponse().getContentAsString()).path("id").asText();
    }

    private String createJob(String executor) throws Exception {
        var sourceId = ensureSource();
        MvcResult result = mockMvc.perform(post("/api/v1/jobs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"sourceId\":\"" + sourceId + "\",\"name\":\"调度任务-"
                                + UUID.randomUUID().toString().substring(0, 8)
                                + "\",\"mode\":\"BATCH\",\"executor\":\"" + executor + "\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        return mapper.readTree(result.getResponse().getContentAsString()).path("id").asText();
    }

    private void saveBinding(String jobId) throws Exception {
        mockMvc.perform(put("/api/v1/jobs/" + jobId + "/config")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"templateKey":"CUSTOM","config":{"dolphinscheduler":
                                {"projectCode":90,"workflowDefinitionCode":77}}}
                                """))
                .andExpect(status().isOk());
    }

    @Test
    void scheduleLifecycleForDolphinJob() throws Exception {
        var jobId = createJob("DOLPHINSCHEDULER");
        saveBinding(jobId);

        mockMvc.perform(get("/api/v1/jobs/" + jobId + "/schedule"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.scheduled").value(false));

        mockMvc.perform(put("/api/v1/jobs/" + jobId + "/schedule")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"crontab":"0 30 2 * * ?","startTime":"2026-10-05 00:00:00",
                                 "endTime":"2027-10-05 00:00:00"}
                                """))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.scheduled").value(true))
                .andExpect(jsonPath("$.online").value(false))
                .andExpect(jsonPath("$.crontab").value("0 30 2 * * ?"));

        // 创建面：DS 契约参数齐备（schedule JSON 内含 crontab/timezoneId，显式 tenantCode）。
        assertThat(lastCreateQuery).contains("workflowDefinitionCode=77");
        assertThat(lastCreateQuery).contains("tenantCode=dataos-dev");
        assertThat(lastCreateQuery).contains("\"crontab\":\"0 30 2 * * ?\"");
        assertThat(lastCreateQuery).contains("\"timezoneId\":\"Asia/Shanghai\"");

        mockMvc.perform(post("/api/v1/jobs/" + jobId + "/schedule/online"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.online").value(true))
                .andExpect(jsonPath("$.nextFireTime").exists());

        mockMvc.perform(post("/api/v1/jobs/" + jobId + "/schedule/offline"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.online").value(false));

        // 保存已存在的调度走更新面（PUT /schedules/{id}），不重复建档。
        calls.clear();
        mockMvc.perform(put("/api/v1/jobs/" + jobId + "/schedule")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"crontab\":\"0 15 3 * * ?\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.crontab").value("0 15 3 * * ?"))
                .andExpect(jsonPath("$.online").value(false));
        assertThat(calls.toString()).contains("PUT /projects/90/schedules/");
        assertThat(calls.toString()).doesNotContain("POST /projects/90/schedules?");

        mockMvc.perform(delete("/api/v1/jobs/" + jobId + "/schedule"))
                .andExpect(status().isNoContent());
        mockMvc.perform(get("/api/v1/jobs/" + jobId + "/schedule"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.scheduled").value(false));
        // 幂等删除：无调度时再删仍 204。
        mockMvc.perform(delete("/api/v1/jobs/" + jobId + "/schedule"))
                .andExpect(status().isNoContent());
    }

    @Test
    void previewPrefersEngineAndFallsBackLocally() throws Exception {
        var jobId = createJob("DOLPHINSCHEDULER");
        saveBinding(jobId);

        // DS 引擎路径：固定 5 次 02:30。
        MvcResult engine = mockMvc.perform(post("/api/v1/jobs/" + jobId + "/schedule/preview")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"crontab\":\"0 30 2 * * ?\",\"startTime\":\"2026-10-05 00:00:00\"}"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.source").value("DS"))
                .andReturn();
        JsonNode engineData = mapper.readTree(engine.getResponse().getContentAsString());
        assertThat(engineData.path("fireTimes")).hasSize(5);
        assertThat(engineData.path("fireTimes").get(0).asText())
                .isEqualTo("2026-10-04T18:30:00Z");

        // DS 不可达：本地 Spring cron 计算并如实标注 LOCAL；每日 02:30 的下一次。
        previewFails = true;
        try {
            MvcResult local = mockMvc.perform(post("/api/v1/jobs/" + jobId + "/schedule/preview")
                            .contentType(MediaType.APPLICATION_JSON)
                            .content("{\"crontab\":\"0 30 2 * * ?\",\"startTime\":\"2026-10-05 00:00:00\"}"))
                    .andExpect(status().isOk())
                    .andExpect(jsonPath("$.source").value("LOCAL"))
                    .andReturn();
            JsonNode localData = mapper.readTree(local.getResponse().getContentAsString());
            assertThat(localData.path("fireTimes")).hasSize(5);
            var times = new java.util.ArrayList<Instant>();
            localData.path("fireTimes").forEach(node -> times.add(Instant.parse(node.asText())));
            assertThat(times).isSorted();
            assertThat(times.get(0)).isEqualTo(Instant.parse("2026-10-04T18:30:00Z"));
        } finally {
            previewFails = false;
        }
    }

    @Test
    void guardsChannelsBindingAndCron() throws Exception {
        // 非平台调度通道：409。
        var seatunnelJob = createJob("SEATUNNEL");
        mockMvc.perform(get("/api/v1/jobs/" + seatunnelJob + "/schedule"))
                .andExpect(status().isConflict());

        // 平台调度任务但缺绑定：409 且消息指向绑定登记。
        var unbound = createJob("DOLPHINSCHEDULER");
        mockMvc.perform(get("/api/v1/jobs/" + unbound + "/schedule"))
                .andExpect(status().isConflict())
                .andExpect(jsonPath("$.message").value(
                        org.hamcrest.Matchers.containsString("工作流绑定")));

        // 未知任务：404；上线前置：须先保存调度（409）。
        mockMvc.perform(get("/api/v1/jobs/no-such-job/schedule"))
                .andExpect(status().isNotFound());
        var bound = createJob("DOLPHINSCHEDULER");
        saveBinding(bound);
        mockMvc.perform(post("/api/v1/jobs/" + bound + "/schedule/online"))
                .andExpect(status().isConflict());

        // cron 非法 / 时间格式非法 / 起止倒置：400。
        mockMvc.perform(put("/api/v1/jobs/" + bound + "/schedule")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"crontab\":\"not a cron\"}"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(put("/api/v1/jobs/" + bound + "/schedule")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"crontab\":\"0 30 2 * * ?\",\"startTime\":\"2026/10/05\"}"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(put("/api/v1/jobs/" + bound + "/schedule")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("""
                                {"crontab":"0 30 2 * * ?","startTime":"2027-01-01 00:00:00",
                                 "endTime":"2026-01-01 00:00:00"}
                                """))
                .andExpect(status().isBadRequest());
    }
}
