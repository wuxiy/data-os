package com.cywu.dataos.mpi;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;

/**
 * 患者主索引（MPI）服务。独立于 control-plane 运行：对外仅暴露
 * {@code /api/v1/mpi/**} 与 actuator，存储由本服务独占（方案见
 * docs/mpi-g3-review-and-plan-20260819.md）。
 */
@SpringBootApplication
public class MpiServiceApplication {

    public static void main(String[] args) {
        SpringApplication.run(MpiServiceApplication.class, args);
    }
}
