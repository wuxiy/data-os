-- 电子处方边缘链路增量表（G5 前置机模拟）：结构与 ods_ep 直连对账表逐列
-- 一致，仅放松明细表两个 datetime 列的 NOT NULL（边缘链路按 JSON 行传输，
-- 源侧空值不应阻断入仓）。UNIQUE KEY(ID) 提供重放/重复投递的幂等语义
-- （蓝图 7.3）。dataos_quality_ro 的只读授权已在 G1 前完成；dbt 账号授权
-- 见文件末尾（幂等：重复执行无副作用）。
CREATE TABLE IF NOT EXISTS ods_ep.ep_mz_cfzb_edge (
  `ID` bigint NOT NULL,
  `YLJGDM` varchar(1600) NULL,
  `KH` varchar(1600) NULL,
  `KLX` varchar(1600) NULL,
  `JZLSH` varchar(1600) NULL,
  `CFZID` varchar(1600) NULL,
  `CFDL` varchar(1600) NULL,
  `CFLX` varchar(1600) NULL,
  `JZKSDM` varchar(1600) NULL,
  `JZKSMC` varchar(1600) NULL,
  `KFYSGH` varchar(1600) NULL,
  `KFYSXM` varchar(1600) NULL,
  `KFRQ` varchar(1600) NULL,
  `YYMZH` varchar(1600) NULL,
  `HZXM` varchar(1600) NULL,
  `HZXB` varchar(1600) NULL,
  `HZNL` varchar(1600) NULL,
  `LCZD` varchar(1600) NULL,
  `LXFS` varchar(1600) NULL,
  `CFPTZT` int NULL,
  `BZ` varchar(3200) NULL,
  `PATIENT_ID` bigint NULL,
  `YLJGMC` varchar(1600) NULL,
  `CREATE_TIME` datetime NULL,
  `UPDATE_TIME` datetime NULL,
  `LCZDLX` varchar(400) NULL,
  `LCZDZY` varchar(3200) NULL,
  `HZZY` varchar(800) NULL,
  `HZSG` varchar(160) NULL,
  `HZTZ` varchar(160) NULL,
  `HZABO` varchar(160) NULL,
  `HZRH` varchar(160) NULL,
  `HZHY` varchar(320) NULL,
  `HZHYZT` varchar(320) NULL,
  `HZZS` varchar(3200) NULL,
  `HZXBS` varchar(3200) NULL,
  `HZJWS` varchar(3200) NULL,
  `HZGMS` varchar(3200) NULL,
  `HZGRS` varchar(3200) NULL,
  `HZYJS` varchar(3200) NULL,
  `HZHYS` varchar(3200) NULL,
  `HZJZS` varchar(3200) NULL,
  `HZJZHS` varchar(3200) NULL,
  `HZTGJC` varchar(3200) NULL,
  `HZFZJC` varchar(3200) NULL,
  `HZZKJC` varchar(3200) NULL,
  `HZZF` varchar(3200) NULL,
  `CFYXQ` int NULL,
  `CFYZID` varchar(1600) NULL,
  `BIZ_NO` varchar(480) NULL,
  `SFYSGH` varchar(480) NULL,
  `SFYSXM` varchar(800) NULL,
  `HZNLDW` varchar(160) NULL
) ENGINE=OLAP
UNIQUE KEY(`ID`)
DISTRIBUTED BY HASH(`ID`) BUCKETS 10
PROPERTIES (
  "replication_num" = "1"
);

CREATE TABLE IF NOT EXISTS ods_ep.ep_mz_ypcfmx_edge (
  `ID` bigint NOT NULL,
  `YLJGDM` varchar(1600) NULL,
  `KH` varchar(1600) NULL,
  `KLX` varchar(1600) NULL,
  `JZLSH` varchar(1600) NULL,
  `CFZID` varchar(1600) NULL,
  `CFMXID` varchar(1600) NULL,
  `ZLXMLBBM` varchar(1600) NULL,
  `YPBM` varchar(1600) NULL,
  `YPTYM` varchar(1600) NULL,
  `YPBWM` varchar(1600) NULL,
  `YPPZWH` varchar(1600) NULL,
  `YPFLBM` varchar(1600) NULL,
  `XMFLMC` varchar(1600) NULL,
  `JXDM` varchar(1600) NULL,
  `YPGG` varchar(1600) NULL,
  `SCQY` varchar(1600) NULL,
  `YF` varchar(1600) NULL,
  `SYPC` varchar(1600) NULL,
  `SYCJL` varchar(1600) NULL,
  `SJYLDW` varchar(1600) NULL,
  `SYZL` int NULL,
  `SYZLDW` varchar(1600) NULL,
  `YPSL` int NULL,
  `YPDW` varchar(1600) NULL,
  `YYTS` int NULL,
  `ZYJZF` varchar(3200) NULL,
  `BZ` varchar(3200) NULL,
  `EP_ID` bigint NULL,
  `CODE` varchar(1600) NULL,
  `NUM` int NULL,
  `AMOUNT` bigint NULL,
  `CREATE_TIME` datetime NULL,
  `UPDATE_TIME` datetime NULL,
  `SKIN_TEST_RESULT_CODE` varchar(160) NULL,
  `SKIN_TEST_RESULT` varchar(3200) NULL
) ENGINE=OLAP
UNIQUE KEY(`ID`)
DISTRIBUTED BY HASH(`ID`) BUCKETS 10
PROPERTIES (
  "replication_num" = "1"
);

-- 质量执行器的 dbt 账号需要读取边缘表以运行 EP 规则包。
GRANT SELECT_PRIV ON DATABASE ods_ep TO USER dataos_quality_dbt;
