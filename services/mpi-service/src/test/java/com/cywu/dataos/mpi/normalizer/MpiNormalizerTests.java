package com.cywu.dataos.mpi.normalizer;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;

class MpiNormalizerTests {

    @Test
    void nameCollapsesWhitespaceAndFullWidth() {
        assertThat(MpiNormalizer.normalizeName("  张 三 ")).isEqualTo("张三");
        assertThat(MpiNormalizer.normalizeName("Ａｌｉｃｅ")).isEqualTo("Alice");
        assertThat(MpiNormalizer.normalizeName(null)).isEmpty();
        assertThat(MpiNormalizer.normalizeName("  ")).isEmpty();
    }

    @Test
    void genderNormalizesChineseAndCodes() {
        assertThat(MpiNormalizer.normalizeGender("男")).isEqualTo("M");
        assertThat(MpiNormalizer.normalizeGender("1")).isEqualTo("M");
        assertThat(MpiNormalizer.normalizeGender("M")).isEqualTo("M");
        assertThat(MpiNormalizer.normalizeGender("女")).isEqualTo("F");
        assertThat(MpiNormalizer.normalizeGender("2")).isEqualTo("F");
        assertThat(MpiNormalizer.normalizeGender(null)).isEqualTo("U");
        assertThat(MpiNormalizer.normalizeGender("未知")).isEqualTo("U");
    }

    @Test
    void cardNoNormalizesFullWidthCaseAndWhitespace() {
        assertThat(MpiNormalizer.normalizeCardNo(" ４４１３ＡＢ ")).isEqualTo("4413AB");
        assertThat(MpiNormalizer.normalizeCardNo("ab12")).isEqualTo("AB12");
        assertThat(MpiNormalizer.normalizeCardNo("  ")).isNull();
        assertThat(MpiNormalizer.normalizeCardNo(null)).isNull();
    }

    @Test
    void saltedHashRequiresSaltAndInput() {
        var hashed = MpiNormalizer.saltedHash("13800000000", "salt-x");
        assertThat(hashed).hasSize(64).matches("[0-9a-f]+");
        // 相同输入确定性、不同盐不同结果、无盐宁缺毋滥。
        assertThat(MpiNormalizer.saltedHash("13800000000", "salt-x")).isEqualTo(hashed);
        assertThat(MpiNormalizer.saltedHash("13800000000", "salt-y")).isNotEqualTo(hashed);
        assertThat(MpiNormalizer.saltedHash("13800000000", " ")).isNull();
        assertThat(MpiNormalizer.saltedHash(null, "salt-x")).isNull();
    }
}
