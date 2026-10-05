-- G2G 批次 3（质量评分模型平移）：
-- 1) 质量运行携带规则级得分三值（runner 评分、控制面聚合维度/总分/等级）；
-- 2) 单一生效评分标准（通过线 + 维度权重 + 等级表，nema ScoreStandard 形态）。
ALTER TABLE data_os.quality_rule_runs ADD COLUMN IF NOT EXISTS score DOUBLE PRECISION NULL;
ALTER TABLE data_os.quality_rule_runs ADD COLUMN IF NOT EXISTS total_rows BIGINT NULL;
ALTER TABLE data_os.quality_rule_runs ADD COLUMN IF NOT EXISTS dirty_rows BIGINT NULL;

CREATE TABLE IF NOT EXISTS data_os.quality_score_standard (
    id INT PRIMARY KEY,
    pass_score DOUBLE PRECISION NOT NULL DEFAULT 60,
    weights_json TEXT NOT NULL,
    grades_json TEXT NOT NULL,
    updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP
);
-- 默认标准：六维等权；等级按 nema 惯例（优质/良好/合格/待改进）。
INSERT INTO data_os.quality_score_standard (id, pass_score, weights_json, grades_json)
SELECT 1, 60,
       '{"完整性":1,"一致性":1,"规范性":1,"准确性":1,"时效性":1,"稳定性":1}',
       '[{"grade":"优质","lowScore":90},{"grade":"良好","lowScore":80},{"grade":"合格","lowScore":60},{"grade":"待改进","lowScore":0}]'
WHERE NOT EXISTS (SELECT 1 FROM data_os.quality_score_standard WHERE id = 1);
