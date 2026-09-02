package com.cywu.dataos.controlplane.ai;

import java.util.Locale;
import java.util.Map;

import com.cywu.dataos.controlplane.api.ErrorMessages;
import com.cywu.dataos.controlplane.api.InvalidRequestException;
import com.cywu.dataos.controlplane.executor.AdapterUnavailableException;
import com.cywu.dataos.controlplane.quality.OidcClientCredentialsTokenProvider;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
import org.springframework.boot.context.properties.EnableConfigurationProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;
import org.springframework.http.MediaType;
import org.springframework.web.client.RestClient;

/**
 * AI Ready 引擎装配：base-url 显式配置时注册 HttpAIReadyEngineAdapter，
 * G8 的 build 503 守护随之解除（引擎未装配仍走守护）。
 */
@Configuration
@ConditionalOnExpression("!'${data-os.ai-ready.base-url:}'.isBlank()")
@EnableConfigurationProperties(AIReadyProperties.class)
public class AIReadyEngineConfiguration {

    @Bean
    public AIReadyEnginePort aiReadyEnginePort(AIReadyProperties properties, RestClient.Builder builder) {
        // 强制 HTTP/1.1：默认 JDK HttpClient 会发 h2c Upgrade，uvicorn 拒绝升级后
        // POST body 被丢弃（实测 422 body missing + "Unsupported upgrade request"）。
        var factory = new org.springframework.http.client.SimpleClientHttpRequestFactory();
        var client = builder.requestFactory(factory).baseUrl(properties.getBaseUrl()).build();
        var tokenProvider = properties.getTokenUri().isBlank()
                ? null
                : new OidcClientCredentialsTokenProvider(builder, properties.getTokenUri(),
                        properties.getClientId(), properties.getClientSecret(), "", "");
        return new AIReadyEnginePort() {
            @Override
            public AIReadyAssessment build(AIDataProduct product, String recipeRef) {
                return assess(client, tokenProvider, properties, product, recipeRef);
            }

            @Override
            public java.util.Map<String, Object> evaluate(AIDataProduct product) {
                return AIReadyEngineConfiguration.evaluate(client, tokenProvider, properties, product);
            }
        };
    }

    @SuppressWarnings("unchecked")
    private static java.util.Map<String, Object> evaluate(RestClient client,
            OidcClientCredentialsTokenProvider tokenProvider, AIReadyProperties properties,
            AIDataProduct product) {
        var body = String.format("{\"product\":%s,\"version\":%s}",
                quote(product.name()), quote(product.currentVersion()));
        try {
            var payload = client.post()
                    .uri("/evaluate")
                    .accept(MediaType.APPLICATION_JSON)
                    .contentType(MediaType.APPLICATION_JSON)
                    .headers(headers -> {
                        if (tokenProvider != null) {
                            var token = tokenProvider.current();
                            if (!token.isBlank()) headers.setBearerAuth(token);
                        } else if (!properties.getApiToken().isBlank()) {
                            headers.setBearerAuth(properties.getApiToken());
                        }
                    })
                    .body(body)
                    .retrieve()
                    .body(Map.class);
            if (payload == null) {
                throw new AdapterUnavailableException("AI Ready 引擎返回空评测报告");
            }
            return payload;
        } catch (AdapterUnavailableException exception) {
            throw exception;
        } catch (org.springframework.web.client.HttpClientErrorException exception) {
            // 引擎侧 422（未知 profile 等声明校验拒绝）是请求错误，不是引擎不可用。
            throw new InvalidRequestException("AI Ready 引擎拒绝请求（HTTP "
                    + exception.getStatusCode().value() + "）：" + engineDetail(exception));
        } catch (RuntimeException exception) {
            var cause = exception.getCause() == null ? exception : exception.getCause();
            throw new AdapterUnavailableException("AI Ready 引擎暂时不可用：" + cause.getMessage());
        }
    }

    private AIReadyAssessment assess(RestClient client, OidcClientCredentialsTokenProvider tokenProvider,
                                     AIReadyProperties properties, AIDataProduct product, String recipeRef) {
        var profile = profileOf(product);
        // 显式 JSON 字符串：实测部分服务端（uvicorn）对 Map 编码的分块体判为缺 body。
        var body = String.format(
                "{\"product\":%s,\"version\":%s,\"profile\":%s,\"recipeRef\":%s}",
                quote(product.name()), quote(product.currentVersion()),
                quote(profile), quote(recipeRef == null ? "" : recipeRef));
        try {
            var payload = client.post()
                    .uri("/assess")
                    .accept(MediaType.APPLICATION_JSON)
                    .contentType(MediaType.APPLICATION_JSON)
                    .headers(headers -> {
                        if (tokenProvider != null) {
                            var token = tokenProvider.current();
                            if (!token.isBlank()) headers.setBearerAuth(token);
                        } else if (!properties.getApiToken().isBlank()) {
                            headers.setBearerAuth(properties.getApiToken());
                        }
                    })
                    .body(body)
                    .retrieve()
                    .body(Map.class);
            if (payload == null) {
                throw new AdapterUnavailableException("AI Ready 引擎返回空报告");
            }
            return AIReadyAssessment.from(payload);
        } catch (AdapterUnavailableException exception) {
            throw exception;
        } catch (org.springframework.web.client.HttpClientErrorException exception) {
            throw new InvalidRequestException("AI Ready 引擎拒绝请求（HTTP "
                    + exception.getStatusCode().value() + "）：" + engineDetail(exception));
        } catch (RuntimeException exception) {
            var cause = exception.getCause() == null ? exception : exception.getCause();
            throw new AdapterUnavailableException("AI Ready 引擎暂时不可用：" + cause.getMessage());
        }
    }

    /** 引擎 422 的 FastAPI 错误体形如 {"detail":"..."}——提取 detail，缺省给原文。 */
    private static String engineDetail(org.springframework.web.client.HttpClientErrorException exception) {
        try {
            var node = new com.fasterxml.jackson.databind.ObjectMapper()
                    .readTree(exception.getResponseBodyAsString());
            var detail = node.path("detail").asText("");
            return detail.isBlank() ? ErrorMessages.safe(exception) : detail;
        } catch (Exception ignored) {
            return ErrorMessages.safe(exception);
        }
    }

    private static String quote(String value) {
        return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    /**
     * workflowType（MEDICAL_RAG 等）→ profile id（medical-rag）的拼写归一
     * （trim/小写/下划线转连字符）。profile 词汇表的唯一源是引擎声明仓库的
     * profiles/ 目录——这里不做已知值枚举，未知 workflow 由引擎显式拒绝
     * （422），不再静默按默认 profile 评分。
     */
    private String profileOf(AIDataProduct product) {
        return product.workflowType().trim().toLowerCase(Locale.ROOT).replace('_', '-');
    }
}
