# artifact_availability remediation
经 build API 重建（双落一致性由构建链保证）；若因 RustFS 版本滞留，核对 next_version
探测与产物桶前缀后重跑构建。
