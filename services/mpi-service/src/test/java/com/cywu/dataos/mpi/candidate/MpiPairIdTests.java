package com.cywu.dataos.mpi.candidate;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class MpiPairIdTests {

    @Test
    void pairIdIsDeterministicAndOrderIndependent() {
        long ab = MpiPairId.of("default", "EP|1", "EP|2");
        long ba = MpiPairId.of("default", "EP|2", "EP|1");
        assertThat(ab).isEqualTo(ba);
        assertThat(MpiPairId.of("default", "EP|1", "EP|2")).isEqualTo(ab);
    }

    @Test
    void differentPairsOrTenantsGetDifferentIds() {
        assertThat(MpiPairId.of("default", "EP|1", "EP|2"))
                .isNotEqualTo(MpiPairId.of("default", "EP|1", "EP|3"));
        assertThat(MpiPairId.of("default", "EP|1", "EP|2"))
                .isNotEqualTo(MpiPairId.of("other", "EP|1", "EP|2"));
    }
}
