package com.cywu.dataos.controlplane.assistant;

import java.util.List;
import java.util.Map;
import java.util.UUID;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.anyMap;
import static org.mockito.ArgumentMatchers.anyString;
import static org.mockito.Mockito.when;

import com.cywu.dataos.controlplane.api.InvalidRequestException;
import com.cywu.dataos.controlplane.api.ResourceNotFoundException;
import com.cywu.dataos.controlplane.executor.AdapterUnavailableException;

/**
 * 受控智能问数业务规则（G26）：确定性匹配（代码/问题/别名，同义表达命中同一
 * 代码）、参数 Schema 校验、拒答信封与审计留痕（含拒答行）、执行面语义化
 * 失败映射、执行面未配置的诚实拒答、反馈回写可追溯。执行面以 MockBean 承载。
 */
@SpringBootTest
@ActiveProfiles("test")
class AssistantAdminServiceTest {

    private static final String TENANT = "default";

    @Autowired
    private AssistantAdminService service;

    @Autowired
    private AssistantRepository repository;

    @MockBean
    private AssistantDataApiClient dataApi;

    // ---- 夹具 ----

    /** 三个问题来自 V20 迁移种子（tenant default，PUBLISHED）。 */
    private static final String SUMMARY_QUESTION = "查询一段时间内每天的处方量趋势";
    private static final String SUMMARY_ALIAS = "每日处方量趋势";

    private AssistantDataApiClient.QueryResult result(int rowCount) {
        return new AssistantDataApiClient.QueryResult("prescription-daily-summary", "v1",
                List.of("stat_date", "order_count"),
                List.of(List.of("2026-09-01", 331), List.of("2026-09-02", 298)),
                rowCount, false, 42);
    }

    // ---- 问题清单 ----

    @Test
    void publishedQuestionsAreListedFromSeed() {
        var payload = service.questions(TENANT);
        // 治理面测试会在同租户发布临时问题：种子用存在性断言而非精确计数（顺序无关）
        assertThat((Integer) payload.get("total")).isGreaterThanOrEqualTo(3);
        var questions = (List<?>) payload.get("questions");
        var codes = questions.stream().map(item -> String.valueOf(((Map<?, ?>) item).get("code"))).toList();
        assertThat(codes).contains("prescription-daily-summary", "prescription-department-daily",
                "medicine-record-daily");
    }

    // ---- 匹配 ----

    @Test
    void deterministicMatchingHitsCodeQuestionAndAlias() {
        when(dataApi.configured()).thenReturn(true);
        when(dataApi.query(anyString(), anyMap())).thenReturn(result(2));

        for (String text : List.of("prescription-daily-summary", SUMMARY_QUESTION,
                SUMMARY_ALIAS, "  每日处方量趋势？ ")) {
            var answer = service.query(TENANT, text,
                    Map.of("start_date", "2026-09-01", "end_date", "2026-09-02"));
            assertThat(answer.get("answered")).as("text=%s", text).isEqualTo(true);
            assertThat(((Map<?, ?>) answer.get("question")).get("code"))
                    .isEqualTo("prescription-daily-summary");
        }
    }

    @Test
    void unknownQuestionIsRefusedWithAuditAndHints() {
        var answer = service.query(TENANT, "帮我预测下个月挂号量",
                Map.of("start_date", "2026-09-01", "end_date", "2026-09-02"));
        assertThat(answer.get("answered")).isEqualTo(false);
        assertThat(answer.get("outcome")).isEqualTo("REFUSED_NO_MATCH");
        assertThat(((List<?>) answer.get("supportedQuestions")).stream().map(String::valueOf).toList())
                .contains(SUMMARY_QUESTION, "查询各科室每天的处方量", "查询每天的用药记录量");
        // 拒答同样落审计行
        var audits = repository.findAudits(TENANT, 10);
        assertThat(audits.stream().anyMatch(audit -> "REFUSED_NO_MATCH".equals(audit.outcome())
                && audit.questionCode().isEmpty())).isTrue();
    }

    // ---- 参数校验 ----

    @Test
    void invalidParametersAreRefusedWithoutTouchingExecutor() {
        var answer = service.query(TENANT, SUMMARY_QUESTION,
                Map.of("start_date", "2026/09/01", "end_date", "2026-09-02"));
        assertThat(answer.get("answered")).isEqualTo(false);
        assertThat(answer.get("outcome")).isEqualTo("REFUSED_PARAM_INVALID");
        assertThat(String.valueOf(answer.get("reason"))).contains("start_date");

        // 缺必填 / 未知参数 / 非法日期（2 月 30 日）同样拒答
        assertThat(service.query(TENANT, SUMMARY_QUESTION, Map.of("start_date", "2026-09-01"))
                .get("outcome")).isEqualTo("REFUSED_PARAM_INVALID");
        assertThat(service.query(TENANT, SUMMARY_QUESTION,
                Map.of("start_date", "2026-09-01", "end_date", "2026-09-02", "hospital", "H001"))
                .get("outcome")).isEqualTo("REFUSED_PARAM_INVALID");
        assertThat(service.query(TENANT, SUMMARY_QUESTION,
                Map.of("start_date", "2026-02-30", "end_date", "2026-03-01"))
                .get("outcome")).isEqualTo("REFUSED_PARAM_INVALID");
        // 参数被拒时不触达执行面（无 SQL 副作用）
        org.mockito.Mockito.verifyNoInteractions(dataApi);
    }

    // ---- 主链与证据 ----

    @Test
    void answeredQueryCarriesTemplateEvidenceAndAuditRow() {
        when(dataApi.configured()).thenReturn(true);
        when(dataApi.query(anyString(), anyMap())).thenReturn(result(2));

        var answer = service.query(TENANT, SUMMARY_QUESTION,
                Map.of("start_date", "2026-09-01", "end_date", "2026-09-02"));
        assertThat(answer.get("answered")).isEqualTo(true);
        // 回答模板已渲染（参数与计数占位）
        assertThat(String.valueOf(answer.get("answer")))
                .contains("2026-09-01 至 2026-09-02")
                .contains("共 2 天")
                .contains("prescription-daily-summary v1");
        // 证据面：服务版本、统计窗口、行数、耗时、执行路径
        var evidence = (Map<?, ?>) answer.get("evidence");
        assertThat(evidence.get("serviceVersion")).isEqualTo("v1");
        assertThat(evidence.get("rowCount")).isEqualTo(2);
        assertThat(evidence.get("elapsedMs")).isEqualTo(42);
        assertThat(String.valueOf(evidence.get("executionPath"))).contains("data-api");
        // 审计行可追溯（ANSWERED + 参数摘要 + 行数/耗时）
        var auditId = String.valueOf(answer.get("auditId"));
        var audit = repository.findAudit(TENANT, auditId).orElseThrow();
        assertThat(audit.outcome()).isEqualTo("ANSWERED");
        assertThat(audit.questionCode()).isEqualTo("prescription-daily-summary");
        assertThat(audit.paramsJson()).contains("start_date");
        assertThat(audit.rowCount()).isEqualTo(2);
        // 审计不存结果行（表结构即约束；断言 payload 字段面）
        assertThat(audit.getClass().getRecordComponents()).extracting(java.lang.reflect.RecordComponent::getName)
                .doesNotContain("rows");
    }

    // ---- 执行面语义化失败 ----

    @Test
    void executorOutcomesMapToExplicitRefusals() {
        when(dataApi.configured()).thenReturn(true);
        Map<String, Object> params = Map.of("start_date", "2026-09-01", "end_date", "2026-09-02");

        // 同方法多次换桩必须走 doThrow 家族：when(...) 二次包装会触发前一桩真实抛出
        org.mockito.Mockito.doThrow(new AssistantDataApiClient.QueryRejected("SERVICE_OFFLINE", "服务不存在或未发布"))
                .when(dataApi).query(anyString(), anyMap());
        assertThat(service.query(TENANT, SUMMARY_QUESTION, params).get("outcome"))
                .isEqualTo("REFUSED_SERVICE_OFFLINE");

        org.mockito.Mockito.doThrow(new AssistantDataApiClient.QueryRejected("RATE_LIMITED", "限流中"))
                .when(dataApi).query(anyString(), anyMap());
        assertThat(service.query(TENANT, SUMMARY_QUESTION, params).get("outcome"))
                .isEqualTo("REFUSED_RATE_LIMITED");

        org.mockito.Mockito.doThrow(new AdapterUnavailableException("Data API 503"))
                .when(dataApi).query(anyString(), anyMap());
        assertThat(service.query(TENANT, SUMMARY_QUESTION, params).get("outcome"))
                .isEqualTo("REFUSED_UNAVAILABLE");
    }

    @Test
    void unconfiguredExecutorRefusesHonestly() {
        when(dataApi.configured()).thenReturn(false);
        var answer = service.query(TENANT, SUMMARY_QUESTION,
                Map.of("start_date", "2026-09-01", "end_date", "2026-09-02"));
        assertThat(answer.get("answered")).isEqualTo(false);
        assertThat(answer.get("outcome")).isEqualTo("REFUSED_UNAVAILABLE");
    }

    // ---- 反馈 ----

    @Test
    void feedbackIsTraceableToAuditRow() {
        when(dataApi.configured()).thenReturn(true);
        when(dataApi.query(anyString(), anyMap())).thenReturn(result(2));
        var answer = service.query(TENANT, SUMMARY_QUESTION,
                Map.of("start_date", "2026-09-01", "end_date", "2026-09-02"));
        var auditId = String.valueOf(answer.get("auditId"));

        var recorded = service.feedback(TENANT, auditId, "helpful", "口径正确");
        assertThat(recorded.get("recorded")).isEqualTo(true);
        var audit = repository.findAudit(TENANT, auditId).orElseThrow();
        assertThat(audit.feedbackRating()).isEqualTo("helpful");
        assertThat(audit.feedbackNote()).isEqualTo("口径正确");
        assertThat(audit.feedbackAt()).isNotNull();

        // 非法 rating / 未知审计行
        assertThatThrownBy(() -> service.feedback(TENANT, auditId, "great", ""))
                .isInstanceOf(InvalidRequestException.class);
        assertThatThrownBy(() -> service.feedback(TENANT, UUID.randomUUID().toString(), "helpful", ""))
                .isInstanceOf(ResourceNotFoundException.class);
    }

    // ---- 跨租户（DISABLED 模式 TenantScope 回落默认租户，租户隔离在仓储层断言；
    //      角色与越租户 403 面归 AssistantSecurityTest 的 JWT 桩）----

    @Test
    void questionsAreTenantScopedAtRepositoryLevel() {
        assertThat(repository.findPublished("tenant-zzz")).isEmpty();
    }
}
