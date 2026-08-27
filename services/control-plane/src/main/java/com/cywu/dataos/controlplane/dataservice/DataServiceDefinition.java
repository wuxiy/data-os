package com.cywu.dataos.controlplane.dataservice;

import java.time.Instant;

/**
 * 数据服务定义（{@code data_os.data_service} 表）。SQL 模板为参数化
 * SELECT（{@code :param} 占位），发布前经 {@link SqlTemplateValidator}
 * 静态校验；参数契约与列契约以 JSON 承载，形态见 {@code CreateDataServiceRequest}。
 */
public record DataServiceDefinition(
        String id,
        String tenantId,
        String code,
        String name,
        String description,
        String versionSn,
        DataApiLifecycle status,
        String sqlTemplate,
        String parametersJson,
        String columnsJson,
        int maxRows,
        int timeoutSeconds,
        String owner,
        Instant createdAt,
        Instant updatedAt) {
}
