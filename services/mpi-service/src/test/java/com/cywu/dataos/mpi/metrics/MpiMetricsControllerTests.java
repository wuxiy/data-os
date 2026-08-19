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
// test profile：H2(PostgreSQL 模式) + DISABLED 认证（与 dev 口径一致）；
// 指标来自 Doris 侧统计，需要模拟表结构。
@ActiveProfiles("test")
@SpringBootTest(webEnvironment = SpringBootTest.WebEnvironment.RANDOM_PORT)
@org.springframework.test.context.jdbc.Sql("/mpi-doris-test-schema.sql")
class MpiMetricsControllerTests {

    @Autowired
    private TestRestTemplate rest;

    @Test
    @SuppressWarnings("unchecked")
    void metricsReturnsFiveCounters() {
        // G3.5 起指标来自真实统计：只锁键契约与非负性（数值与库状态耦合，不锁零）。
        var entity = rest.getForEntity("/api/v1/mpi/metrics", Map.class);
        assertThat(entity.getStatusCode().value()).isEqualTo(200);
        var body = (Map<String, Number>) (Object) entity.getBody();
        assertThat(body).isNotNull();
        assertThat(body.keySet()).containsExactly(
                "identitiesLoaded", "goldenPersons", "autoMatches",
                "reviewPending", "reviewResolved");
        assertThat(body.values()).allSatisfy(value -> assertThat(value.longValue()).isNotNegative());
    }

    @Test
    void readinessProbeIsPublic() {
        var entity = rest.getForEntity("/actuator/health/readiness", String.class);
        assertThat(entity.getStatusCode().value()).isEqualTo(200);
        assertThat(entity.getBody()).contains("\"status\":\"UP\"");
    }
}
