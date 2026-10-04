package com.cywu.dataos.controlplane.job;

import static org.assertj.core.api.Assertions.assertThat;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.put;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.jsonPath;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import java.io.IOException;
import java.net.InetSocketAddress;
import java.net.URLDecoder;
import java.nio.charset.StandardCharsets;
import java.util.List;
import java.util.Map;
import java.util.UUID;
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
 * G2G 批次 5 第二刀契约测试：调度实例面（列表/任务/日志/终止/重跑/补数）。
 * stub DS workflow-instances + /log/detail + executors 全状态机。
 */
@SpringBootTest
@AutoConfigureMockMvc
@ActiveProfiles("test")
class JobScheduleInstancesApiTest {

    private static final long PROJECT_CODE = 90;
    private static final long WORKFLOW_CODE = 77;

    private static HttpServer server;
    private static final Map<Long, Map<String, Object>> instances = new ConcurrentHashMap<>();
    private static final AtomicLong ids = new AtomicLong(700);
    private static final List<String> calls = java.util.Collections.synchronizedList(new java.util.ArrayList<>());
    private static volatile String lastBackfillQuery = "";

    @Autowired
    private MockMvc mockMvc;

    private final JsonMapper mapper = JsonMapper.builder().build();

    @BeforeAll
    static void startStubDolphin() throws IOException {
        server = HttpServer.create(new InetSocketAddress("127.0.0.1", 0), 0);
        server.createContext("/", JobScheduleInstancesApiTest::dispatch);
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
        registry.add("data-os.dolphinscheduler.token", () -> "instance-test-token");
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
            // 实例分页
            if (path.equals("/projects/90/workflow-instances") && method.equals("GET")) {
                var workflow = param(query, "workflowDefinitionCode");
                var items = instances.values().stream()
                        .filter(item -> String.valueOf(WORKFLOW_CODE).equals(workflow))
                        .sorted((a, b) -> Long.compare((long) b.get("id"), (long) a.get("id")))
                        .toList();
                var totalList = items.stream().map(mapper()::valueToTree).toList();
                respond(exchange, 200, "{\"code\":0,\"data\":{\"totalList\":"
                        + jsonList(totalList) + ",\"total\":" + items.size() + ",\"currentPage\":1}}");
                return;
            }
            // 任务实例
            var tasksMatch = java.util.regex.Pattern.compile("/projects/90/workflow-instances/(\\d+)/tasks$").matcher(path);
            if (tasksMatch.matches() && method.equals("GET")) {
                respond(exchange, 200, """
                        {"code":0,"data":{"taskList":[
                          {"id":31,"name":"sql-抽取","state":"SUCCESS","startTime":"2026-10-05 02:30:10","endTime":"2026-10-05 02:31:02"},
                          {"id":32,"name":"shell-校验","state":"FAILURE","startTime":"2026-10-05 02:31:05","endTime":"2026-10-05 02:31:40"}]}}
                        """);
                return;
            }
            // 日志 tail
            if (path.equals("/log/detail") && method.equals("GET")) {
                respond(exchange, 200, "{\"code\":0,\"data\":{\"message\":\"line-1\\nline-2\\nline-3\",\"lineNum\":3}}");
                return;
            }
            // 实例动作（STOP / REPEAT_RUNNING）
            if (path.equals("/projects/90/executors/execute") && method.equals("POST")) {
                var instanceId = Long.parseLong(param(query, "workflowInstanceId"));
                var type = param(query, "executeType");
                var instance = instances.get(instanceId);
                if (instance == null) {
                    respond(exchange, 200, "{\"code\":10003,\"msg\":\"instance not found\"}");
                    return;
                }
                instance.put("state", "STOP".equals(type) ? "STOP" : "RUNNING_EXECUTION");
                respond(exchange, 200, "{\"code\":0,\"data\":true}");
                return;
            }
            // 补数（COMPLEMENT_DATA）
            if (path.equals("/projects/90/executors/start-workflow-instance") && method.equals("POST")) {
                lastBackfillQuery = query;
                if (!"COMPLEMENT_DATA".equals(param(query, "execType"))) {
                    respond(exchange, 200, "{\"code\":0,\"data\":true}");
                    return;
                }
                var range = param(query, "scheduleTime").split(",");
                var start = java.time.LocalDate.parse(range[0].trim().substring(0, 10));
                var end = java.time.LocalDate.parse(range[1].trim().substring(0, 10));
                for (var day = start; !day.isAfter(end); day = day.plusDays(1)) {
                    var id = ids.incrementAndGet();
                    var created = new java.util.HashMap<String, Object>();
                    created.put("id", id);
                    created.put("name", "补数-" + day);
                    created.put("state", "SUBMITTED_SUCCESS");
                    created.put("startTime", day.atTime(2, 30).toString().replace('T', ' '));
                    created.put("endTime", null);
                    created.put("runTimes", 1);
                    created.put("host", null);
                    instances.put(id, created);
                }
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

    private String createDolphinJob() throws Exception {
        MvcResult source = mockMvc.perform(post("/api/v1/sources")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"实例联调源-" + UUID.randomUUID().toString().substring(0, 8)
                                + "\",\"systemType\":\"ETL\",\"protocol\":\"JDBC\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        var sourceId = mapper.readTree(source.getResponse().getContentAsString()).path("id").asText();
        MvcResult job = mockMvc.perform(post("/api/v1/jobs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"sourceId\":\"" + sourceId + "\",\"name\":\"实例任务-"
                                + UUID.randomUUID().toString().substring(0, 8)
                                + "\",\"mode\":\"BATCH\",\"executor\":\"DOLPHINSCHEDULER\"}"))
                .andExpect(status().isCreated())
                .andReturn();
        var jobId = mapper.readTree(job.getResponse().getContentAsString()).path("id").asText();
        mockMvc.perform(put("/api/v1/jobs/" + jobId + "/config")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"templateKey\":\"CUSTOM\",\"config\":{\"dolphinscheduler\":"
                                + "{\"projectCode\":90,\"workflowDefinitionCode\":77}}}"))
                .andExpect(status().isOk());
        return jobId;
    }

    private long seedInstance(String state) {
        var id = ids.incrementAndGet();
        var instance = new java.util.HashMap<String, Object>();
        instance.put("id", id);
        instance.put("name", "夜批-" + id);
        instance.put("state", state);
        instance.put("startTime", "2026-10-05 02:30:00");
        instance.put("endTime", "2026-10-05 02:32:00");
        instance.put("runTimes", 1);
        instance.put("host", "worker-1");
        instances.put(id, instance);
        return id;
    }

    @Test
    void listsNormalizesAndGuards() throws Exception {
        var jobId = createDolphinJob();
        seedInstance("RUNNING_EXECUTION");
        var failedId = seedInstance("FAILURE");

        MvcResult list = mockMvc.perform(get("/api/v1/jobs/" + jobId + "/instances")
                        .param("page", "1").param("size", "10"))
                .andExpect(status().isOk())
                .andReturn();
        JsonNode data = mapper.readTree(list.getResponse().getContentAsString());
        assertThat(data.path("total").asLong()).isGreaterThanOrEqualTo(2);
        var states = new java.util.ArrayList<String>();
        data.path("items").forEach(item -> states.add(item.path("state").asText()));
        assertThat(states).contains("RUNNING", "FAILED");
        // rawState 保留 DS 原文
        assertThat(data.path("items").toString()).contains("RUNNING_EXECUTION").contains("FAILURE");

        // 状态过滤 + 非法过滤值
        mockMvc.perform(get("/api/v1/jobs/" + jobId + "/instances").param("state", "FAILURE"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.items[0].state").value("FAILED"));
        mockMvc.perform(get("/api/v1/jobs/" + jobId + "/instances").param("state", "'; drop"))
                .andExpect(status().isBadRequest());

        // 通道守卫：SEATUNNEL 任务 409
        MvcResult source = mockMvc.perform(post("/api/v1/sources")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"name\":\"实例守卫源\",\"systemType\":\"HIS\",\"protocol\":\"JDBC\"}"))
                .andExpect(status().isCreated()).andReturn();
        var seatunnelJob = mockMvc.perform(post("/api/v1/jobs")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"sourceId\":\"" + mapper.readTree(source.getResponse().getContentAsString()).path("id").asText()
                                + "\",\"name\":\"守卫任务\",\"mode\":\"BATCH\",\"executor\":\"SEATUNNEL\"}"))
                .andExpect(status().isCreated()).andReturn();
        mockMvc.perform(get("/api/v1/jobs/"
                        + mapper.readTree(seatunnelJob.getResponse().getContentAsString()).path("id").asText() + "/instances"))
                .andExpect(status().isConflict());

        // 清场：删除本用例种子实例，避免共享 H2 计数漂移（实例在 stub 内，跨用例独立）
        instances.clear();
    }

    @Test
    void tasksAndLogTail() throws Exception {
        var jobId = createDolphinJob();
        var instanceId = seedInstance("SUCCESS");

        mockMvc.perform(get("/api/v1/jobs/" + jobId + "/instances/" + instanceId + "/tasks"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$[0].name").value("sql-抽取"))
                .andExpect(jsonPath("$[0].state").value("SUCCEEDED"))
                .andExpect(jsonPath("$[1].state").value("FAILED"));

        mockMvc.perform(get("/api/v1/jobs/" + jobId + "/instances/" + instanceId + "/tasks/31/log"))
                .andExpect(status().isOk())
                .andExpect(jsonPath("$.lines").value(3))
                .andExpect(jsonPath("$.logText").value("line-1\nline-2\nline-3"));
        // 行数上限收敛
        mockMvc.perform(get("/api/v1/jobs/" + jobId + "/instances/" + instanceId + "/tasks/31/log")
                        .param("lines", "99999"))
                .andExpect(status().isOk());
        assertThat(calls.toString()).contains("limit=1000");

        // 跨任务日志：不属于该实例的任务面（实例在册但任务 999 无关——本刀以任务面归属兜底，stub 恒返回任务故放行；
        // 归属硬校验由「实例不属于该任务绑定的工作流」路径覆盖）
        instances.clear();
    }

    @Test
    void stopRetryAndBackfill() throws Exception {
        var jobId = createDolphinJob();
        var runningId = seedInstance("RUNNING_EXECUTION");
        var failedId = seedInstance("FAILURE");

        // 终止运行中实例 → STOP
        mockMvc.perform(post("/api/v1/jobs/" + jobId + "/instances/" + runningId + "/stop"))
                .andExpect(status().isOk());
        assertThat(instances.get(runningId).get("state")).isEqualTo("STOP");

        // 终止已停止实例 → 409 状态不允许
        mockMvc.perform(post("/api/v1/jobs/" + jobId + "/instances/" + runningId + "/stop"))
                .andExpect(status().isConflict());

        // 重跑失败实例 → RUNNING
        mockMvc.perform(post("/api/v1/jobs/" + jobId + "/instances/" + failedId + "/retry"))
                .andExpect(status().isOk());
        assertThat(instances.get(failedId).get("state")).isEqualTo("RUNNING_EXECUTION");

        // 补数：3 天区间 → 3 个新实例；DS 契约参数齐备
        instances.clear();
        mockMvc.perform(post("/api/v1/jobs/" + jobId + "/instances/backfill")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"startDate\":\"2026-10-01\",\"endDate\":\"2026-10-03\"}"))
                .andExpect(status().isOk());
        assertThat(lastBackfillQuery).contains("execType=COMPLEMENT_DATA");
        assertThat(lastBackfillQuery).contains("tenantCode=dataos-dev");
        assertThat(lastBackfillQuery).contains("scheduleTime=2026-10-01 00:00:00,2026-10-03 00:00:00");
        assertThat(instances).hasSize(3);

        // 补数校验：倒置 400、超限 400、格式 400
        mockMvc.perform(post("/api/v1/jobs/" + jobId + "/instances/backfill")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"startDate\":\"2026-10-05\",\"endDate\":\"2026-10-01\"}"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(post("/api/v1/jobs/" + jobId + "/instances/backfill")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"startDate\":\"2026-01-01\",\"endDate\":\"2026-12-31\"}"))
                .andExpect(status().isBadRequest());
        mockMvc.perform(post("/api/v1/jobs/" + jobId + "/instances/backfill")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"startDate\":\"2026/10/01\",\"endDate\":\"2026/10/02\"}"))
                .andExpect(status().isBadRequest());
        instances.clear();
    }
}
