package com.cywu.dataos.controlplane.standard;

import java.util.List;

/**
 * 修改草稿版本（PUT /data-standard-versions/{id}，仅 DRAFT）：
 * null 字段 = 不变更；elements 非 null 时整体替换该版本的元素集。
 */
public record UpdateStandardVersionRequest(
        String standardName,
        String description,
        String owner,
        List<CreateStandardRequest.ElementContract> elements) {

    public boolean isEmpty() {
        return standardName == null && description == null && owner == null && elements == null;
    }
}
