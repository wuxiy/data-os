"""dbt 测试 -> OM TestCase 直登器（G7，受控替代路径）。

背景：OM 1.5.11 的 Dbt connector 在本平台有两个死点——dbt 1.10 产物版本
不兼容（已用 1.7 旁路解决 manifest/catalog）与 Doris 无 database 层导致
表 fqn 解析失败（TestCase/DataModel 均不落）。本脚本绕开 connector，
按标准 REST 直接登记：TestDefinition（dbt_ 前缀，幂等）-> executable
TestSuite（挂表）-> TestCase（挂表/列）-> 最近一次 run_results 的结果。

输入：OM_API_BASE/OM_JWT 环境变量；manifest.json 与 run_results.json 路径
参数。语义与 connector 相同（数据源是 dbt 产物，不硬造）。
"""
import json
import os
import ssl
import sys
import urllib.request

# dbt 测试类型 -> OM TestDefinition（dbt_ 前缀区分来源，避免与 OM 内置撞名）
DEFINITION_DESCRIPTION = {
    "unique": "dbt unique：列值唯一（G7 质量测试资产化）",
    "not_null": "dbt not_null：列值非空（G7 质量测试资产化）",
    "accepted_values": "dbt accepted_values：列值域（G7 质量测试资产化）",
    "relationships": "dbt relationships：外键引用（G7 质量测试资产化）",
}


def client(api_base, jwt):
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE

    def call(method, path, body=None):
        data = json.dumps(body).encode() if body is not None else None
        req = urllib.request.Request(api_base.rstrip("/") + path, data=data, method=method)
        req.add_header("Authorization", f"Bearer {jwt}")
        if data:
            req.add_header("Content-Type", "application/json")
        try:
            with urllib.request.urlopen(req, context=ctx) as resp:
                text = resp.read().decode()
            return (resp.status, json.loads(text) if text else {})
        except urllib.error.HTTPError as err:
            text = err.read().decode()
            try:
                return (err.code, json.loads(text))
            except ValueError:
                return (err.code, {"raw": text})

    return call


def ensure_definition(call, dbt_type):
    """幂等建 TestDefinition；列级/表级由 TestCase 的 entityLink 表达。"""
    name = f"dbt_{dbt_type}"
    status, _ = call("GET", f"/testDefinitions/name/{name}")
    if status == 200:
        return name
    status, body = call("POST", "/testDefinitions", {
        "name": name,
        "description": DEFINITION_DESCRIPTION.get(dbt_type, f"dbt {dbt_type}"),
        "entityType": "TABLE",
    })
    if status not in (200, 201):
        raise RuntimeError(f"testDefinition {name} 创建失败: {status} {body}")
    return name


def ensure_suite(call, table_fqn):
    """幂等建表的 executable test suite（OM 惯例：suite 名 = 表 fqn）。"""
    status, existing = call("GET", f"/testSuites/name/{table_fqn}")
    if status == 200:
        return table_fqn
    status, body = call("POST", "/testSuites/executable", {
        "name": table_fqn,
        "displayName": table_fqn,
        "executableEntity": table_fqn,
    })
    if status not in (200, 201):
        raise RuntimeError(f"testSuite {table_fqn} 创建失败: {status} {body}")
    return table_fqn


def ensure_test_case(call, test_name, definition, suite_fqn, entity_link, params):
    payload = {
        "name": test_name,
        "description": "quality-runner dbt 测试（G7 资产化）",
        "testDefinition": definition,
        "entityLink": entity_link,
        "testSuite": suite_fqn,
        "parameterValues": params,
    }
    status, body = call("POST", "/testCases", payload)
    if status not in (200, 201):
        # 已存在则幂等通过
        if body.get("code") == 409 or "already exists" in str(body.get("message", "")):
            return test_name
        raise RuntimeError(f"testCase {test_name} 创建失败: {status} {body}")
    return test_name


def add_result(call, case_fqn, status_str, timestamp, message):
    body = {
        "timestamp": int(timestamp),
        "testCaseStatus": status_str,
        "result": message[:300] or " ",
        "sampleData": None,
    }
    status, resp = call("POST", f"/testCases/name/{case_fqn}/testCaseResults", body)
    if status not in (200, 201):
        print(f"    结果写入失败 {case_fqn}: {status} {str(resp)[:120]}")


def main():
    manifest = json.load(open(sys.argv[1]))
    run_results_path = sys.argv[2] if len(sys.argv) > 2 else None
    run_results = json.load(open(run_results_path)) if run_results_path else {}
    api = os.environ["OM_API_BASE"]
    call = client(api, os.environ["OM_JWT"])

    entities = {**manifest.get("sources", {}), **manifest.get("nodes", {})}
    result_by_id = {r["unique_id"]: r for r in run_results.get("results", [])}
    service = os.environ.get("DATAOS_OM_SERVICE", "doris-dataos")

    count = 0
    for key, node in manifest.get("nodes", {}).items():
        if node.get("resource_type") != "test":
            continue
        test_name = node.get("name", "")
        # dbt 测试类型优先取 test_metadata.name（unique/not_null/…），
        # unique_id 首段是固定前缀 "test" 不能直接用。
        test_meta = node.get("test_metadata") or {}
        dbt_type = test_meta.get("name") or (key.split(".")[1] if key.count(".") >= 1 else "generic")
        attached_ids = (node.get("depends_on") or {}).get("nodes") or []
        if not attached_ids:
            print(f"  [SKIP] {test_name}: 无 attached 节点")
            continue
        attached = entities.get(attached_ids[0])
        if not attached:
            print(f"  [SKIP] {test_name}: attached 未解析 {attached_ids[0]}")
            continue
        table_fqn = f"{service}.default.{attached.get('schema')}.{attached.get('identifier')}"
        definition = ensure_definition(call, dbt_type)
        suite = ensure_suite(call, table_fqn)
        column = node.get("column_name")
        if column:
            entity_link = f"<#E::COLUMN::{table_fqn}::{column}>"
        else:
            entity_link = f"<#E::TABLE::{table_fqn}>"
        params = []
        for k, v in (test_meta.get("kwargs") or {}).items():
            if k in ("model", "column_name", "config"):
                continue
            params.append({"name": k, "value": json.dumps(v, ensure_ascii=False)})
        ensure_test_case(call, test_name, definition, suite, entity_link, params)
        count += 1
        line = f"  [OK] {test_name} -> {table_fqn}" + (f".{column}" if column else "")
        result = result_by_id.get(key)
        if result:
            status_map = {"pass": "Success", "warn": "Success", "fail": "Failed", "error": "Aborted"}
            om_status = status_map.get(str(result.get("status")).lower(), "Aborted")
            case_fqn = f"{table_fqn}.{test_name if not column else column + '.' + test_name}"
            # OM TestCase fqn 规约：表[.列].测试名
            case_fqn = f"{table_fqn}.{column}.{test_name}" if column else f"{table_fqn}.{test_name}"
            add_result(call, case_fqn, om_status,
                       run_results.get("metadata", {}).get("generated_at_ts")
                       or _epoch(run_results),
                       str(result.get("message") or result.get("status")))
            line += f"（最近结果 {om_status}）"
        print(line)
    print(f"登记 TestCase：{count}")


def _epoch(run_results):
    import datetime
    generated = run_results.get("metadata", {}).get("generated_at")
    try:
        dt = datetime.datetime.fromisoformat(generated.replace("Z", "+00:00"))
        return dt.timestamp() * 1000
    except (ValueError, AttributeError):
        return 0


if __name__ == "__main__":
    main()
