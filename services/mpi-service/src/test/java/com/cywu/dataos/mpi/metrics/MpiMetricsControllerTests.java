package com.cywu.dataos.mpi.metrics;

import java.util.Map;

import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.web.client.TestRestTemplate;
import org.springframework.test.context.ActiveProfiles;

import static org.assertj.core.api.Assertions.assertThat;

/**
 * 脚手架代理链路契约：/api/v1/mpi/metrics 必须返回五项指标键。
 * 数值占位为零，键名是对外契约（G3.5 填真后本测试不改）。
 */
// test profile：H2(PostgreSQL 模式) + DISABLED 认证（与 dev 口径一致）。
@ActiveProfiles("test")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
class MpiMetricsControllerTests {

    @Autowired
    private TestRestTemplate rest;

    @Test
    @SuppressWarnings("unchecked")
    void metricsReturnsFiveCounters() {
        var entity = rest.getForEntity("/api/v1/mpi/metrics", Map.class);
        assertThat(entity.getStatusCode().value()).isEqualTo(200);
        var body = (Map<String, Number>) (Object) entity.getBody();
        assertThat(body).isNotNull();
        assertThat(body.keySet()).containsExactly(
                "identitiesLoaded", "goldenPersons", "autoMatches",
                "reviewPending", "reviewResolved");
        assertThat(body.values()).allSatisfy(value -> assertThat(value.longValue()).isZero());
    }

    @Test
    void readinessProbeIsPublic() {
        var entity = rest.getForEntity("/actuator/health/readiness", String.class);
        assertThat(entity.getStatusCode().value()).isEqualTo(200);
        assertThat(entity.getBody()).contains("\"status\":\"UP\"");
    }
}
