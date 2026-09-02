#!/bin/sh
# S5（安全收敛批）：前置机采集链路网络隔离白名单——幂等、可作 systemd oneshot。
#
# 语义（G5 演练口径的常态化子集）：
#   1) 允许 MiNiFi 前置机网段（172.22.0.0/16）访问采集库 DM（192.168.17.76:5236）
#   2) 拒绝其他任何容器网段访问 DM 5236（容器侧出口收敛，防横向）
#   3) 恢复断链演练规则不在此脚本（演练态另加，见 G5 报告）
#
# G16b 修订（2026-09-02）：EP 域数据面扩展的既定路径是 SeaTunnel 直读 DM
# （docs/ep-domain-expansion-plan-20260902.md §4.1）。为不回退 S5 的防横向语义，
# 增加单项白名单：仅 SeaTunnel master 容器的静态 IP（compose 钉扎 172.20.0.53）
# 允许直读 DM；平台网段其余容器维持 DROP。改 IP 须同步 deploy/dev/docker-compose.yml。
#
# 幂等：按注释标记 -C 检测存在再 -I，重复执行零副作用。
# 回滚：DOCKER-USER 置空即回到无隔离状态（docker 重启不自动清 DOCKER-USER，
#       本脚本经 systemd 开机重放以维持覆盖）。

set -eu

EDGE_NET="${EDGE_NET:-172.22.0.0/16}"
DM_HOST="${DM_HOST:-192.168.17.76}"
DM_PORT="${DM_PORT:-5236}"
ST_INGEST_IP="${ST_INGEST_IP:-172.20.0.53}"

ensure() {
    # ensure <ipt-cmd...>：规则已存在（-C）则跳过，否则插入
    if iptables -C DOCKER-USER "$@" 2>/dev/null; then
        return 0
    fi
    iptables -I DOCKER-USER "$@"
}

# 先放行（白名单优先），再拒绝其他容器网段到 DM
ensure -s "$EDGE_NET" -d "$DM_HOST" -p tcp --dport "$DM_PORT" -j ACCEPT
ensure -s "$ST_INGEST_IP" -d "$DM_HOST" -p tcp --dport "$DM_PORT" -j ACCEPT
if iptables -C DOCKER-USER -d "$DM_HOST" -p tcp --dport "$DM_PORT" -j DROP 2>/dev/null; then
    :
else
    iptables -I DOCKER-USER 3 -d "$DM_HOST" -p tcp --dport "$DM_PORT" -j DROP
fi

echo "DOCKER-USER isolation applied: $EDGE_NET + $ST_INGEST_IP -> $DM_HOST:$DM_PORT allowed, other containers dropped"
