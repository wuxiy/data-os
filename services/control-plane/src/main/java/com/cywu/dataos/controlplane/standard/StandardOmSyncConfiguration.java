package com.cywu.dataos.controlplane.standard;

import java.util.List;
import java.util.Map;

import com.cywu.dataos.controlplane.lineage.OpenMetadataLineageProperties;
import com.cywu.dataos.controlplane.quality.OidcClientCredentialsTokenProvider;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestClient;
import org.springframework.web.util.DefaultUriBuilderFactory;

/**
 * OM 术语投影装配（G22）：复用血缘链的 OpenMetadata 连接配置
 * （data-os.openmetadata.*）。baseUrl 未配置时 bean 不装配，发布走 SYNC_PENDING
 * （与血缘链同一条件装配纪律）。
 */
@Configuration
public class StandardOmSyncConfiguration {

    @Bean
    @ConditionalOnExpression("!'${data-os.openmetadata.base-url:}'.isBlank()")
    public OpenMetadataTermSyncClient openMetadataTermSyncClient(
            RestClient.Builder builder, OpenMetadataLineageProperties properties) {
        return new OpenMetadataTermSyncClient() {
            private final RestClient restClient = buildClient(builder, properties);
            private final OidcClientCredentialsTokenProvider tokenProvider =
                    new OidcClientCredentialsTokenProvider(
                            builder, properties.getTokenUri(), properties.getClientId(),
                            properties.getClientSecret(), "", "");

            private RestClient buildClient(RestClient.Builder clientBuilder,
                                           OpenMetadataLineageProperties props) {
                var factory = new DefaultUriBuilderFactory(props.getBaseUrl());
                factory.setEncodingMode(DefaultUriBuilderFactory.EncodingMode.NONE);
                return clientBuilder.uriBuilderFactory(factory).build();
            }

            @Override
            public void pushTerms(String standardCode, int versionNo,
                                  List<DataStandardElement> elements) {
                // OM 1.6 CreateGlossaryTerm.glossary 收词表名/fqn 字符串——
                // 对象形式 400、裸 id 404「instance not found」（dev 实测 2026-09-21）
                var glossaryName = requireGlossary();
                for (var element : elements) {
                    var termName = standardCode + "." + element.code();
                    var body = Map.of(
                            "name", termName,
                            "displayName", element.name(),
                            "description", (element.definition() == null || element.definition().isBlank()
                                    ? element.name() : element.definition()),
                            "glossary", glossaryName);
                    try {
                        restClient.post()
                                .uri("/glossaryTerms")
                                .contentType(MediaType.APPLICATION_JSON)
                                .headers(headers -> {
                                    var token = tokenProvider.current();
                                    if (!token.isBlank()) {
                                        headers.setBearerAuth(token);
                                    }
                                })
                                .body(body)
                                .retrieve()
                                .toBodilessEntity();
                    } catch (org.springframework.web.client.HttpClientErrorException.Conflict conflict) {
                        // 同名术语已存在：幂等口径，视为成功
                    } catch (RuntimeException failure) {
                        throw new IllegalStateException("OM 术语投影失败: " + termName + " — "
                                + failure.getMessage(), failure);
                    }
                }
            }

            @SuppressWarnings("unchecked")
            private String requireGlossary() {
                // 校验词表存在并返回其名（术语创建按名字引用，见 pushTerms 注释）
                try {
                    var response = restClient.get()
                            .uri("/glossaries?limit=25")
                            .accept(MediaType.APPLICATION_JSON)
                            .headers(headers -> {
                                var token = tokenProvider.current();
                                if (!token.isBlank()) {
                                    headers.setBearerAuth(token);
                                }
                            })
                            .retrieve()
                            .body(Map.class);
                    var data = response == null ? null : response.get("data");
                    if (data instanceof List<?> list) {
                        for (var item : list) {
                            if (item instanceof Map<?, ?> glossary
                                    && "数据标准".equals(glossary.get("name"))) {
                                return "数据标准";
                            }
                        }
                    }
                    throw new IllegalStateException("OM 词表「数据标准」不存在（发布前需在 OM 创建）");
                } catch (IllegalStateException failure) {
                    throw failure;
                } catch (RuntimeException failure) {
                    throw new IllegalStateException("OM 词表查询失败: " + failure.getMessage(), failure);
                }
            }
        };
    }
}
