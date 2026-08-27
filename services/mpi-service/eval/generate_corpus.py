# G14 P1：评测语料生成器（可复现，seed 固定）。
#
# 输入  corpus/snapshot.jsonl（真实身份快照，1433 行，EP 合成演示数据）
# 输出  corpus/calibration.jsonl / corpus/evalset.jsonl / corpus/manifest.json
#
# 方法学（docs/mpi-g14-review-and-plan-20260828.md §三，2026-08-28 修订）：
# - 正样本 = 同身份「第二登记」变体：同机构 + 新 patient_id + 语义扰动
#   （卡号/联系方式 各自 一致或不同——缺失由记录噪声统一处理）；
# - 负样本 = same-name-hard 合成孪生（同名同性别同机构的不同人；联系方式
#   5% 共用——同名同性亲属罕见，家属代登记多伴随改名；其余自持不同联系方式）、
#   card-reuse（b 持 a 的卡，EP 真实形态）、random（真实对不同人，异名异卡——
#   同名/同卡真实对无法判定同人/不同人，不作负样本标签）；
# - 记录噪声与标签无关：每侧独立以 5%/5%/8% 将卡号/联系方式置空、性别置 U
#   （锚定「缺失是记录过程属性」的 FS 惯例——真实 EP 快照缺失率为 0，
#   缺失权重自然趋 0，不产生「缺卡比同卡更像同人」的倒挂）；
# - 语义铰链不受噪声（card-reuse 的卡、共用联系方式孪生的联系方式）；
# - 标定集与评测集按身份划分、零交集（自检断言）；全 kind 去重；
# - blockingReachable 按 V1 三条阻断规则逐对计算（B4=同卡；B6=同名同性别
#   同联系方式；B3 单源恒不可达），作为管线召回的独立度量。
import hashlib
import json
import random
import sys
from collections import Counter
from pathlib import Path

SEED = 20260828
# 语义扰动（正样本，锚定 4 条人工裁决的真实形态：同人可换卡、联系方式可变）
P_SEMANTIC_CARD = {"agree": 0.55, "disagree": 0.45}
P_SEMANTIC_CONTACT = {"agree": 0.55, "disagree": 0.45}
# 记录噪声（与标签无关，双侧独立）
NOISE_CARD_NULL = 0.05
NOISE_CONTACT_NULL = 0.05
NOISE_GENDER_U = 0.08
# 同名孪生联系方式共用率（难负样本；5% = 同名同性亲属罕见）
TWIN_CONTACT_SHARE = 0.05
# 负样本配比锚定决策层真实构成：真实 45 候选中 B4（同卡）占 93%（其中
# 卡复用不同名 33 对为主），B6（同名+联系方式）仅 3 对——卡复用占主导。
NEG_RATIO = {"card-reuse": 0.60, "same-name-hard": 0.12, "random": 0.28}
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


def synthetic_card(seq):
    return f"SYN{seq:08d}"


def synthetic_contact(seq):
    return hashlib.sha256(f"synthetic-contact-{seq}".encode()).hexdigest()


def apply_noise(rng, side, hinge):
    """记录噪声：与标签无关的置空/置 U；语义铰链字段豁免。"""
    if hinge != "card" and rng.random() < NOISE_CARD_NULL:
        side["card"] = None
    if hinge != "contact" and rng.random() < NOISE_CONTACT_NULL:
        side["contactHash"] = None
    if rng.random() < NOISE_GENDER_U:
        side["gender"] = "U"


def finalize(rng, seq, label, kind, a, b, hinge=None):
    a, b = dict(a), dict(b)
    apply_noise(rng, a, hinge)
    apply_noise(rng, b, hinge)
    card_agree = a["card"] is not None and a["card"] == b["card"]
    name_agree = a["name"] == b["name"]
    gender_agree = a["gender"] == b["gender"] and a["gender"] != "U"
    contact_agree = (a["contactHash"] is not None
                     and a["contactHash"] == b["contactHash"])
    if card_agree:
        reachable, rule = True, "B4"
    elif name_agree and gender_agree and contact_agree:
        reachable, rule = True, "B6"
    else:
        reachable, rule = False, None
    return {
        "id": f"p{seq:06d}", "label": label, "kind": kind,
        "blockingReachable": reachable, "blockingRule": rule,
        "a": project(a), "b": project(b),
    }


def project(identity):
    """评测面只保留评分器需要的六属性（不含 sourceKey/年龄等非评分面）。"""
    return {key: identity[key]
            for key in ("institution", "patientId", "card", "name", "gender", "contactHash")}


def make_positive(rng, base, seq):
    b = dict(base)
    b["patientId"] = f"syn-{seq:06d}"
    if weighted(rng, P_SEMANTIC_CARD) == "disagree":
        b["card"] = synthetic_card(seq)
    if weighted(rng, P_SEMANTIC_CONTACT) == "disagree":
        b["contactHash"] = synthetic_contact(seq)
    return finalize(rng, seq, "MATCH", "synthetic-variant", base, b)


def make_twin_hard(rng, base, seq):
    b = dict(base)
    b["patientId"] = f"syn-{seq:06d}"
    b["card"] = synthetic_card(seq)
    share = rng.random() < TWIN_CONTACT_SHARE
    if not share:
        b["contactHash"] = synthetic_contact(seq)
    return finalize(rng, seq, "NON_MATCH", "same-name-hard", base, b,
                    hinge="contact" if share else None)


def make_card_reuse(rng, a, b, seq):
    b = dict(b)
    b["card"] = a["card"]
    if b["contactHash"] == a["contactHash"]:
        b["contactHash"] = synthetic_contact(seq)
    return finalize(rng, seq, "NON_MATCH", "card-reuse", a, b, hinge="card")


def make_random(rng, a, b, seq):
    return finalize(rng, seq, "NON_MATCH", "random", a, b)


def build_pool(rng, pool_identities, start_seq):
    positives = []
    for base in pool_identities:
        start_seq += 1
        positives.append(make_positive(rng, base, start_seq))

    negatives = []
    target = int(len(positives) * NEG_PER_POS)
    quota = {kind: int(target * share) for kind, share in NEG_RATIO.items()}
    by_institution = group_by(pool_identities, "institution")
    twin_bases = set()          # 同名孪生每身份至多一个，避免语义重复
    seen_real_pairs = set()     # 真实身份对去重

    def real_pair(kind):
        """同机构真实身份对：要求异名；random 额外要求异卡（同名/同卡真实对
        的同人/不同人无法判定，不能作负样本标签）。"""
        inst = rng.choice(list(by_institution))
        rows = by_institution[inst]
        if len(rows) < 2:
            return None
        a, b = rng.sample(rows, 2)
        key = tuple(sorted((a["sourceKey"], b["sourceKey"])))
        if key in seen_real_pairs or a["name"] == b["name"]:
            return None
        if kind == "random" and a["card"] and a["card"] == b["card"]:
            return None
        seen_real_pairs.add(key)
        return a, b

    fill_random = 0
    for kind in ("same-name-hard", "card-reuse", "random"):
        attempts = 0
        while quota[kind] > 0 and attempts < quota[kind] * 300:
            attempts += 1
            if kind == "same-name-hard":
                base = rng.choice(pool_identities)
                if base["sourceKey"] in twin_bases:
                    continue
                twin_bases.add(base["sourceKey"])
                start_seq += 1
                candidate = make_twin_hard(rng, base, start_seq)
            else:
                picked = real_pair(kind)
                if picked is None:
                    continue
                a, b = picked
                start_seq += 1
                candidate = (make_card_reuse(rng, a, b, start_seq) if kind == "card-reuse"
                             else make_random(rng, a, b, start_seq))
            quota[kind] -= 1
            negatives.append(candidate)
        # 配额不足（池过小/去重约束）时回填 random 真实对；仍不足回填孪生。
        if kind != "random":
            fill_random += quota[kind]
            quota[kind] = 0
    attempts = 0
    while fill_random > 0 and attempts < fill_random * 300:
        attempts += 1
        picked = real_pair("random")
        base = rng.choice(pool_identities)
        start_seq += 1
        if picked is not None:
            a, b = picked
            candidate = make_random(rng, a, b, start_seq)
        elif base["sourceKey"] not in twin_bases:
            twin_bases.add(base["sourceKey"])
            candidate = make_twin_hard(rng, base, start_seq)
        else:
            continue
        fill_random -= 1
        negatives.append(candidate)
    assert fill_random == 0, "回填配额未满足（池过小）"

    pairs = sorted(positives + negatives, key=lambda p: p["id"])
    self_check(pairs)
    return pairs


def group_by(rows, key):
    grouped = {}
    for row in rows:
        grouped.setdefault(row[key], []).append(row)
    return grouped


def self_check(pairs):
    """语料不变量：id 唯一；random 无同名；孪生无同卡（噪声豁免外）。"""
    ids = [p["id"] for p in pairs]
    assert len(ids) == len(set(ids)), "pair id 重复"
    for p in pairs:
        if p["kind"] == "random":
            assert p["a"]["name"] != p["b"]["name"], f"random 负样本不得同名：{p['id']}"


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
        "seed": SEED,
        "semantic": {"card": P_SEMANTIC_CARD, "contact": P_SEMANTIC_CONTACT,
                     "twinContactShare": TWIN_CONTACT_SHARE},
        "recordingNoise": {"cardNull": NOISE_CARD_NULL, "contactNull": NOISE_CONTACT_NULL,
                           "genderU": NOISE_GENDER_U},
        "negativeMix": NEG_RATIO, "negativesPerPositive": NEG_PER_POS,
        "counts": {"calibration": tally(cal_pairs), "eval": tally(eval_pairs)},
    }
    (CORPUS / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=2))
    print(json.dumps(manifest["counts"], ensure_ascii=False))


def tally(pairs):
    labels = Counter(p["label"] for p in pairs)
    kinds = Counter(p["kind"] for p in pairs)
    reachable = sum(1 for p in pairs if p["label"] == "MATCH" and p["blockingReachable"])
    return {"total": len(pairs), "labels": dict(labels), "kinds": dict(kinds),
            "positivesBlockingReachable": reachable}


def write_jsonl(path, rows):
    with path.open("w", encoding="utf-8") as handle:
        for row in rows:
            handle.write(json.dumps(row, ensure_ascii=False) + "\n")


if __name__ == "__main__":
    sys.exit(main())
