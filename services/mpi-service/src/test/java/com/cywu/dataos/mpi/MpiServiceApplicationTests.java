package com.cywu.dataos.mpi;

import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.SpringBootTest;
import org.springframework.test.context.ActiveProfiles;

// test profile：H2(PostgreSQL 模式) + Flyway 迁移 + DISABLED 认证（与 dev 口径一致）。
@ActiveProfiles("test")
@SpringBootTest
class MpiServiceApplicationTests {

    @Test
    void contextLoads() {
    }
}
