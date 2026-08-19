package com.cywu.dataos.mpi;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;

// 测试环境无 Keycloak：以 DISABLED 档启动（与 dev compose 的开发口径一致）。
@SpringBootTest(properties = "data-os.auth.mode=DISABLED")
class MpiServiceApplicationTests {

    @Test
    void contextLoads() {
    }
}
