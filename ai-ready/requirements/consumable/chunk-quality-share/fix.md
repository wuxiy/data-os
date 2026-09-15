# 修复指引：chunk_quality_share

## 缺口

`dataos_ai.chunks_ep`（EP 真实采集语料产物）中 quality_score < 1.0 的 chunk 超过阈值
（规则分口径：长度落在 Recipe 声明的 [min_chars, max_chars] 窗口内且含中文断句）。

## 修复路径

1. 低质主因通常是过短 chunk——调整 Recipe `parameters.chunk.min_chars`（EP 口径 60）
   或改序列化模板使单处方文本更饱满；
2. 过长 chunk 按 max_chars 句切（构建器语义切块已处理），超限多为模板串行过长，
   收窄单 chunk 药品条目数；
3. 重建后复跑本检查。

## 阈值依据

- pass 0.9：确定性序列化文本断句稳定，允许少量极短处方；
- warn 0.8：低于八成说明序列化模板与切块参数失配，需要人工复核。

## 变更记录

- 2026-09-15（G17/AI-1）：新立。构建前 N/A；构建后以实测分布定档（gate 留证）。
