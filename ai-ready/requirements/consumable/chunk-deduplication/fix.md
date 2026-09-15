# 修复指引：chunk_deduplication

## 缺口

`dataos_ai.chunks` 存在内容完全重复的 chunk（MD5 内容指纹碰撞计数 > 0）。

## 修复路径

1. 检查构建 Recipe 是否保留了 `deduplicate` 算子（文档级指纹去重）；
2. 若跨版本重建引入同内容 chunk（chunk_id 含 offset，重排后会变 id 不变内容），
   人工触发清理后按现行 Recipe 重建；
3. 验证：重跑本检查 SQL，`dup_content_ratio` 回到 0。

## 阈值依据

- pass 0.0：RAG 检索面要求内容级唯一，任何重复都直接侵占 top-k 召回窗口；
- warn 0.01：1% 容差留给人工干预窗口，超过即 FAIL。

## 变更记录

- 2026-09-15（G17/AI-1）：新立。dev 实测 0（8 chunk 无内容重复）。
