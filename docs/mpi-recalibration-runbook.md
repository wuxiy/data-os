# MPI 权重重标定运行手册（T5b）

> 建立日期：2026-09-02（G15 决策权切换后）
> 适用：`MpiWeights.packaged()` 的 m/u 与三阈值（T_AUTO / T_REVIEW / T_VETO）
> 何时重估与如何安全更新。背景见 `docs/validation/gate-mpi-g14-20260828.md`
> 与 `gate-mpi-g15-20260902.md`。

## 一、何时触发重估

- **多源接入**（新 source_system 进 `mpi_source_identity`）——必做。此时
  `eval/generate_corpus.py` 的负样本配比 `NEG_RATIO`（卡复用 0.60 / 同名孪生
  0.12 / 随机 0.28）要先按**真实决策层候选构成**重锚（统计各阻断规则的
  候选对分布），再生成语料。
- 数据面重大变化（源系统换版本、清洗规则调整、身份量级跳变）。
- 例行巡检（建议随季度或大版本）。

## 二、流程（全链可复现）

```bash
# 1. 导出新快照（dev；经 data-api 容器，DORIS_MPI 口令从 mpi-service 环境取）
QPW=$(ssh <dev> docker exec data-os-dev-mpi-service-1 printenv DORIS_MPI_PASSWORD)
ssh <dev> "docker cp services/mpi-service/eval/export_snapshot.py data-os-dev-data-api-1:/tmp/ && \
  docker exec -e DORIS_MPI_PASSWORD='$QPW' data-os-dev-data-api-1 \
  python3 /tmp/export_snapshot.py" > snapshot.jsonl

# 2. 临时语料目录生成（不动冻结语料 eval/corpus/）
mkdir -p /tmp/recalib/corpus && cp snapshot.jsonl /tmp/recalib/corpus/
cp services/mpi-service/eval/generate_corpus.py /tmp/recalib/
python3 /tmp/recalib/generate_corpus.py          # 同 seed，确定性

# 3. 漂移报告（报告式，不锁死；超差不失败）
cd services/mpi-service && JAVA_HOME=$(/usr/libexec/java_home -v 21) \
  mvn test -Dtest=MpiDriftReportTests -Ddrift.corpus=/tmp/recalib/corpus
#    报告：eval/reports/drift-report.json（不入 Git）
```

## 三、解读与裁决

- 容差与锁断言一致（0.005）：逐字段×比较级 m/u 与三阈值的 |Δ| 全部 ≤ 容差
  → `STABLE`，无动作。
- 任一超差 → `DRIFT`。**是否更新 packaged() 是人工决策**，判断输入：
  1. 漂移来源是数据真实变化（多源/清洗口径）还是临时噪声（数据量小）；
  2. 语义铰链参数（`P_SEMANTIC_*`、`NOISE_*`、`TWIN_CONTACT_SHARE`）是否
     仍锚定真实形态——先调语料假设再谈权重；
  3. 混合引擎的安全不变量在新语料下是否仍成立（零误并/零误否）。

## 四、决定重标定后的更新纪律

1. 用新语料替换冻结语料（`eval/corpus/`，含 manifest；生成器参数变更须
   同步写进 manifest 与本手册）；
2. 从新标定集取估计值更新 `MpiWeights.packaged()`（数值以
   `MpiWeightEstimator` 输出为准——估计数学单一属主，勿手算）；
3. 跑**全量** `mvn test`：`MpiEvalHarnessTests` 会从新语料重估并断言与
   packaged 一致（锁死新基线）＋ 评测集安全不变量；
4. gate 报告记录新旧对照与裁决理由；dev rebuild 验证决策分布。

## 五、边界（如实声明）

- 语料为半合成口径（生成器参数即假设，见 G14 报告偏差 3）：漂移读数
  反映「快照 × 生成器假设」的联合变化，不是纯真实分布漂移；
- 多源接入前，同名难负（孪生）与决策层配比都是单源锚定的——这是
  T5b 完整形态等真实多源的原因；
- 锚点（人工裁决对）是评测安全网的一部分：多源后应补充新的人工裁决
  再替换 `anchors.jsonl`。

## 六、基线示例（2026-09-02，dev 快照 1434 身份，G14 后 +1 登记）

首次运行读数：`DRIFT 9/27`——漂移项**全部在 u 侧**（非同人总体：name
uDisagree +0.012、gender/contact 各 +0.009~0.021）与三阈值（tAuto 16.54→17.98、
tReview 0.62→0.52、tVeto 0.42→0.51），m 侧（同人造体）零漂移。

解读示范（对应 §三的裁决框架）：

1. **来源判定**：1/1434 的数据变化不可能构成真实分布漂移——读数由生成器
   同 seed 重洗身份池的**重采样方差**主导（快照变一条 → 池划分与配对全变）。
   极值统计量（tAuto=max 非同人分、tVeto=min 同人分）对此最敏感，u 速率次之。
2. **运营影响**：tVeto 0.51 仍落在零误否平坦段 [0.42, -6] 内（G15 §四）；
   tAuto 只影响纯 V2 对照证据行的三态——决策权在合取守卫，不受影响。
3. **裁决**：不重标定。判据沉淀：**m 侧稳定 + 漂移量级与数据变化不成比例
   → 判重采样噪声；m 侧漂移或漂移量级与数据变化成比例 → 进 §四流程。**
