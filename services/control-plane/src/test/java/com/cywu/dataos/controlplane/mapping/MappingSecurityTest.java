package com.cywu.dataos.controlplane.mapping;

import java.time.Instant;
import java.util.List;

import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.web.servlet.AutoConfigureMockMvc;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.boot.test.mock.mockito.MockBean;
import org.springframework.http.MediaType;
import org.springframework.security.oauth2.jwt.Jwt;
import org.springframework.security.oauth2.jwt.JwtDecoder;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.test.web.servlet.MockMvc;

import static org.mockito.Mockito.when;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.get;
import static org.springframework.test.web.servlet.request.MockMvcRequestBuilders.post;
import static org.springframework.test.web.servlet.result.MockMvcResultMatchers.status;

import com.cywu.dataos.controlplane.standard.StandardAdminService;

/**
 * 标准映射三级权限（G23）：读=六角色；生效/回退/停用=管理员；
 * 起草/提交/验证=工程师及以上；越租户参数 403。
 */
@SpringBootTest(properties = {
        "data-os.auth.mode=ENFORCED",
        "data-os.auth.issuer-uri=https://id.example.test/realms/data-os",
        "data-os.auth.audience=data-os",
        "data-os.runtime.environment=test"
})
@AutoConfigureMockMvc
@ActiveProfiles("test")
class MappingSecurityTest {

    @Autowired
    private MockMvc mockMvc;

    @Autowired
    private StandardAdminService standards;

    @MockBean
    private JwtDecoder jwtDecoder;

    @BeforeEach
    void stubTokenDecoder() {
        stub("engineer-token", "engineer-a", "tenant-a", List.of("data-engineer"));
        stub("admin-token", "admin-a", "tenant-a", List.of("tenant-admin"));
        stub("viewer-token", "viewer-a", "tenant-a", List.of("viewer"));
    }

    private void stub(String token, String subject, String tenant, List<String> roles) {
        var jwt = Jwt.withTokenValue(token)
                .header("alg", "none")
                .issuer("https://id.example.test/realms/data-os")
                .subject(subject)
                .audience(List.of("data-os"))
                .issuedAt(Instant.now().minusSeconds(60))
                .expiresAt(Instant.now().plusSeconds(600))
                .claim("tenant_id", tenant)
                .claim("institution_id", "hospital-" + tenant)
                .claim("roles", roles)
                .build();
        when(jwtDecoder.decode(token)).thenReturn(jwt);
    }

    private String publishedStandardId() {
        // 服务级建标准（tenant-a 身份由 TenantScope 从安全上下文解析——服务级直调
        // 在 MockMvc 上下文之外，此处借 default 租户建好后按 tenant-a 建？简化：
        // 本测试只验权限网关，不实际跑通业务流，用随机 id 断言 403/401 边界即可。
        return "00000000-0000-0000-0000-000000000000";
    }

    @Test
    void roleBoundariesOnLifecycleActions() throws Exception {
        // 读：viewer 可读
        mockMvc.perform(get("/api/v1/standard-mappings")
                        .header("Authorization", "Bearer viewer-token"))
                .andExpect(status().isOk());
        mockMvc.perform(get("/api/v1/standard-mappings/coverage")
                        .header("Authorization", "Bearer viewer-token"))
                .andExpect(status().isOk());
        // 写：viewer 403
        mockMvc.perform(post("/api/v1/standard-mappings")
                        .header("Authorization", "Bearer viewer-token")
                        .contentType(MediaType.APPLICATION_JSON)
                        .content("{\"code\":\"x\",\"name\":\"n\",\"sourceAsset\":\"a\","
                                + "\"dataset\":\"ods_ep.ep_mz_cfzb\",\"standardId\":"
                                + "\"" + publishedStandardId() + "\",\"items\":[]}"))
                .andExpect(status().isForbidden());
        // 生效/回退：工程师 403（管理员专属）
        mockMvc.perform(post("/api/v1/standard-mapping-versions/abc/activate")
                        .header("Authorization", "Bearer engineer-token"))
                .andExpect(status().isForbidden());
        mockMvc.perform(post("/api/v1/standard-mappings/abc/rollback/def")
                        .header("Authorization", "Bearer engineer-token"))
                .andExpect(status().isForbidden());
        // 管理员请求可通过权限网关（404 = 资源不存在，权限已过）
        mockMvc.perform(post("/api/v1/standard-mapping-versions/abc/activate")
                        .header("Authorization", "Bearer admin-token"))
                .andExpect(status().isNotFound());
        // 越租户参数：403
        mockMvc.perform(get("/api/v1/standard-mappings").param("tenantId", "tenant-b")
                        .header("Authorization", "Bearer engineer-token"))
                .andExpect(status().isForbidden());
    }
}
