package com.cywu.dataos.controlplane.mapping;

import java.util.List;

/** 修改草稿版本（仅 DRAFT）：name 改映射集元信息；items 非 null 时整体替换并重算 checksum。 */
public record UpdateMappingVersionRequest(
        String setName,
        List<CreateMappingSetRequest.ItemContract> items) {

    public boolean isEmpty() {
        return setName == null && items == null;
    }
}
