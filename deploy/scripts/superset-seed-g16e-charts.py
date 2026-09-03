#!/usr/bin/env python3
"""G16e 消费面深化：在 Superset 建 4 个新数据集（ep_chain/patient/ep_order/
institution_drug_catalog）+ 4 张图表挂 dashboard 2（电子处方嵌入验证）。
幂等：按 slice_name / dataset 表名查重跳过（G4 教训：API 不按名去重）。
在 superset 容器内执行；口令从环境 SUP_PW/SUP_USER 注入（dev .env 轮换后口径）：
  docker cp superset-seed-g16e-charts.py medical-platform-superset-1:/tmp/
  docker exec -e SUP_PW=... -e SUP_USER=dataos-spike medical-platform-superset-1 \
    python3 /tmp/superset-seed-g16e-charts.py
"""
import json
import os
import urllib.error
import urllib.request
import http.cookiejar

BASE = "http://localhost:8088/api/v1"
DASHBOARD_ID = 2          # 电子处方嵌入验证（DATAOS_SUPERSET_ALLOWED_DASHBOARDS）
DATABASE_ID = 2           # doris-ods-ep（dataos_quality_ro 库级 ods_ep 可读）

jar = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

def call(method, path, body=None, headers=None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    data = json.dumps(body, ensure_ascii=False).encode() if body is not None else None
    try:
        with op.open(req, data) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        try:
            return e.code, json.loads(e.read())
        except Exception:
            return e.code, {}

_, d = call("POST", "/security/login",
            {"username": os.environ["SUP_USER"], "password": os.environ["SUP_PW"],
             "provider": "db", "refresh": True})
tok = d["access_token"]
auth = {"Authorization": f"Bearer {tok}"}
_, csrf_d = call("GET", "/security/csrf_token/", None, auth)
write = {**auth, "X-CSRFToken": csrf_d["result"], "Referer": "http://localhost:8088/"}

# ---- 1/3 数据集（幂等：按表名查重） ----
TARGETS = ["ep_chain", "patient", "ep_order", "institution_drug_catalog"]
_, ds_list = call("GET", "/dataset/?q=(page_size:100)", None, auth)
existing = {x["table_name"]: x["id"] for x in ds_list["result"]}
ds_ids = {}
for t in TARGETS:
    if t in existing:
        ds_ids[t] = existing[t]
        print("dataset exists:", t, existing[t])
        continue
    s, d = call("POST", "/dataset/",
                {"database": DATABASE_ID, "schema": "ods_ep", "table_name": t}, write)
    if s in (200, 201):
        ds_ids[t] = d["id"]
        print("dataset created:", t, d["id"])
    else:
        raise SystemExit(f"dataset {t} failed: {s} {str(d)[:200]}")

count_metric = {
    "expressionType": "SIMPLE", "column": None, "aggregate": "COUNT",
    "sqlExpression": None, "isNew": False, "label": "记录数",
    "hasCustomLabel": True, "optionName": "metric_g16e_count",
}

def ts_line(table, x, y_title, x_title):
    return {
        "datasource": f"{ds_ids[table]}__table",
        "viz_type": "echarts_timeseries_line",
        "x_axis": x, "time_grain_sqla": "P1D", "x_axis_sort_asc": True,
        "metrics": [count_metric], "groupby": [], "adhoc_filters": [],
        "limit": 0, "order_desc": True, "row_limit": 10000,
        "truncate_metric": True, "show_value": False, "rich_tooltip": True,
        "y_axis_format": "SMART_NUMBER", "y_axis_title": y_title,
        "x_axis_title": x_title, "color_scheme": "supersetColors",
        "annotation_layers": [], "time_range": "No filter",
    }

def bar(table, x, y_title, x_title, top=10):
    return {
        "datasource": f"{ds_ids[table]}__table",
        "viz_type": "echarts_timeseries_bar",
        "x_axis": x, "time_grain_sqla": "P1D",
        "adhoc_filters": [], "metrics": [count_metric], "groupby": [],
        "limit": top, "timeseries_limit_metric": count_metric,
        "order_desc": True, "row_limit": top,
        "truncate_metric": True, "show_value": True, "orientation": "horizontal",
        "y_axis_format": "SMART_NUMBER", "y_axis_title": y_title,
        "x_axis_title": x_title, "color_scheme": "supersetColors",
        "rich_tooltip": True, "time_range": "No filter",
    }

CHARTS = [
    ("处方链路事件趋势（日）", "ep_chain", ts_line("ep_chain", "CREATE_TIME", "链路事件数", "事件日期（日）")),
    ("患者注册增长（日）", "patient", ts_line("patient", "CREATE_TIME", "注册患者数", "注册日期（日）")),
    ("订单状态分布", "ep_order", bar("ep_order", "ORDER_STATUS", "订单数", "订单状态码", 20)),
    ("药品目录覆盖机构 TOP", "institution_drug_catalog", bar("institution_drug_catalog", "INSTITUTION_NAME", "目录条目数", "机构", 10)),
]

# ---- 2/3 图表（幂等：按 slice_name 查重） ----
_, ch_list = call("GET", "/chart/?q=(page_size:200)", None, auth)
existing_charts = {x["slice_name"] for x in ch_list["result"]}
created = []
for title, table, params in CHARTS:
    if title in existing_charts:
        print("chart exists, skip:", title)
        continue
    s, d = call("POST", "/chart/", {
        "slice_name": title,
        "description": "data-os G16e 消费面深化（ods_ep." + table + "）",
        "datasource_id": ds_ids[table],
        "datasource_type": "table",
        "params": json.dumps(params, ensure_ascii=False),
        "dashboards": [DASHBOARD_ID],
    }, write)
    print("create", title, "->", s, str(d)[:120])
    if s in (200, 201):
        created.append((title, d["id"]))
    else:
        raise SystemExit("chart creation failed: " + title)

if not created:
    print("no new charts; done")
    raise SystemExit(0)

# ---- 3/3 布局：追加新行（G4 模式） ----
s, d = call("GET", f"/dashboard/{DASHBOARD_ID}", None, auth)
pos = json.loads(d["result"]["position_json"])
grid = pos.get("GRID_ID", {})
children = list(grid.get("children", []))
next_row = len([c for c in children if c.startswith("ROW-")]) + 1
for idx, (title, chart_id) in enumerate(created):
    row_key = f"ROW-{next_row + idx}"
    chart_key = f"CHART-{chart_id}"
    pos[row_key] = {"type": "ROW", "id": row_key, "children": [chart_key], "meta": {"background": "BACKGROUND_TRANSPARENT"}}
    pos[chart_key] = {
        "type": "CHART", "id": chart_key,
        "children": [f"COLUMN-{chart_id}"],
        "meta": {"width": 12, "height": 50, "chartId": chart_id, "uuid": f"u{chart_id}"},
    }
    pos[f"COLUMN-{chart_id}"] = {
        "type": "COLUMN", "id": f"COLUMN-{chart_id}", "children": [],
        "meta": {"background": "BACKGROUND_TRANSPARENT", "width": 12},
    }
    children.append(row_key)
grid["children"] = children
pos["GRID_ID"] = grid
s, d = call("PUT", f"/dashboard/{DASHBOARD_ID}",
            {"position_json": json.dumps(pos, ensure_ascii=False)}, write)
print("layout updated:", s)
s, d = call("GET", f"/dashboard/{DASHBOARD_ID}", None, auth)
print("charts assoc:", json.loads(d["result"]["position_json"]).get("DASHBOARD_VERSION_KEY", "v2"))
print("DONE: charts", [c[1] for c in created])
