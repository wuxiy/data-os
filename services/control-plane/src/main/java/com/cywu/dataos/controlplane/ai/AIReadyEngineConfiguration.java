package com.cywu.dataos.controlplane.ai;

import java.util.Locale;
import java.util.Map;

import com.cywu.dataos.controlplane.executor.AdapterUnavailableException;
import com.cywu.dataos.controlplane.quality.OidcClientCredentialsTokenProvider;
import org.springframework.boot.autoconfigure.condition.ConditionalOnExpression;
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
public class AIReadyEngineConfiguration {

    @Bean
    public AIReadyEnginePort aiReadyEnginePort(AIReadyProperties properties, RestClient.Builder builder) {
        var client = builder.baseUrl(properties.getBaseUrl()).build();
        var tokenProvider = properties.getTokenUri().isBlank()
                ? null
                : new OidcClientCredentialsTokenProvider(builder, properties.getTokenUri(),
                        properties.getClientId(), properties.getClientSecret(), "", "");
        return (product, recipeRef) -> assess(client, tokenProvider, properties, product, recipeRef);
    }

    private AIReadyAssessment assess(RestClient client, OidcClientCredentialsTokenProvider tokenProvider,
                                     AIReadyProperties properties, AIDataProduct product, String recipeRef) {
        var profile = profileOf(product);
        var body = Map.of(
                "product", product.name(),
                "version", product.currentVersion(),
                "profile", profile,
                "recipeRef", recipeRef == null ? "" : recipeRef);
        try {
            var payload = client.post()
                    .uri("/assess")
                    .accept(MediaType.APPLICATION_JSON)
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

    /** workflowType（MEDICAL_RAG 等）-> profile id（medical-rag）。 */
    private String profileOf(AIDataProduct product) {
        var normalized = product.workflowType().trim().toLowerCase(Locale.ROOT).replace('_', '-');
        return switch (normalized) {
            case "medical-rag", "medical-training" -> normalized;
            default -> "medical-rag";
        };
    }
}
