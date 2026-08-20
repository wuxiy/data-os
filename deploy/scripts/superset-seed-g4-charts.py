#!/usr/bin/env python3
"""G4.2 一次性建图（可重现）：在 Superset 建「开方量趋势/开方科室 TOP10」
两图并挂入 dashboard 2（见 docs/analytics-g4-review-and-plan-20260820.md D4）。
在 superset 容器内执行；口令从环境 SPIKE_PW 注入，不落盘：
  docker cp superset-seed-g4-charts.py medical-platform-superset-1:/tmp/
  docker exec -e SPIKE_PW=$(cat /root/spike-hapi/superset-spike-pw) \
    medical-platform-superset-1 python3 /tmp/superset-seed-g4-charts.py
重复执行会再建同名图表（Superset 不按名去重）；重跑前先在 UI 删除旧图。"""
import json
import os
import urllib.request
import http.cookiejar

BASE = "http://localhost:8088/api/v1"
pw = os.environ["SPIKE_PW"]

jar = http.cookiejar.CookieJar()
op = urllib.request.build_opener(urllib.request.HTTPCookieProcessor(jar))

def call(method, path, body=None, headers=None):
    req = urllib.request.Request(BASE + path, method=method)
    req.add_header("Content-Type", "application/json")
    for k, v in (headers or {}).items():
        req.add_header(k, v)
    data = json.dumps(body).encode() if body is not None else None
    try:
        with op.open(req, data) as r:
            return r.status, json.loads(r.read())
    except urllib.error.HTTPError as e:
        return e.code, json.loads(e.read())

_, d = call("POST", "/security/login",
            {"username": "dataos-spike", "password": pw, "provider": "db", "refresh": True})
tok = d["access_token"]
auth = {"Authorization": f"Bearer {tok}"}

_, csrf_d = call("GET", "/security/csrf_token/", headers=auth)
csrf = csrf_d["result"]
write = {**auth, "X-CSRFToken": csrf, "Referer": "http://localhost:8088/"}

s, d = call("GET", "/chart/4", headers=auth)
template = d["result"]
# 图表 API 不回 datasource_id：从数据集列表按表名定位（ep_mz_cfzb）
s, d = call("GET", "/dataset/?q=(filters:!((col:table_name,opr:eq,value:ep_mz_cfzb)))", headers=auth)
datasource_id = d["result"][0]["id"]
print("template viz:", template["viz_type"], "| datasource:", datasource_id)

count_metric = {
    "expressionType": "SIMPLE", "column": None, "aggregate": "COUNT",
    "sqlExpression": None, "isNew": False, "label": "记录数",
    "hasCustomLabel": True, "optionName": "metric_g4_count",
}

trend_params = {
    "datasource": str(datasource_id) + "__table",
    "viz_type": "echarts_timeseries_line",
    "x_axis": "KFRQ",
    "time_grain_sqla": "P1D",
    "x_axis_sort_asc": True,
    "metrics": [count_metric],
    "groupby": [],
    "adhoc_filters": [],
    "limit": 0,
    "timeseries_limit_metric": None,
    "order_desc": True,
    "row_limit": 10000,
    "truncate_metric": True,
    "show_value": False,
    "rich_tooltip": True,
    "tooltipTimeFormat": "smart_date",
    "y_axis_format": "SMART_NUMBER",
    "y_axis_title": "开方量",
    "x_axis_title": "开方日期（日）",
    "color_scheme": "supersetColors",
    "annotation_layers": [],
    "time_range": "No filter",
}

top10_params = {
    "datasource": str(datasource_id) + "__table",
    "viz_type": "echarts_timeseries_bar",
    "x_axis": "JZKSMC",
    "time_grain_sqla": "P1D",
    "adhoc_filters": [],
    "metrics": [count_metric],
    "groupby": [],
    "limit": 10,
    "timeseries_limit_metric": {"expressionType": "SIMPLE", "column": None,
                                "aggregate": "COUNT", "sqlExpression": None,
                                "isNew": False, "label": "记录数",
                                "hasCustomLabel": True,
                                "optionName": "metric_g4_count"},
    "order_desc": True,
    "row_limit": 10,
    "truncate_metric": True,
    "show_value": True,
    "orientation": "horizontal",
    "y_axis_format": "SMART_NUMBER",
    "y_axis_title": "开方量",
    "x_axis_title": "就诊科室",
    "color_scheme": "supersetColors",
    "rich_tooltip": True,
    "time_range": "No filter",
}

created = []
for title, params in [("开方量趋势（KFRQ 日）", trend_params), ("开方科室 TOP10", top10_params)]:
    s, d = call("POST", "/chart/", {
        "slice_name": title,
        "description": "data-os G4 嵌入分析页（ods_ep.ep_mz_cfzb）",
        "datasource_id": datasource_id,
        "datasource_type": "table",
        "params": json.dumps(params, ensure_ascii=False),
        "dashboards": [2],
    }, write)
    print("create", title, "->", s, str(d)[:120])
    if s in (200, 201):
        created.append((title, d.get("id")))

if not created:
    raise SystemExit("chart creation failed")

# 布局：在现有 position_json 基础上追加两行（ROW-2 趋势 / ROW-3 TOP10）
s, d = call("GET", "/dashboard/2", headers=auth)
pos = json.loads(d["result"]["position_json"])
charts_in_layout = [k for k in pos if k.startswith("CHART-")]
grid = pos.get("GRID_ID", {})
children = list(grid.get("children", []))
next_row = len([c for c in children if c.startswith("ROW-")]) + 1
row_trend = f"ROW-{next_row}"
row_top = f"ROW-{next_row + 1}"
grid["children"] = children + [row_trend, row_top]
pos[row_trend] = {"type": "ROW", "id": row_trend, "children": [],
                  "parents": ["ROOT_ID", "GRID_ID"], "meta": {"background": "BACKGROUND_TRANSPARENT"}}
pos[row_top] = {"type": "ROW", "id": row_top, "children": [],
                "parents": ["ROOT_ID", "GRID_ID"], "meta": {"background": "BACKGROUND_TRANSPARENT"}}
for idx, (title, chart_id) in enumerate(created):
    key = f"CHART-{chart_id}"
    row = row_trend if idx == 0 else row_top
    pos[row]["children"].append(key)
    pos[key] = {"type": "CHART", "id": key, "children": [],
                "parents": ["ROOT_ID", "GRID_ID", row],
                "meta": {"width": 12, "height": 50, "chartId": chart_id,
                         "uuid": f"u{chart_id}"}}
s, d = call("PUT", "/dashboard/2",
            {"position_json": json.dumps(pos, ensure_ascii=False)}, write)
print("layout put ->", s)

s, d = call("GET", "/dashboard/2", headers=auth)
r = d["result"]
pos2 = json.loads(r["position_json"])
print("final CHART keys:", [k for k in pos2 if k.startswith("CHART-")])
print("charts assoc:", r.get("charts"))
