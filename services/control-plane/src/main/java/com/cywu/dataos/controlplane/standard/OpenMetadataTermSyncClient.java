package com.cywu.dataos.controlplane.standard;

import java.util.List;

/**
 * OpenMetadata 术语投影（G22）：发布后把标准数据元推送为 OM 词表术语。
 * 这是单向投影——失败只置 SYNC_PENDING 人工重试，OM 永不反向成为流程状态源。
 */
public interface OpenMetadataTermSyncClient {

    /**
     * 推送一个标准版本的全部元素为术语（glossary 由实现方配置）。
     * 幂等：已存在的同名术语视为成功。任何失败抛异常，由调用方落 SYNC_PENDING。
     */
    void pushTerms(String standardCode, int versionNo,
                   List<DataStandardElement> elements);
}
