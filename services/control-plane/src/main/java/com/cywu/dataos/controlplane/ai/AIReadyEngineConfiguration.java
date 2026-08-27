package com.cywu.dataos.controlplane.ai;

import java.util.Locale;
import java.util.Map;

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
        } catch (RuntimeException exception) {
            var cause = exception.getCause() == null ? exception : exception.getCause();
            throw new AdapterUnavailableException("AI Ready 引擎暂时不可用：" + cause.getMessage());
        }
    }

    private static String quote(String value) {
        return "\"" + value.replace("\\", "\\\\").replace("\"", "\\\"") + "\"";
    }

    /** workflowType（MEDICAL_RAG 等）-> profile id（medical-rag）。 */
    private String profileOf(AIDataProduct product) {
        var normalized = product.workflowType().trim().toLowerCase(Locale.ROOT).replace('_', '-');
        return switch (normalized) {
            case "medical-rag", "medical-training" -> normalized;
            default -> "medical-rag";
        };
    }
}
