# G14 P1：评测语料生成器（可复现，seed 固定）。
#
# 输入  corpus/snapshot.jsonl（真实身份快照，1433 行，EP 合成演示数据）
# 输出  corpus/calibration.jsonl / corpus/evalset.jsonl / corpus/manifest.json
#
# 方法学（方案 docs/mpi-g14-review-and-plan-20260828.md §三）：
# - 正样本 = 同身份的「第二登记」变体：同机构 + 新 patient_id + 受控扰动
#   （卡号 agree/missing/disagree、联系方式 agree/missing/disagree、性别 agree/U）；
# - 负样本 = same-name-hard（同名同性别同机构不同人）/ card-reuse（同卡不同名，
#   EP 真实形态）/ random（随机对不同人，u 估计基线）；
# - 标定集与评测集按身份划分、零交集（自检断言）；
# - blockingReachable 按 V1 三条阻断规则的可召回性逐对计算（card 同→B4；
#   姓名+性别+联系方式同→B6；B3 单源恒不可达），作为管线召回的独立度量。
import hashlib
import json
import random
import sys
from collections import Counter
from pathlib import Path

SEED = 20260828
# 扰动模型（正样本）：EP 就诊卡会补办/换发，联系方式会换号/漏登记。
P_CARD = {"agree": 0.55, "missing": 0.25, "disagree": 0.20}
P_CONTACT = {"agree": 0.50, "missing": 0.20, "disagree": 0.30}
P_GENDER_U = 0.08
NEG_RATIO = {"same-name-hard": 0.4, "card-reuse": 0.3, "random": 0.3}
NEG_PER_POS = 2.0

CORPUS = Path(__file__).parent / "corpus"


def load_snapshot():
    rows = [json.loads(line) for line in (CORPUS / "snapshot.jsonl").read_text().splitlines()]
    assert rows, "快照为空"
    return rows


def weighted(rng, table):
    roll = rng.random()
    acc = 0.0
    for key, weight in table.items():
        acc += weight
        if roll < acc:
            return key
    return next(reversed(table))


def blocking_reachable(card_agree, name_agree, gender_agree, contact_agree):
    """V1 阻断层可召回性：B4=同机构同卡；B6=同机构同名同性别同联系方式。"""
    if card_agree:
        return True, "B4"
    if name_agree and gender_agree and contact_agree:
        return True, "B6"
    return False, None


def make_positive(rng, base, seq):
    """同身份第二登记：新 patient_id + 受控扰动；b 的其余属性继承 base。"""
    card_mode = weighted(rng, P_CARD)
    contact_mode = weighted(rng, P_CONTACT)
    gender_u = rng.random() < P_GENDER_U
    b = dict(base)
    b["patientId"] = f"syn-{seq:06d}"
    if card_mode == "missing":
        b["card"] = None
    elif card_mode == "disagree":
        b["card"] = f"SYN{seq:08d}"
    if contact_mode == "missing":
        b["contactHash"] = None
    elif contact_mode == "disagree":
        b["contactHash"] = hashlib.sha256(f"synthetic-contact-{seq}".encode()).hexdigest()
    if gender_u:
        b["gender"] = "U"
    card_agree = base["card"] is not None and base["card"] == b["card"]
    gender_agree = base["gender"] == b["gender"] and base["gender"] != "U"
    contact_agree = (base["contactHash"] is not None
                     and base["contactHash"] == b["contactHash"])
    reachable, rule = blocking_reachable(card_agree, True, gender_agree, contact_agree)
    return pair_record(seq, "MATCH", "synthetic-variant", base, b, reachable, rule)


def make_same_name_hard(rng, a, b, seq):
    b = dict(b)
    if rng.random() < 0.3:
        b["card"] = None          # 一侧缺卡：制造「弱证据凑近」的难负样本
    if rng.random() < 0.2:
        b["contactHash"] = None
    reachable, rule = blocking_reachable(False, True, True, False)
    return pair_record(seq, "NON_MATCH", "same-name-hard", a, b, reachable, rule)


def make_card_reuse(rng, a, b, seq):
    b = dict(b)
    b["card"] = a["card"]         # 卡复用：b 持有 a 的卡（EP 真实形态）
    if rng.random() < 0.2:
        b["contactHash"] = None
    reachable, rule = blocking_reachable(True, False, False, False)
    return pair_record(seq, "NON_MATCH", "card-reuse", a, b, reachable, rule)


def make_random(a, b, seq):
    card_agree = a["card"] is not None and a["card"] == b["card"]
    name_agree = a["name"] == b["name"]
    gender_agree = a["gender"] == b["gender"] and a["gender"] != "U"
    contact_agree = (a["contactHash"] is not None
                     and a["contactHash"] == b["contactHash"])
    reachable, rule = blocking_reachable(card_agree, name_agree, gender_agree, contact_agree)
    return pair_record(seq, "NON_MATCH", "random", a, b, reachable, rule)


def pair_record(seq, label, kind, a, b, reachable, rule):
    return {
        "id": f"p{seq:06d}", "label": label, "kind": kind,
        "blockingReachable": reachable, "blockingRule": rule,
        "a": project(a), "b": project(b),
    }


def project(identity):
    """评测面只保留评分器需要的六属性（不含 sourceKey/年龄等非评分面）。"""
    return {key: identity[key]
            for key in ("institution", "patientId", "card", "name", "gender", "contactHash")}


def build_pool(rng, pool_identities, start_seq):
    positives = []
    for base in pool_identities:
        start_seq += 1
        positives.append(make_positive(rng, base, start_seq))

    negatives = []
    target = int(len(positives) * NEG_PER_POS)
    quota = {kind: int(target * share) for kind, share in NEG_RATIO.items()}
    by_institution = group_by(pool_identities, "institution")
    by_institution_name = {
        inst: group_by(rows, "name") for inst, rows in by_institution.items()
    }

    fill_random = 0
    for kind in ("same-name-hard", "card-reuse", "random"):
        attempts = 0
        while quota[kind] > 0 and attempts < quota[kind] * 200:
            attempts += 1
            inst = rng.choice(list(by_institution))
            rows = by_institution[inst]
            if kind == "same-name-hard":
                names = by_institution_name[inst]
                shared = [n for n, group in names.items() if len(group) >= 2]
                if not shared:
                    continue
                a, b = rng.sample(names[rng.choice(shared)], 2)
                if a["gender"] != b["gender"] or a["gender"] == "U":
                    continue          # 难负样本保持性别一致（B6 形态）
                candidate = make_same_name_hard(rng, a, b, 0)
            elif kind == "card-reuse":
                if len(rows) < 2:
                    continue
                a, b = rng.sample(rows, 2)
                if a["name"] == b["name"]:
                    continue          # 与 same-name-hard 区分
                candidate = make_card_reuse(rng, a, b, 0)
            else:
                if len(rows) < 2:
                    continue
                a, b = rng.sample(rows, 2)
                candidate = make_random(a, b, 0)
            start_seq += 1
            candidate["id"] = f"p{start_seq:06d}"
            negatives.append(candidate)
            quota[kind] -= 1
        # 同名对在半池内可能不足：未满足配额回填 random（实际配比进 manifest）。
        if kind != "random":
            fill_random += quota[kind]
            quota[kind] = 0
    while fill_random > 0:
        inst = rng.choice(list(by_institution))
        rows = by_institution[inst]
        if len(rows) < 2:
            continue
        a, b = rng.sample(rows, 2)
        start_seq += 1
        candidate = make_random(a, b, 0)
        candidate["id"] = f"p{start_seq:06d}"
        negatives.append(candidate)
        fill_random -= 1

    pairs = sorted(positives + negatives, key=lambda p: p["id"])
    return pairs


def group_by(rows, key):
    grouped = {}
    for row in rows:
        grouped.setdefault(row[key], []).append(row)
    return grouped


def main():
    rng = random.Random(SEED)
    snapshot = load_snapshot()
    identities = sorted(snapshot, key=lambda r: (r["institution"], r["sourceKey"]))
    shuffled = list(identities)
    rng.shuffle(shuffled)
    half = len(shuffled) // 2
    cal_pool, eval_pool = shuffled[:half], shuffled[half:]

    # 自检：标定/评测身份零交集（防 m/u 估计与指标计算同源）。
    cal_keys = {(r["institution"], r["sourceKey"]) for r in cal_pool}
    eval_keys = {(r["institution"], r["sourceKey"]) for r in eval_pool}
    assert not (cal_keys & eval_keys), "标定/评测身份交集非空"

    cal_pairs = build_pool(random.Random(SEED + 1), cal_pool, 0)
    eval_pairs = build_pool(random.Random(SEED + 2), eval_pool, 500000)

    write_jsonl(CORPUS / "calibration.jsonl", cal_pairs)
    write_jsonl(CORPUS / "evalset.jsonl", eval_pairs)
    manifest = {
        "seed": SEED, "perturbation": {"card": P_CARD, "contact": P_CONTACT,
                                       "genderU": P_GENDER_U},
        "negativeMix": NEG_RATIO, "negativesPerPositive": NEG_PER_POS,
        "counts": {
            "calibration": tally(cal_pairs), "eval": tally(eval_pairs),
        },
    }
    (CORPUS / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    print(json.dumps(manifest["counts"], ensure_ascii=False))


def tally(pairs):
    labels = Counter(p["label"] for p in pairs)
    kinds = Counter(p["kind"] for p in pairs)
    reachable = sum(1 for p in pairs if p["label"] == "MATCH" and p["blockingReachable"])
    positives = labels["MATCH"]
    return {"total": len(pairs), "labels": dict(labels), "kinds": dict(kinds),
            "positivesBlockingReachable": reachable, "positives": positives}


def write_jsonl(path, rows):
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    sys.exit(main())
