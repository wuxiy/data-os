package com.cywu.dataos.controlplane.dataservice;

import java.util.List;

/**
 * 数据服务定义更新请求（P8 余项）：null 字段 = 不变更。PUBLISHED 态的
 * 实际变更会自增合同版本并产出 UPDATED 事件（diff 见事件行）；
 * DRAFT 态自由修改不产生事件；DEPRECATED 态拒绝修改。
 */
public record UpdateDataServiceRequest(
        String name,
        String description,
        String sqlTemplate,
        List<CreateDataServiceRequest.ParameterContract> parameters,
        List<CreateDataServiceRequest.ColumnContract> columns,
        Integer maxRows,
        Integer timeoutSeconds) {

    public boolean isEmpty() {
        return name == null && description == null && sqlTemplate == null
                && parameters == null && columns == null
                && maxRows == null && timeoutSeconds == null;
    }
}
