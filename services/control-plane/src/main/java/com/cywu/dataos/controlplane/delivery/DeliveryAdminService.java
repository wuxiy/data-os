package com.cywu.dataos.controlplane.delivery;

import java.io.ByteArrayOutputStream;
import java.io.IOException;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.time.Instant;
import java.util.ArrayList;
import java.util.HexFormat;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Pattern;
import java.util.zip.ZipEntry;
import java.util.zip.ZipOutputStream;

import org.springframework.stereotype.Service;

import com.cywu.dataos.controlplane.api.ConflictException;
import com.cywu.dataos.controlplane.api.InvalidRequestException;
import com.cywu.dataos.controlplane.api.ResourceNotFoundException;
import com.fasterxml.jackson.databind.ObjectMapper;

/**
 * 交付中心编排（G25）：项目生命周期 DRAFT→IN_PROGRESS→READY_FOR_ACCEPTANCE→
 * ACCEPTED→ARCHIVED；submit 前逐项可交付性检查（失败项明确阻断，写 BLOCKED
 * 事件留痕）；快照与状态动作幂等（Idempotency-Key 必填，重放按事件/快照
 * 判定，同键跨对象复用 409）；evidence.zip = manifest.json + CHECKSUM.txt，
 * 内容经白名单防线（{@link DeliveryEvidenceSanitizer}）。
 */
@Service
public class DeliveryAdminService {

    static final Pattern CODE_PATTERN = Pattern.compile("^[A-Za-z0-9][A-Za-z0-9_-]{1,63}$");

    private final DeliveryRepository repository;
    private final DeliveryEvidenceCollector collector;
    private final ObjectMapper objectMapper;

    public DeliveryAdminService(DeliveryRepository repository,
                                DeliveryEvidenceCollector collector,
                                ObjectMapper objectMapper) {
        this.repository = repository;
        this.collector = collector;
        this.objectMapper = objectMapper;
    }

    // ---- 查询 ----

    public Map<String, Object> list(String tenantId, String query, int page, int size) {
        var row = repository.findProjects(tenantId, query, page, size);
        return Map.of("total", row.total(), "projects",
                row.projects().stream().map(this::projectView).toList());
    }

    public Map<String, Object> detail(String tenantId, String id) {
        var project = requireProject(tenantId, id);
        var view = new LinkedHashMap<String, Object>();
        view.put("project", projectView(project));
        view.put("items", repository.findItems(tenantId, id).stream()
                .map(this::itemView).toList());
        view.put("snapshots", repository.findSnapshots(tenantId, id).stream()
                .map(snapshot -> {
                    var meta = new LinkedHashMap<String, Object>();
                    meta.put("id", snapshot.id());
                    meta.put("checksum", snapshot.checksum());
                    meta.put("createdAt", snapshot.createdAt().toString());
                    meta.put("createdBy", snapshot.createdBy());
                    return meta;
                }).toList());
        view.put("events", repository.findEvents(tenantId, id).stream()
                .map(this::eventView).toList());
        return view;
    }

    // ---- 项目与交付项 ----

    public Map<String, Object> create(String tenantId, CreateDeliveryRequest request, String actor) {
        var code = request.code() == null ? "" : request.code().trim();
        if (!CODE_PATTERN.matcher(code).matches()) {
            throw new InvalidRequestException("项目代码须以字母或数字开头，仅含字母、数字、下划线与中划线（2-64 位）");
        }
        if (repository.existsByCode(tenantId, code)) {
            throw new ConflictException("交付项目代码已存在：" + code);
        }
        var now = Instant.now();
        var project = new DeliveryProject(DeliveryRepository.newId(), tenantId, code,
                request.name().trim(), orEmpty(request.scope()), orEmpty(request.owner()),
                request.targetDate(), DeliveryLifecycle.DRAFT, null, actor, now, now);
        repository.insertProject(project);
        var items = new ArrayList<DeliveryItem>();
        if (request.items() != null) {
            for (CreateDeliveryRequest.ItemContract contract : request.items()) {
                items.add(addItem(tenantId, project.id(), contract, actor));
            }
        }
        repository.insertEvent(new DeliveryEvent(DeliveryRepository.newId(), project.id(),
                tenantId, "CREATED", actor, null, "创建交付项目（" + items.size() + " 个交付项）",
                now));
        return detail(tenantId, project.id());
    }

    public Map<String, Object> update(String tenantId, String id, UpdateDeliveryRequest request,
                                      String actor) {
        var project = requireProject(tenantId, id);
        requireEditable(project, "更新项目信息");
        repository.updateProject(id, request.name().trim(), orEmpty(request.scope()),
                orEmpty(request.owner()), request.targetDate());
        repository.insertEvent(new DeliveryEvent(DeliveryRepository.newId(), id, tenantId,
                "UPDATED", actor, null, "更新项目信息", Instant.now()));
        return detail(tenantId, id);
    }

    public Map<String, Object> addItem(String tenantId, String id, AddDeliveryItemRequest request,
                                       String actor) {
        var item = addItem(tenantId, id, new CreateDeliveryRequest.ItemContract(
                request.refType(), request.refId(), request.note()), actor);
        return detail(tenantId, id);
    }

    private DeliveryItem addItem(String tenantId, String projectId,
                                 CreateDeliveryRequest.ItemContract contract, String actor) {
        var project = requireProject(tenantId, projectId);
        requireEditable(project, "追加交付项");
        var refType = parseRefType(contract.refType());
        var refId = contract.refId() == null ? "" : contract.refId().trim();
        if (refId.isBlank() || refId.length() > 256) {
            throw new InvalidRequestException("引用标识不能为空且不超过 256 字符");
        }
        if (repository.itemRefExists(tenantId, projectId, refType, refId)) {
            throw new ConflictException("交付项已存在：" + refType + " " + refId);
        }
        // 本地类型（数据服务/AI 产品）加入即校验存在（引用下线的兜底在提交逐项检查）；
        // 远端类型（ASSET/DASHBOARD）存在性在提交时统一核验，避免证据源抖动影响建项。
        if (!collector.existsLocally(tenantId, refType, refId)) {
            throw new InvalidRequestException("引用不存在：" + refType + " " + refId);
        }
        var item = new DeliveryItem(DeliveryRepository.newId(), projectId, tenantId, refType,
                refId, orEmpty(contract.note()), actor, Instant.now());
        repository.insertItem(item);
        repository.insertEvent(new DeliveryEvent(DeliveryRepository.newId(), projectId, tenantId,
                "ITEM_ADDED", actor, null, refType + " " + refId, item.createdAt()));
        return item;
    }

    public Map<String, Object> removeItem(String tenantId, String id, String itemId, String actor) {
        var project = requireProject(tenantId, id);
        requireEditable(project, "移除交付项");
        var item = repository.findItem(tenantId, id, itemId)
                .orElseThrow(() -> new ResourceNotFoundException("交付项不存在：" + itemId));
        repository.deleteItem(tenantId, id, itemId);
        repository.insertEvent(new DeliveryEvent(DeliveryRepository.newId(), id, tenantId,
                "ITEM_REMOVED", actor, null, item.refType() + " " + item.refId(), Instant.now()));
        return detail(tenantId, id);
    }

    // ---- 状态动作（幂等）----

    public Map<String, Object> start(String tenantId, String id, String key, String actor) {
        var replay = replayOrClaim(tenantId, id, key, "STARTED");
        if (replay != null) {
            return replay;
        }
        var project = requireProject(tenantId, id);
        if (project.status() != DeliveryLifecycle.DRAFT) {
            throw new ConflictException("只有 DRAFT 项目可以启动，当前：" + project.status());
        }
        if (repository.findItems(tenantId, id).isEmpty()) {
            throw new InvalidRequestException("交付项为空，不能启动");
        }
        transition(tenantId, id, DeliveryLifecycle.DRAFT, DeliveryLifecycle.IN_PROGRESS,
                "STARTED", key, actor, "启动交付");
        return actionResult(tenantId, id);
    }

    /** submit = 逐项可交付性检查通过后进入 READY_FOR_ACCEPTANCE；失败项明确阻断。 */
    public Map<String, Object> submit(String tenantId, String id, String key, String actor) {
        var replay = replayOrClaim(tenantId, id, key, "SUBMITTED");
        if (replay != null) {
            return replay;
        }
        var project = requireProject(tenantId, id);
        if (project.status() == DeliveryLifecycle.READY_FOR_ACCEPTANCE
                || project.status() == DeliveryLifecycle.ACCEPTED) {
            throw new ConflictException("项目已提交（" + project.status() + "），不能重复提交");
        }
        if (project.status() != DeliveryLifecycle.IN_PROGRESS) {
            throw new ConflictException("只有 IN_PROGRESS 项目可以提交验收，当前：" + project.status());
        }
        var items = repository.findItems(tenantId, id);
        if (items.isEmpty()) {
            throw new InvalidRequestException("交付项为空，不能提交验收");
        }
        var blockers = new ArrayList<Map<String, Object>>();
        var evidences = new ArrayList<Map<String, Object>>();
        for (DeliveryItem item : items) {
            var evidence = collector.collect(tenantId, item);
            evidences.add(evidence.toMap());
            if (!evidence.deliverable()) {
                var blocker = new LinkedHashMap<String, Object>();
                blocker.put("refType", item.refType().name());
                blocker.put("refId", item.refId());
                blocker.put("reasons", evidence.blockers());
                blockers.add(blocker);
            }
        }
        if (!blockers.isEmpty()) {
            // 阻断不是状态动作：不留幂等键消费（重试可用新键），但写事件留痕。
            repository.insertEvent(new DeliveryEvent(DeliveryRepository.newId(), id, tenantId,
                    "SUBMIT_BLOCKED", actor, null, blockersJson(blockers), Instant.now()));
            throw new DeliveryBlockedException("存在 " + blockers.size() + " 个不可交付项，已阻断提交", blockers);
        }
        transition(tenantId, id, DeliveryLifecycle.IN_PROGRESS,
                DeliveryLifecycle.READY_FOR_ACCEPTANCE, "SUBMITTED", key, actor,
                "提交验收（" + items.size() + " 个交付项全部通过检查）");
        return actionResult(tenantId, id);
    }

    public Map<String, Object> accept(String tenantId, String id, String key, String actor) {
        var replay = replayOrClaim(tenantId, id, key, "ACCEPTED");
        if (replay != null) {
            return replay;
        }
        var project = requireProject(tenantId, id);
        if (project.status() == DeliveryLifecycle.ACCEPTED
                || project.status() == DeliveryLifecycle.ARCHIVED) {
            throw new ConflictException("项目已验收（" + project.status() + "），不能重复验收");
        }
        if (project.status() != DeliveryLifecycle.READY_FOR_ACCEPTANCE) {
            throw new ConflictException("只有 READY_FOR_ACCEPTANCE 项目可以验收，当前：" + project.status());
        }
        var snapshot = repository.findSnapshots(tenantId, id).stream().findFirst()
                .orElseThrow(() -> new InvalidRequestException("没有验收快照，不能验收（先生成证据快照）"));
        transition(tenantId, id, DeliveryLifecycle.READY_FOR_ACCEPTANCE,
                DeliveryLifecycle.ACCEPTED, "ACCEPTED", key, actor,
                "验收通过（快照 " + snapshot.id() + "，checksum " + snapshot.checksum() + "）");
        repository.pinAcceptedSnapshot(id, snapshot.id());
        return actionResult(tenantId, id);
    }

    public Map<String, Object> archive(String tenantId, String id, String key, String actor) {
        var replay = replayOrClaim(tenantId, id, key, "ARCHIVED");
        if (replay != null) {
            return replay;
        }
        var project = requireProject(tenantId, id);
        if (project.status() != DeliveryLifecycle.ACCEPTED) {
            throw new ConflictException("只有 ACCEPTED 项目可以归档，当前：" + project.status());
        }
        transition(tenantId, id, DeliveryLifecycle.ACCEPTED, DeliveryLifecycle.ARCHIVED,
                "ARCHIVED", key, actor, "归档");
        return actionResult(tenantId, id);
    }

    // ---- 快照与证据包 ----

    public Map<String, Object> snapshot(String tenantId, String id, String key, String actor) {
        requireKey(key);
        var existing = repository.findSnapshotByIdempotencyKey(tenantId, key);
        if (existing.isPresent()) {
            if (!existing.get().projectId().equals(id)) {
                throw new ConflictException("幂等键已被其他项目使用，不能复用");
            }
            var replay = new LinkedHashMap<String, Object>();
            replay.put("replayed", true);
            replay.put("snapshotId", existing.get().id());
            replay.put("checksum", existing.get().checksum());
            replay.put("createdAt", existing.get().createdAt().toString());
            return replay;
        }
        var project = requireProject(tenantId, id);
        if (project.status() != DeliveryLifecycle.IN_PROGRESS
                && project.status() != DeliveryLifecycle.READY_FOR_ACCEPTANCE) {
            throw new ConflictException("只有 IN_PROGRESS / READY_FOR_ACCEPTANCE 项目可以生成快照，当前："
                    + project.status());
        }
        var items = repository.findItems(tenantId, id);
        if (items.isEmpty()) {
            throw new InvalidRequestException("交付项为空，不能生成快照");
        }
        var itemEvidences = new ArrayList<Map<String, Object>>();
        for (DeliveryItem item : items) {
            itemEvidences.add(collector.collect(tenantId, item).toMap());
        }
        var manifest = new LinkedHashMap<String, Object>();
        manifest.put("manifestVersion", 1);
        manifest.put("project", projectView(project));
        manifest.put("items", itemEvidences);
        manifest.put("events", repository.findEvents(tenantId, id).stream()
                .map(this::eventView).toList());
        manifest.put("generatedAt", Instant.now().toString());
        manifest.put("generatedBy", actor);
        manifest.put("checksumAlgorithm", "SHA-256");

        String manifestJson;
        try {
            manifestJson = objectMapper.writerWithDefaultPrettyPrinter().writeValueAsString(manifest);
        } catch (IOException exception) {
            throw new IllegalStateException("证据 manifest 序列化失败", exception);
        }
        DeliveryEvidenceSanitizer.assertWhitelisted(manifestJson);
        var snapshot = new DeliverySnapshot(DeliveryRepository.newId(), id, tenantId,
                sha256(manifestJson), manifestJson, key, actor, Instant.now());
        repository.insertSnapshot(snapshot);
        // 快照事件不携带幂等键：快照重放判定走 delivery_snapshot 的键唯一约束，
        // 事件表的键空间专属状态动作（避免同名键跨用冲突）。
        repository.insertEvent(new DeliveryEvent(DeliveryRepository.newId(), id, tenantId,
                "SNAPSHOT_CREATED", actor, null,
                "生成证据快照（checksum " + snapshot.checksum() + "）", snapshot.createdAt()));
        var result = new LinkedHashMap<String, Object>();
        result.put("replayed", false);
        result.put("snapshotId", snapshot.id());
        result.put("checksum", snapshot.checksum());
        result.put("createdAt", snapshot.createdAt().toString());
        return result;
    }

    public record EvidencePackage(String filename, byte[] zipBytes) {
    }

    /** evidence.zip：manifest.json（与库中字节一致）+ CHECKSUM.txt（sha256 摘要）。 */
    public EvidencePackage evidenceZip(String tenantId, String id) {
        var project = requireProject(tenantId, id);
        var snapshotId = project.acceptedSnapshotId();
        var snapshot = snapshotId == null
                ? repository.findSnapshots(tenantId, id).stream().findFirst().orElse(null)
                : repository.findSnapshot(tenantId, snapshotId).orElse(null);
        if (snapshot == null) {
            throw new ConflictException("该项目没有证据快照，无法下载证据包");
        }
        var out = new ByteArrayOutputStream();
        try (var zip = new ZipOutputStream(out)) {
            var entry = new ZipEntry("manifest.json");
            entry.setTime(snapshot.createdAt().toEpochMilli());
            zip.putNextEntry(entry);
            zip.write(snapshot.manifestJson().getBytes(StandardCharsets.UTF_8));
            zip.closeEntry();
            var checksumEntry = new ZipEntry("CHECKSUM.txt");
            checksumEntry.setTime(snapshot.createdAt().toEpochMilli());
            zip.putNextEntry(checksumEntry);
            zip.write(("sha256 " + snapshot.checksum() + "\n").getBytes(StandardCharsets.UTF_8));
            zip.closeEntry();
        } catch (IOException exception) {
            throw new IllegalStateException("证据包打包失败", exception);
        }
        var filename = "delivery-" + project.code() + "-evidence-" + snapshot.id() + ".zip";
        return new EvidencePackage(filename, out.toByteArray());
    }

    // ---- 内部 ----

    /** 状态动作成功响应：detail + replayed=false（与重放路径的 replayed=true 对齐）。 */
    private Map<String, Object> actionResult(String tenantId, String id) {
        var result = new LinkedHashMap<String, Object>(detail(tenantId, id));
        result.put("replayed", false);
        return result;
    }

    /**
     * 幂等重放判定：键已绑定事件时，同项目同动作 → 重放当前态（replayed=true）；
     * 其他项目或其他动作 → 409。返回 null 表示键未使用，继续执行。
     */
    private Map<String, Object> replayOrClaim(String tenantId, String id, String key,
                                              String eventType) {
        requireKey(key);
        var existing = repository.findEventByIdempotencyKey(tenantId, key);
        if (existing.isEmpty()) {
            return null;
        }
        var event = existing.get();
        if (!event.projectId().equals(id) || !event.eventType().equals(eventType)) {
            throw new ConflictException("幂等键已被使用（" + event.eventType() + "），不能复用");
        }
        var replay = new LinkedHashMap<String, Object>();
        replay.put("replayed", true);
        replay.put("matchedEvent", event.eventType());
        replay.putAll(detail(tenantId, id));
        return replay;
    }

    private void transition(String tenantId, String id, DeliveryLifecycle expected,
                            DeliveryLifecycle target, String eventType, String key,
                            String actor, String detail) {
        var updated = repository.casStatus(id, expected, target);
        if (updated == 0) {
            throw new ConflictException("状态已被并发改变，请刷新后重试（期望 " + expected + "）");
        }
        repository.insertEvent(new DeliveryEvent(DeliveryRepository.newId(), id, tenantId,
                eventType, actor, key, detail, Instant.now()));
    }

    private DeliveryProject requireProject(String tenantId, String id) {
        return repository.findProject(tenantId, id)
                .orElseThrow(() -> new ResourceNotFoundException("交付项目不存在：" + id));
    }

    private void requireEditable(DeliveryProject project, String action) {
        if (project.status() != DeliveryLifecycle.DRAFT
                && project.status() != DeliveryLifecycle.IN_PROGRESS) {
            throw new ConflictException(action + "仅限 DRAFT / IN_PROGRESS，当前：" + project.status());
        }
    }

    private static void requireKey(String key) {
        if (key == null || key.isBlank()) {
            throw new InvalidRequestException("缺少 Idempotency-Key 请求头（快照与状态动作必须携带）");
        }
        if (key.length() > 128) {
            throw new InvalidRequestException("Idempotency-Key 不能超过 128 字符");
        }
    }

    private static DeliveryRefType parseRefType(String value) {
        try {
            return DeliveryRefType.parse(value);
        } catch (IllegalArgumentException exception) {
            throw new InvalidRequestException("未知引用类型：" + value
                    + "（仅支持 ASSET / DASHBOARD / DATA_SERVICE / AI_DATA_PRODUCT）");
        }
    }

    private String blockersJson(List<Map<String, Object>> blockers) {
        try {
            return objectMapper.writeValueAsString(blockers);
        } catch (IOException exception) {
            return "{\"error\":\"blockers-serialization-failed\"}";
        }
    }

    private Map<String, Object> projectView(DeliveryProject project) {
        var view = new LinkedHashMap<String, Object>();
        view.put("id", project.id());
        view.put("code", project.code());
        view.put("name", project.name());
        view.put("scope", project.scope());
        view.put("owner", project.owner());
        view.put("targetDate", project.targetDate() == null ? "" : project.targetDate().toString());
        view.put("status", project.status().name());
        view.put("acceptedSnapshotId", project.acceptedSnapshotId() == null ? "" : project.acceptedSnapshotId());
        view.put("createdBy", project.createdBy());
        view.put("createdAt", project.createdAt().toString());
        view.put("updatedAt", project.updatedAt().toString());
        return view;
    }

    private Map<String, Object> itemView(DeliveryItem item) {
        var view = new LinkedHashMap<String, Object>();
        view.put("id", item.id());
        view.put("refType", item.refType().name());
        view.put("refId", item.refId());
        view.put("note", item.note());
        view.put("createdBy", item.createdBy());
        view.put("createdAt", item.createdAt().toString());
        return view;
    }

    private Map<String, Object> eventView(DeliveryEvent event) {
        // 幂等键不进任何对外投影（含 manifest 事件清单）。
        var view = new LinkedHashMap<String, Object>();
        view.put("eventType", event.eventType());
        view.put("actor", event.actor());
        view.put("detail", event.detail());
        view.put("createdAt", event.createdAt().toString());
        return view;
    }

    private static String sha256(String value) {
        try {
            var digest = MessageDigest.getInstance("SHA-256");
            return HexFormat.of().formatHex(digest.digest(value.getBytes(StandardCharsets.UTF_8)));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 不可用", exception);
        }
    }

    private static String orEmpty(String value) {
        return value == null ? "" : value.trim();
    }
}
