"""run_results v6 -> v5 降维（G7）：迭代删除 parse_run_results 报
extra_forbidden 的键，直到 OM 1.5.11 的 dbt_artifacts_parser 接受。
dbt 1.10（quality-runner 镜像）只产 v6，OM 1.5.11 只吃到 v5——差异
实测仅 batch_results 与 metadata 新增键。在部署机上运行（需要 docker）。"""
import json, re, subprocess, sys

path = sys.argv[1]
doc = json.load(open(path))
doc.setdefault("metadata", {})["dbt_schema_version"] = "https://schemas.getdbt.com/dbt/run-results/v5.json"

def remove_key(obj, dotted):
    parts = dotted.split(".")
    # 支持 results.<idx>.<field...> 与 metadata.<field> 两种形态
    try:
        if parts[0] == "results" and parts[1].isdigit():
            target = doc["results"][int(parts[1])]
            rest = parts[2:]
        elif parts[0] == "results":
            for item in doc.get("results", []):
                cur = item
                for p in parts[1:-1]:
                    cur = cur.get(p, {}) if isinstance(cur, dict) else {}
                if isinstance(cur, dict):
                    cur.pop(parts[-1], None)
            return
        else:
            target = doc
            rest = parts
        for p in rest[:-1]:
            target = target.get(p, {}) if isinstance(target, dict) else {}
        if isinstance(target, dict):
            target.pop(rest[-1], None)
    except (KeyError, ValueError, IndexError):
        pass

tmp = "/tmp/rr-iter.json"
removed = set()
# 预剥离（G16c 教训）：dbt 1.10 对每条 result 都带 batch_results，迭代式每轮
# 只能剥 3 个键、15 轮上限——测试数超过 ~45 后无法收敛（60 条实测翻车）。
# 该字段对 v5 语义无贡献，统一前置删除，迭代循环只兜其余零星键。
for _i, _r in enumerate(doc.get("results", [])):
    if isinstance(_r, dict) and _r.pop("batch_results", None) is not None:
        removed.add(f"results.{_i}.batch_results")
for _ in range(15):
    json.dump(doc, open(tmp, "w"))
    out = subprocess.run(
        ["docker", "run", "--rm", "-v", tmp + ":/tmp/rr.json:ro",
         "--entrypoint", "python3", "openmetadata/ingestion:1.5.11", "-c",
         "import json;from dbt_artifacts_parser.parser import parse_run_results;"
         "parse_run_results(json.load(open('/tmp/rr.json')))"],
        capture_output=True, text=True)
    combined = out.stdout + out.stderr
    if out.returncode == 0:
        print("PASS after removing:", sorted(removed))
        json.dump(doc, open(path, "w"))
        sys.exit(0)
    for m in re.finditer(r"^(results\.\d+\.[\w.]+|metadata\.[\w.]+|[\w.]+)\n?\s*$",
                         out.stdout, re.M):
        pass
    # 从错误块提取键路径（形如 results.0.timing.completed_at 或 metadata.xxx）
    keys = re.findall(r"^(results(?:\.\d+)?(?:\.[\w]+)+|metadata\.[\w.]+)$",
                      combined, re.M)
    if not keys:
        print("UNRESOLVED:", combined[-600:])
        sys.exit(1)
    for k in keys[:3]:
        remove_key(doc, k)
        removed.add(k)
print("NOT CONVERGED, removed:", sorted(removed))
sys.exit(1)
