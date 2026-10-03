-- G2G 批次 1 · 采集操作深水区（第一刀）：数据源登记持久化的非敏感连接配置
-- （jdbcUrl / username / credentialRef 等）。明文密码、secret、token 在服务端
-- 保存前剥离，绝不落库；目录浏览与受控查询端点以此配置建立只读工作连接。
ALTER TABLE data_os.sources ADD COLUMN IF NOT EXISTS connection_json TEXT NULL;
