package com.cywu.dataos.controlplane;

import org.springframework.boot.SpringApplication;
import org.springframework.boot.autoconfigure.SpringBootApplication;
import org.springframework.scheduling.annotation.EnableScheduling;

@SpringBootApplication
@EnableScheduling
public class DataOsApplication {

    public static void main(String[] args) {
        SpringApplication.run(DataOsApplication.class, args);
    }
}
