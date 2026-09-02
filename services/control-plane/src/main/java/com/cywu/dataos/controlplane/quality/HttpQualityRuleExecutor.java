package com.cywu.dataos.controlplane.quality;

import com.cywu.dataos.controlplane.run.RunStatus;

import com.cywu.dataos.controlplane.api.ErrorMessages;

import java.time.Duration;
import java.time.Instant;
import java.time.OffsetDateTime;
import java.time.ZoneOffset;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;

import com.cywu.dataos.controlplane.executor.AdapterConfigurationException;
import com.cywu.dataos.controlplane.executor.AdapterHttp;
import com.cywu.dataos.controlplane.executor.AdapterUnavailableException;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.http.MediaType;
import org.springframework.stereotype.Component;
import org.springframework.web.client.HttpClientErrorException;
import org.springframework.web.client.RestClient;
import org.springframework.web.client.RestClientException;

/**
 * Contract adapter for a production dbt/quality-rule runner. The runner can
 * expose the same HTTP shape whether it starts dbt, Great Expectations, or a
 * hospital-owned quality service.
 */
@Component
public class HttpQualityRuleExecutor implements QualityRuleExecutor {

    private final RestClient restClient;
    private final String baseUrl;
    private final OidcClientCredentialsTokenProvider tokenProvider;

    @Autowired
    public HttpQualityRuleExecutor(RestClient.Builder builder,
                                   @Value("${data-os.quality.base-url:}") String baseUrl,
                                   @Value("${data-os.quality.oidc.token-uri:}") String tokenUri,
                                   @Value("${data-os.quality.oidc.client-id:}") String clientId,
                                   @Value("${data-os.quality.oidc.client-secret:}") String clientSecret,
                                   @Value("${data-os.quality.oidc.audience:dataos-quality-runner}") String audience,
                                   @Value("${data-os.quality.oidc.scopes:quality:submit quality:read}") String scopes) {
        this(builder, baseUrl, new OidcClientCredentialsTokenProvider(builder, tokenUri, clientId, clientSecret,
                audience, scopes));
    }

    HttpQualityRuleExecutor(RestClient.Builder builder, String baseUrl) {
        this(builder, baseUrl, new OidcClientCredentialsTokenProvider(builder, "", "", "", "", ""));
    }

    private HttpQualityRuleExecutor(RestClient.Builder builder, String baseUrl,
                                   OidcClientCredentialsTokenProvider tokenProvider) {
        this.restClient = AdapterHttp.restClient(builder, Duration.ofSeconds(3), Duration.ofSeconds(15));
        this.baseUrl = AdapterHttp.normalizeBaseUrl(baseUrl);
        this.tokenProvider = tokenProvider;
    }

    @Override
    public boolean supports(String executor) {
        return "HTTP".equalsIgnoreCase(executor) || "DBT".equalsIgnoreCase(executor);
    }

    @Override
    public boolean configured() {
        return !baseUrl.isBlank();
    }

    @Override
    public Optional<String> readinessEndpoint() {
        return baseUrl.isBlank() ? Optional.empty() : Optional.of(baseUrl + "/readyz");
    }

    @Override
    @SuppressWarnings("unchecked")
    public QualityRuleSubmission submit(QualityRuleExecutionRequest request) {
        requireConfigured();
        try {
            var response = restClient.post()
                    .uri(baseUrl + "/api/v1/quality/runs")
                    .headers(headers -> addAuthorization(headers))
                    .contentType(MediaType.APPLICATION_JSON)
                    .header("Idempotency-Key", request.executionBatchId())
                    .body(Map.of(
                            "issueId", request.issueId(),
                            "tenantId", request.tenantId(),
                            "institutionId", request.institutionId(),
                            "title", request.title(),
                            "ruleId", request.ruleId(),
                            "datasetId", request.datasetId(),
                            "executionBatchId", request.executionBatchId()))
                    .retrieve()
                    .body(Map.class);
            var externalId = AdapterHttp.first(response, "externalId", "runId", "id");
            if (externalId == null || externalId.isBlank()) {
                throw new AdapterConfigurationException("质量规则执行器未返回外部批次编号");
            }
            return new QualityRuleSubmission(externalId,
                    AdapterHttp.firstOr(response, "质量规则执行器已接受复检", "message"));
        } catch (HttpClientErrorException exception) {
            if (AdapterHttp.isTransient(exception.getStatusCode().value())) {
                throw new AdapterUnavailableException("质量规则执行器暂时不可用（HTTP "
                        + exception.getStatusCode().value() + "）");
            }
            throw new AdapterConfigurationException("质量规则执行请求不合法（HTTP "
                    + exception.getStatusCode().value() + "）");
        } catch (RestClientException exception) {
            throw new AdapterUnavailableException("质量规则执行器暂时不可用：" + ErrorMessages.safe(exception));
        }
    }

    @Override
    @SuppressWarnings("unchecked")
    public QualityRuleExecutionStatus status(String externalId) {
        requireConfigured();
        if (externalId == null || externalId.isBlank()) {
            throw new AdapterConfigurationException("缺少质量规则执行外部批次编号");
        }
        try {
            var response = restClient.get()
                    .uri(baseUrl + "/api/v1/quality/runs/{externalId}", externalId)
                    .headers(headers -> addAuthorization(headers))
                    .retrieve()
                    .body(Map.class);
            var status = RunStatus.normalize(AdapterHttp.first(response, "status", "state")).name();
            return new QualityRuleExecutionStatus(status,
                    bool(response == null ? null : response.get("passed")),
                    AdapterHttp.firstOr(response, "质量规则执行状态已同步", "message"),
                    AdapterHttp.first(response, "executionBatchId", "batchId"),
                    evidence(response == null ? null : response.get("sampleEvidence")),
                    AdapterHttp.first(response, "artifactUri", "artifactURI", "artifact_url"),
                    instant(response == null ? null : response.get("startedAt")),
                    instant(response == null ? null : response.get("finishedAt")));
        } catch (HttpClientErrorException exception) {
            if (exception.getStatusCode().value() == 404) {
                return new QualityRuleExecutionStatus("UNKNOWN", null, "质量规则执行批次暂未找到",
                        null, List.of(), null, null, null);
            }
            if (AdapterHttp.isTransient(exception.getStatusCode().value())) {
                throw new AdapterUnavailableException("质量规则执行器暂时不可用（HTTP "
                        + exception.getStatusCode().value() + "）");
            }
            throw new AdapterConfigurationException("质量规则状态查询不合法（HTTP "
                    + exception.getStatusCode().value() + "）");
        } catch (RestClientException exception) {
            throw new AdapterUnavailableException("质量规则执行器暂时不可用：" + ErrorMessages.safe(exception));
        }
    }

    private void requireConfigured() {
        if (baseUrl.isBlank()) throw new AdapterUnavailableException("质量规则执行器未配置");
    }

    private void addAuthorization(org.springframework.http.HttpHeaders headers) {
        var token = tokenProvider.current();
        if (!token.isBlank()) headers.setBearerAuth(token);
    }

    private Boolean bool(Object value) {
        if (value == null) return null;
        if (value instanceof Boolean booleanValue) return booleanValue;
        return Boolean.valueOf(String.valueOf(value));
    }

    @SuppressWarnings("unchecked")
    private List<Map<String, Object>> evidence(Object value) {
        if (!(value instanceof List<?> list)) return List.of();
        return list.stream().filter(Map.class::isInstance).map(item -> (Map<String, Object>) item).toList();
    }

    private Instant instant(Object value) {
        var parsed = AdapterHttp.parseInstant(value, ZoneOffset.UTC);
        if (parsed == null && value != null && !String.valueOf(value).isBlank()) {
            throw new AdapterConfigurationException("质量规则执行器返回的时间格式无效：" + value);
        }
        return parsed;
    }
}
