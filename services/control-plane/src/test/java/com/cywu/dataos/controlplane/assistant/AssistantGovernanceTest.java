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
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.when;

import com.cywu.dataos.controlplane.api.ConflictException;
import com.cywu.dataos.controlplane.api.InvalidRequestException;

/**
 * 问数治理面业务规则（G27）：草稿生命周期（建/改/删仅 DRAFT）、发布门
 * （最近成功试运行须晚于最后编辑）、停用与重新起草闭环、试运行审计
 * test-run 标记、治理列表发布门证据、参数 Schema 形状校验。执行面 MockBean。
 */
@SpringBootTest
@ActiveProfiles("test")
class AssistantGovernanceTest {

    private static final String TENANT = "default";

    @Autowired
    private AssistantAdminService service;

    @Autowired
    private AssistantRepository repository;

    @MockBean
    private AssistantDataApiClient dataApi;

    // ---- 夹具 ----

    private String uniqueCode() {
        return "gov-" + UUID.randomUUID().toString().substring(0, 8);
    }

    private AssistantAdminService.QuestionDraft draft(String code) {
        return new AssistantAdminService.QuestionDraft(
                code, "治理测试问题 " + code, List.of("治理别名" + code),
                List.of(Map.of("name", "start_date", "type", "date", "required", true)),
                "prescription-daily-summary", "共 {row_count} 行");
    }

    private AssistantDataApiClient.QueryResult result() {
        return new AssistantDataApiClient.QueryResult("prescription-daily-summary", "v1",
                List.of("stat_date"), List.of(List.of("2026-09-01")), 1, false, 5);
    }

    private void passTestRun(String code) {
        when(dataApi.configured()).thenReturn(true);
        when(dataApi.query(anyString(), anyMap())).thenReturn(result());
        var outcome = service.testQuestion(TENANT, code, Map.of("start_date", "2026-09-01"));
        assertThat(outcome.get("answered")).isEqualTo(true);
        assertThat(outcome.get("testRun")).isEqualTo(true);
    }

    // ---- 草稿创建与校验 ----

    @Test
    void createDraftRecordsEventAndShowsVerificationGap() {
        var code = uniqueCode();
        var created = service.createQuestion(TENANT, draft(code));
        assertThat(created.get("status")).isEqualTo("DRAFT");

        var listed = (List<?>) service.adminQuestions(TENANT).get("questions");
        var view = (Map<?, ?>) listed.stream()
                .filter(item -> code.equals(((Map<?, ?>) item).get("code"))).findFirst().orElseThrow();
        assertThat(view.get("status")).isEqualTo("DRAFT");
        assertThat(view.get("verified")).isEqualTo(false);
        assertThat(view.get("lastPassedTestRun")).isNull();

        var events = (List<?>) service.questionEvents(TENANT, code, 50).get("events");
        assertThat(((Map<?, ?>) events.get(0)).get("action")).isEqualTo("CREATED");
    }

    @Test
    void createRejectsBadCodeDuplicateAndBadSchema() {
        assertThatThrownBy(() -> service.createQuestion(TENANT,
                new AssistantAdminService.QuestionDraft("Bad_Code", "问题", null, null,
                        "prescription-daily-summary", "")))
                .isInstanceOf(InvalidRequestException.class);
        assertThatThrownBy(() -> service.createQuestion(TENANT, draft("prescription-daily-summary")))
                .isInstanceOf(ConflictException.class);
        assertThatThrownBy(() -> service.createQuestion(TENANT,
                new AssistantAdminService.QuestionDraft(uniqueCode(), "问题", null,
                        List.of(Map.of("name", "d", "type", "datetime")),
                        "prescription-daily-summary", "")))
                .isInstanceOf(InvalidRequestException.class)
                .hasMessageContaining("paramSchema.type");
        assertThatThrownBy(() -> service.createQuestion(TENANT,
                new AssistantAdminService.QuestionDraft(uniqueCode(), "问题", null,
                        List.of(Map.of("name", "d", "type", "date"),
                                Map.of("name", "d", "type", "date")),
                        "prescription-daily-summary", "")))
                .isInstanceOf(InvalidRequestException.class)
                .hasMessageContaining("重复");
    }

    // ---- 编辑边界 ----

    @Test
    void onlyDraftsAreEditableAndCodeIsImmutable() {
        var code = uniqueCode();
        service.createQuestion(TENANT, draft(code));
        var updated = service.updateQuestion(TENANT, code, new AssistantAdminService.QuestionDraft(
                code, "改后的治理问题", List.of("新别名"), List.of(),
                "medicine-record-daily", "新模板"));
        assertThat(updated.get("status")).isEqualTo("DRAFT");

        // code 不可改
        assertThatThrownBy(() -> service.updateQuestion(TENANT, code,
                new AssistantAdminService.QuestionDraft("other-code", "问题", null, null,
                        "prescription-daily-summary", "")))
                .isInstanceOf(InvalidRequestException.class)
                .hasMessageContaining("不可修改");

        // 种子 PUBLISHED 问题不可编辑
        assertThatThrownBy(() -> service.updateQuestion(TENANT, "medicine-record-daily",
                draft("medicine-record-daily")))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("仅草稿可编辑");
    }

    // ---- 发布门 ----

    @Test
    void publishRequiresFreshSuccessfulTestRun() {
        var code = uniqueCode();
        service.createQuestion(TENANT, draft(code));

        // 未试运行 → 拒绝发布
        assertThatThrownBy(() -> service.publishQuestion(TENANT, code))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("尚无成功试运行");

        // 试运行被拒（参数错）→ 仍无成功记录
        var refused = service.testQuestion(TENANT, code, Map.of("start_date", "not-a-date"));
        assertThat(refused.get("answered")).isEqualTo(false);
        assertThat(refused.get("testRun")).isEqualTo(true);
        assertThatThrownBy(() -> service.publishQuestion(TENANT, code))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("尚无成功试运行");

        // 成功试运行 → 可发布
        passTestRun(code);
        assertThat(service.publishQuestion(TENANT, code).get("status")).isEqualTo("PUBLISHED");

        // 发布后进入问答面
        var questions = (List<?>) service.questions(TENANT).get("questions");
        assertThat(questions.stream().anyMatch(
                item -> code.equals(((Map<?, ?>) item).get("code")))).isTrue();
    }

    @Test
    void editingAfterTestRunInvalidatesPublishGate() {
        var code = uniqueCode();
        service.createQuestion(TENANT, draft(code));
        passTestRun(code);
        // 编辑使试运行失效（updated_at 前移）
        service.updateQuestion(TENANT, code, draft(code));
        assertThatThrownBy(() -> service.publishQuestion(TENANT, code))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("晚于最后一次编辑");
        // 重新试运行后可发布
        passTestRun(code);
        assertThat(service.publishQuestion(TENANT, code).get("status")).isEqualTo("PUBLISHED");
    }

    // ---- 停用 / 重新起草 / 删除 ----

    @Test
    void deprecateRemovesFromAskSurfaceAndReopenRestoresDraft() {
        var code = uniqueCode();
        service.createQuestion(TENANT, draft(code));
        passTestRun(code);
        service.publishQuestion(TENANT, code);

        assertThat(service.deprecateQuestion(TENANT, code).get("status")).isEqualTo("DEPRECATED");

        // 问答面不再匹配（问题文本与别名均拒答）
        var refused = service.query(TENANT, "治理测试问题 " + code, Map.of());
        assertThat(refused.get("answered")).isEqualTo(false);
        assertThat(refused.get("outcome")).isEqualTo("REFUSED_NO_MATCH");

        // 停用后不可试运行/编辑；重新起草回 DRAFT
        assertThatThrownBy(() -> service.testQuestion(TENANT, code, Map.of()))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("重新起草");
        assertThat(service.reopenQuestion(TENANT, code).get("status")).isEqualTo("DRAFT");

        // 事件链完整（倒序：UPDATED(reopen) → DEPRECATED → PUBLISHED → CREATED）
        var events = (List<?>) service.questionEvents(TENANT, code, 50).get("events");
        assertThat(events.stream().map(item -> String.valueOf(((Map<?, ?>) item).get("action"))).toList())
                .containsExactly("UPDATED", "DEPRECATED", "PUBLISHED", "CREATED");
    }

    @Test
    void onlyDraftsAreDeletable() {
        var code = uniqueCode();
        service.createQuestion(TENANT, draft(code));
        assertThat(service.deleteQuestion(TENANT, code).get("deleted")).isEqualTo(true);
        assertThatThrownBy(() -> service.questionEvents(TENANT, code, 50))
                .isInstanceOf(com.cywu.dataos.controlplane.api.ResourceNotFoundException.class);

        // 种子 PUBLISHED 不可删（须停用留痕）
        assertThatThrownBy(() -> service.deleteQuestion(TENANT, "medicine-record-daily"))
                .isInstanceOf(ConflictException.class)
                .hasMessageContaining("仅草稿可删除");
    }

    // ---- 试运行审计标记 ----

    @Test
    void testRunWritesAuditRowWithMarkerAndPassesThroughExecutor() {
        var code = uniqueCode();
        service.createQuestion(TENANT, draft(code));
        passTestRun(code);

        var audits = repository.findAudits(TENANT, 50);
        var testAudit = audits.stream()
                .filter(item -> code.equals(item.questionCode())).findFirst().orElseThrow();
        assertThat(testAudit.outcome()).isEqualTo("ANSWERED");
        assertThat(testAudit.detail()).isEqualTo("test-run");
        assertThat(testAudit.rowCount()).isEqualTo(1);
    }

    // ---- 审计管理面与事件总数（G27 余项）----

    @Test
    void auditSurfaceFiltersByOutcomeAndPages() {
        var code = uniqueCode();
        service.createQuestion(TENANT, draft(code));
        // 一次拒答（坏日期）+ 一次成功试运行
        service.testQuestion(TENANT, code, Map.of("start_date", "bad-date"));
        passTestRun(code);

        var all = service.audits(TENANT, "", 0, 10);
        assertThat((Integer) all.get("total")).isGreaterThanOrEqualTo(2);
        assertThat(((List<?>) all.get("audits")).size()).isGreaterThanOrEqualTo(2);

        var refusedOnly = service.audits(TENANT, "REFUSED_PARAM_INVALID", 0, 10);
        assertThat(((List<?>) refusedOnly.get("audits")))
                .allSatisfy(item -> assertThat(((Map<?, ?>) item).get("outcome")).isEqualTo("REFUSED_PARAM_INVALID"));
        assertThat(((List<?>) refusedOnly.get("audits")).size()).isGreaterThanOrEqualTo(1);

        // 分页：pageSize=1 时首页 1 条、total 不变
        var paged = service.audits(TENANT, "", 0, 1);
        assertThat(((List<?>) paged.get("audits"))).hasSize(1);
        assertThat(paged.get("total")).isEqualTo(all.get("total"));
        // pageSize 钳制上限 100
        assertThat(service.audits(TENANT, "", 0, 10_000).get("pageSize")).isEqualTo(100);
    }

    @Test
    void auditCsvEscapesAndCarriesFeedbackColumns() {
        var code = uniqueCode();
        service.createQuestion(TENANT, draft(code));
        var refused = service.testQuestion(TENANT, code, Map.of("start_date", "bad-date"));
        assertThat(refused.get("answered")).isEqualTo(false);
        // 反馈带逗号与引号（CSV 转义口径）
        service.feedback(TENANT, String.valueOf(refused.get("auditId")), "not_helpful", "含,逗号\"引号");

        var csv = service.auditCsv(TENANT, "");
        assertThat(csv).startsWith("audit_id,created_at,user_id,institution_id,question_text");
        assertThat(csv).contains("REFUSED_PARAM_INVALID");
        assertThat(csv).contains("\"含,逗号\"\"引号\"");  // RFC 4180：整体加引号 + 引号双写
        var filtered = service.auditCsv(TENANT, "ANSWERED");
        assertThat(filtered).doesNotContain(code);
    }

    @Test
    void questionEventsExposeTotalForHonestTruncation() {
        var code = uniqueCode();
        service.createQuestion(TENANT, draft(code));
        passTestRun(code);
        service.publishQuestion(TENANT, code);

        var payload = service.questionEvents(TENANT, code, 1);
        assertThat(payload.get("total")).isEqualTo(2);  // CREATED + PUBLISHED
        assertThat(payload.get("returned")).isEqualTo(1);
        assertThat(((List<?>) payload.get("events"))).hasSize(1);  // 倒序最近一条
    }
}
