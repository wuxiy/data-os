"""EP 语料评测集生成器（G17 AI-2）：从构建产物确定性生成模板问答。

评测集来源为真实采集语料的构建产物（chunks_ep）；问句仅含非标识属性
（科室/药品名），不含任何患者标识（PHI 排除纪律见 Recipe 注释）。
选择规则确定性：按 document_id 排序等距取样，无随机成分——同语料再生同评测集。

用法（容器内，构建完成后）：
    python -m app.ep_evalgen --count 20 \
        [--table dataos_ai.chunks_ep]
        [--out /opt/dataos/ai-data/eval/ep-prescription-evalset.jsonl]
"""
from __future__ import annotations

import argparse
import json
import re
from pathlib import Path

DEPT_RE = re.compile(r"科室：(.+?)；")
FIRST_DRUG_RE = re.compile(r"1）药品 (.+?)，")
# golden 句 = 首药品完整条目（用法/频率/剂量/天数齐备，可由 top1 片段支撑）
DRUG_FRAGMENT_RE = re.compile(r"(1）药品 (?:.*?，){2,}用药 \d+ 天|1）药品 [^；]+)")


def extract_case(content: str) -> dict | None:
    dept = DEPT_RE.search(content)
    drug = FIRST_DRUG_RE.search(content)
    fragment = DRUG_FRAGMENT_RE.search(content)
    if not (dept and drug and fragment):
        return None
    return {
        "question": f"{dept.group(1)}开具的门诊处方中，药品「{drug.group(1)}」的用法用量是什么？",
        "golden_sentence": fragment.group(1),
    }


def select_evenly(items: list, count: int) -> list:
    if count <= 0 or not items:
        return []
    stride = max(len(items) // count, 1)
    picked = items[::stride][:count]
    return picked


def generate(rows: list[tuple], count: int) -> list[dict]:
    """rows: (document_id, section, content)；产出评测 case 清单。"""
    cases = []
    for document_id, section, content in select_evenly(sorted(rows, key=lambda r: r[0]), count):
        case = extract_case(str(content))
        if case is None:
            continue
        cases.append({
            "question": case["question"],
            "expected_document_id": str(document_id),
            "expected_section": str(section or ""),
            "golden_sentence": case["golden_sentence"],
        })
    return cases


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="ep-evalgen")
    parser.add_argument("--table", default="dataos_ai.chunks_ep")
    parser.add_argument("--count", type=int, default=20)
    parser.add_argument("--out", default="/opt/dataos/ai-data/eval/ep-prescription-evalset.jsonl")
    args = parser.parse_args(argv)

    from adapters import DorisAdapter
    from settings import settings
    rows = DorisAdapter(settings).query(
        f"SELECT document_id, section, content FROM {args.table} ORDER BY document_id", ())
    cases = generate(rows, args.count)
    if not cases:
        raise SystemExit("未生成任何评测 case：先完成构建并核对序列化模板")
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    out.write_text("".join(json.dumps(c, ensure_ascii=False) + "\n" for c in cases),
                   encoding="utf-8")
    print(f"wrote {len(cases)} cases to {out}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
