# G14 P1：从 Doris 导出 MPI 身份快照与人工裁决锚点（只读）。
# 经 data-api 容器执行（pymysql 可达 Doris；凭证从环境注入，不落盘）。
# 输出两个 JSONL：snapshot.jsonl（1433 身份，确定性排序）、anchors_raw.jsonl
# （人工裁决 pair + 双侧属性）。PHI 口径：EP 为 EP_TEST 合成演示数据（G3 记录在案），
# contact_hash 本就是加盐哈希；快照入 Git 换评测可复现性。
import json
import os
import sys

import pymysql

SNAPSHOT_SQL = """
SELECT institution_code, source_system, source_key, patient_id,
       card_no_norm, name_norm, gender, contact_hash
FROM dataos_mpi.mpi_source_identity
WHERE tenant_id = 'default'
ORDER BY institution_code, source_system, source_key
"""

# 锚点：PG 已裁决复核任务 → pair_id + resolution；属性经 Doris 候选对 JOIN 身份表取回。
ANCHOR_PAIR_SQL = """
SELECT p.pair_id, p.identity_a, p.identity_b,
       a.institution_code, a.patient_id, a.card_no_norm, a.name_norm, a.gender, a.contact_hash,
       b.institution_code, b.patient_id, b.card_no_norm, b.name_norm, b.gender, b.contact_hash
FROM dataos_mpi.mpi_candidate_pair p
JOIN dataos_mpi.mpi_source_identity a
  ON CONCAT(a.institution_code, '|', a.source_system, '|', a.source_key) = p.identity_a
JOIN dataos_mpi.mpi_source_identity b
  ON CONCAT(b.institution_code, '|', b.source_system, '|', b.source_key) = p.identity_b
WHERE p.pair_id IN (%s)
ORDER BY p.pair_id
"""


def main() -> None:
    conn = pymysql.connect(
        host="172.16.66.8", port=9030, user="dataos_mpi",
        password=os.environ["DORIS_MPI_PASSWORD"], database="dataos_mpi", charset="utf8mb4",
    )
    cur = conn.cursor()

    for row in fetch(cur, SNAPSHOT_SQL):
        sys.stdout.write(json.dumps({
            "institution": row[0], "sourceSystem": row[1], "sourceKey": row[2],
            "patientId": row[3], "card": row[4], "name": row[5],
            "gender": row[6], "contactHash": row[7],
        }, ensure_ascii=False) + "\n")

    # 锚点从环境变量 ANCHORS 传入（resolution|pair_id 逗号分隔；脚本本体已占 stdin）
    raw = os.environ.get("ANCHORS", "")
    anchors = [item.split("|", 1) for item in raw.split(",") if item]
    if anchors:
        ids = [int(pair_id) for _, pair_id in anchors]
        resolution_by_id = {int(pair_id): resolution for resolution, pair_id in anchors}
        placeholders = ",".join(["%s"] * len(ids))
        for row in fetch(cur, ANCHOR_PAIR_SQL % placeholders, ids):
            sys.stderr.write(json.dumps({
                "pairId": row[0], "resolution": resolution_by_id[row[0]],
                "a": side(row, 3), "b": side(row, 9),
            }, ensure_ascii=False) + "\n")


def fetch(cur, sql, args=None):
    cur.execute(sql, args or ())
    while True:
        rows = cur.fetchmany(500)
        if not rows:
            return
        yield from rows


def side(row, base):
    return {"institution": row[base], "patientId": row[base + 1], "card": row[base + 2],
            "name": row[base + 3], "gender": row[base + 4], "contactHash": row[base + 5]}


if __name__ == "__main__":
    main()
