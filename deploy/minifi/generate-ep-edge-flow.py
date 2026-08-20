#!/usr/bin/env python3
"""生成 G5 院内边缘采集 MiNiFi flow（flow.json.gz）。

链路（每张 EP 表一个分支）：
  GenerateTableFetch(按 UPDATE_TIME 增量) → ExecuteSQLRecord(JSON 行)
  → PutS3Object(投递 RustFS 中转桶)，SQL/投递失败各自环回重试。

秘密（DM 口令、S3 密钥）经环境变量注入，只在生成的 flow 文件中出现，
绝不进入仓库；S3 密钥走 PutS3Object 敏感属性，由 MiNiFi 以
nifi.sensitive.props.key 加密驻留。用法：

  DM_USER=... DM_PASSWORD=... S3_ACCESS_KEY=... S3_SECRET_KEY=... \
  python3 generate-ep-edge-flow.py > flow.json.gz
"""

from __future__ import annotations

import gzip
import json
import os
import sys

NIFI_VERSION = "2.10.0"
TABLES = [
    {"table": "EP_MZ_CFZB", "prefix": "ep_mz_cfzb"},
    {"table": "EP_MZ_YPCFMX", "prefix": "ep_mz_ypcfmx"},
]


def required(name: str) -> str:
    value = os.environ.get(name, "").strip()
    if not value:
        sys.stderr.write(f"missing required env: {name}\n")
        sys.exit(2)
    return value


def ids(seq: str) -> tuple[str, str]:
    identifier = f"a1b2c3d4-0000-0000-0000-{seq}"
    return identifier, identifier.replace(seq, "f" + seq[1:])


def descriptors(properties: dict) -> dict:
    return {key: {"name": key, "displayName": key} for key in properties}


def processor(seq: str, name: str, ptype: str, artifact: str, comments: str,
              position: dict, properties: dict, relationships: list,
              auto_terminated: list, scheduling_period: str = "60 sec",
              penalty: str = "30 sec") -> dict:
    identifier, instance = ids(seq)
    return {
        "identifier": identifier,
        "instanceIdentifier": instance,
        "name": name,
        "comments": comments,
        "type": ptype,
        "bundle": {"group": "org.apache.nifi", "artifact": artifact, "version": NIFI_VERSION},
        "position": position,
        "concurrentlySchedulableTaskCount": 1,
        "schedulingPeriod": scheduling_period,
        "schedulingStrategy": "TIMER_DRIVEN",
        "penaltyDuration": penalty,
        "yieldDuration": "1 sec",
        "bulletinLevel": "WARN",
        "runDurationMillis": 0,
        "autoTerminatedRelationships": auto_terminated,
        "properties": properties,
        "propertyDescriptors": descriptors(properties),
        "style": {},
        "relationships": [
            {"name": relation, "autoTerminate": relation in auto_terminated}
            for relation in relationships
        ],
        "scheduledState": "ENABLED",
        "executionEngine": "INHERITED",
        "executionNode": "ALL",
        "componentType": "PROCESSOR",
    }


def connection(seq: str, source_seq: str, destination_seq: str, relationships: list) -> dict:
    identifier, instance = ids(seq)
    source, _ = ids(source_seq)
    destination, _ = ids(destination_seq)
    return {
        "identifier": identifier,
        "instanceIdentifier": instance,
        "name": "",
        "source": {"id": source, "type": "PROCESSOR"},
        "destination": {"id": destination, "type": "PROCESSOR"},
        "selectedRelationships": relationships,
        "labelIndex": 1,
        "zIndex": 0,
        "backPressureObjectThreshold": 10000,
        "backPressureDataSizeThreshold": "1 GB",
        "flowFileExpiration": "0 sec",
        "prioritizers": [],
        "componentType": "CONNECTION",
    }


def service(seq: str, name: str, stype: str, artifact: str, properties: dict) -> dict:
    identifier, instance = ids(seq)
    return {
        "identifier": identifier,
        "instanceIdentifier": instance,
        "name": name,
        "comments": "",
        "type": stype,
        "bundle": {"group": "org.apache.nifi", "artifact": artifact, "version": NIFI_VERSION},
        "position": {"x": 0.0, "y": 0.0},
        "properties": properties,
        "propertyDescriptors": descriptors(properties),
        "style": {},
        "scheduledState": "ENABLED",
        "componentType": "CONTROLLER_SERVICE",
    }


def main() -> None:
    dm_url = os.environ.get("DM_URL", "jdbc:dm://192.168.17.76:5236?schema=EP_TEST")
    dm_user = required("DM_USER")
    dm_password = required("DM_PASSWORD")
    s3_endpoint = required("S3_ENDPOINT")
    s3_bucket = required("S3_BUCKET")
    s3_access_key = required("S3_ACCESS_KEY")
    s3_secret_key = required("S3_SECRET_KEY")
    s3_region = os.environ.get("S3_REGION", "us-east-1")
    poll = os.environ.get("POLL_PERIOD", "60 sec")
    dbcp_seq, writer_seq = "000000000100", "000000000101"
    dbcp_id, _ = ids(dbcp_seq)
    writer_id, _ = ids(writer_seq)

    controller_services = [
        service(dbcp_seq, "dm-ep-dbcp", "org.apache.nifi.dbcp.DBCPConnectionPool",
                "nifi-dbcp-service-nar", {
                    "Database Connection URL": dm_url,
                    "Database Driver Class Name": "dm.jdbc.driver.DmDriver",
                    "Database Driver Location(s)": "/opt/minifi/minifi-2.10.0/lib/DmJdbcDriver18.jar",
                    "Database User": dm_user,
                    "Password": dm_password,
                }),
        service(writer_seq, "json-lines-writer", "org.apache.nifi.json.JsonRecordSetWriter",
                "nifi-record-serialization-services-nar", {
                    "Schema Access Strategy": "inherit-record-schema",
                    "Schema Write Strategy": "no-schema",
                    "Timestamp Format": "yyyy-MM-dd HH:mm:ss",
                    # 直接输出 JSON 行（SeaTunnel json 源按行解析；数组形态
                    # 会 FILE-08 失败，故不走 ReplaceText 转换链）。
                    "Output Grouping": "output-oneline",
                    "Pretty Print JSON": "false",
                }),
    ]

    processors: list[dict] = []
    connections: list[dict] = []
    for index, spec in enumerate(TABLES):
        suffix = str(index)
        gtf_seq = f"0000000002{suffix}0"
        sql_seq = f"0000000002{suffix}1"
        put_seq = f"0000000002{suffix}2"
        requeue_sql_seq = f"0000000002{suffix}3"
        requeue_put_seq = f"0000000002{suffix}4"
        x = 120.0 + index * 60.0

        processors.append(processor(
            gtf_seq, f"fetch-{spec['prefix']}-incremental",
            "org.apache.nifi.processors.standard.GenerateTableFetch", "nifi-standard-nar",
            f"按 UPDATE_TIME 列值增量拉取 {spec['table']}（状态本地持久化，断电不重不漏）",
            {"x": x, "y": 100.0},
            {
                "Database Connection Pooling Service": dbcp_id,
                "Table Name": spec["table"],
                # NiFi 2.x 增量列属性的 name() 是 "Maximum-value Columns"
                # （displayName 是 Max-Value Columns；flow.json 按内部名匹配，
                # 写 displayName 或 1.x 的 "Column Name" 都会被静默忽略）。
                "Maximum-value Columns": "UPDATE_TIME",
            },
            # NiFi 2.x 的 GenerateTableFetch 实际带 failure 关系（声明缺失会被
            # 按真实关系集校验为未连接）。失败不推进增量位点，下一轮轮询按
            # UPDATE_TIME 窗口自愈，故 auto-terminate 安全。
            ["success", "failure"], ["failure"], scheduling_period=poll))

        processors.append(processor(
            sql_seq, f"read-{spec['prefix']}-as-json",
            "org.apache.nifi.processors.standard.ExecuteSQLRecord", "nifi-standard-nar",
            "执行增量 SQL 并输出 JSON 行（One Line Per Object，时间戳 yyyy-MM-dd HH:mm:ss）",
            {"x": x, "y": 260.0},
            {
                "Database Connection Pooling Service": dbcp_id,
                "SQL select query": f"SELECT * FROM {spec['table']}",
                "Record Writer": writer_id,
                "Output Batch Size": "0",
            },
            ["success", "failure", "original"], ["original"]))

        processors.append(processor(
            put_seq, f"put-{spec['prefix']}-to-relay",
            "org.apache.nifi.processors.aws.s3.PutS3Object", "nifi-aws-nar",
            "投递到 RustFS 中转桶（IP 端点自动 path-style；失败 30 秒后环回重试，"
            "断网期间 FlowFile 驻留本地 content repository）",
            {"x": x, "y": 420.0},
            {
                # uuid 是 FlowFile 属性（非 EL 函数）：重试环回时对象键稳定，天然幂等。
                "Object Key": f"{spec['prefix']}/${{now():format('yyyyMMddHHmmss')}}-${{uuid}}.json",
                "Bucket": s3_bucket,
                "Endpoint Override URL": s3_endpoint,
                "Region": s3_region,
                "Access Key": s3_access_key,
                "Secret Key": s3_secret_key,
            },
            ["success", "failure"], ["success"], scheduling_period="0 sec"))

        for requeue_seq, target_seq, comments in (
                (requeue_sql_seq, sql_seq, f"SQL 失败经处罚期后重排队（重执行同一增量窗口）"),
                (requeue_put_seq, put_seq, f"投递失败经处罚期后重排队（断网期间数据驻留本地）")):
            # MiNiFi 的 UpdateAttribute 在独立 minifi-update-attribute-nar，且类在
            # processors.attributes 包（nifi-standard-nar 是裁子集，引用错会退化 Ghost）。
            processors.append(processor(
                requeue_seq, f"requeue-{spec['prefix']}-{'sql' if target_seq == sql_seq else 'put'}",
                "org.apache.nifi.processors.attributes.UpdateAttribute", "minifi-update-attribute-nar",
                comments,
                {"x": x + 250.0, "y": 260.0 if target_seq == sql_seq else 420.0},
                {"retrying": "true"},
                ["success"], [], scheduling_period="0 sec"))

        connections.append(connection(f"0000000003{suffix}0", gtf_seq, sql_seq, ["success"]))
        connections.append(connection(f"0000000003{suffix}1", sql_seq, put_seq, ["success"]))
        connections.append(connection(f"0000000003{suffix}2", sql_seq, requeue_sql_seq, ["failure"]))
        connections.append(connection(f"0000000003{suffix}3", requeue_sql_seq, sql_seq, ["success"]))
        connections.append(connection(f"0000000003{suffix}4", put_seq, requeue_put_seq, ["failure"]))
        connections.append(connection(f"0000000003{suffix}5", requeue_put_seq, put_seq, ["success"]))


    flow = {
        "encodingVersion": {"majorVersion": 2, "minorVersion": 0},
        "maxTimerDrivenThreadCount": 2,
        "registries": [],
        "parameterContexts": [],
        "parameterProviders": [],
        "controllerServices": [],
        "reportingTasks": [],
        "flowAnalysisRules": [],
        "connectors": [],
        "rootGroup": {
            "identifier": "a1b2c3d4-0000-0000-0000-000000000001",
            "instanceIdentifier": "a1b2c3d4-0000-0000-0000-000000000002",
            "name": "ep-edge-relay",
            "comments": "G5 院内边缘采集：DM 增量→RustFS 中转桶（生成器 deploy/minifi/generate-ep-edge-flow.py）",
            "position": {"x": 0.0, "y": 0.0},
            "processGroups": [],
            "remoteProcessGroups": [],
            "processors": processors,
            "inputPorts": [],
            "outputPorts": [],
            "connections": connections,
            "labels": [],
            "funnels": [],
            "controllerServices": controller_services,
            "defaultFlowFileExpiration": "0 sec",
            "defaultBackPressureObjectThreshold": 10000,
            "defaultBackPressureDataSizeThreshold": "1 GB",
            "scheduledState": "ENABLED",
            "executionEngine": "INHERITED",
            "maxConcurrentTasks": 1,
            "statelessFlowTimeout": "1 min",
            "flowFileConcurrency": "UNBOUNDED",
            "flowFileOutboundPolicy": "STREAM_WHEN_AVAILABLE",
            "componentType": "PROCESS_GROUP",
        },
    }

    payload = json.dumps(flow, ensure_ascii=False, indent=2).encode("utf-8")
    with gzip.GzipFile(fileobj=sys.stdout.buffer, mode="wb", mtime=0) as archive:
        archive.write(payload)


if __name__ == "__main__":
    main()
