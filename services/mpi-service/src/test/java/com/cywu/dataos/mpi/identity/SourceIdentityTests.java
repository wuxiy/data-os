package com.cywu.dataos.mpi.identity;

import org.junit.jupiter.api.Test;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

/** 源身份键格式的唯一属主：往返、非法输入与 SQL 投影两侧同源。 */
class SourceIdentityTests {

    @Test
    void roundTripsThroughIdentityGroup() {
        var identity = new SourceIdentity("H0001", "EP", "1");
        assertThat(identity.identityGroup()).isEqualTo("H0001|EP|1");
        var parsed = SourceIdentity.parse("H0001|EP|1");
        assertThat(parsed.institutionCode()).isEqualTo("H0001");
        assertThat(parsed.sourceSystem()).isEqualTo("EP");
        assertThat(parsed.sourceKey()).isEqualTo("1");
    }

    @Test
    void parseRejectsMalformedGroupsLoudly() {
        assertThatThrownBy(() -> SourceIdentity.parse("H0001|EP"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("非法源身份标识");
        assertThatThrownBy(() -> SourceIdentity.parse(null))
                .isInstanceOf(IllegalArgumentException.class);
        // 分隔符进各段会在 SQL 投影与 Java 解析间产生歧义：构造期即拒绝。
        assertThatThrownBy(() -> new SourceIdentity("H0|001", "EP", "1"))
                .isInstanceOf(IllegalArgumentException.class)
                .hasMessageContaining("分隔符");
    }

    @Test
    void sqlProjectionMatchesJavaFormatWithAndWithoutAlias() {
        assertThat(SourceIdentity.sqlProjection(null))
                .isEqualTo("CONCAT(institution_code, '|', source_system, '|', source_key)");
        assertThat(SourceIdentity.sqlProjection("a"))
                .isEqualTo("CONCAT(a.institution_code, '|', a.source_system, '|', a.source_key)");
        // 投影产物与 identityGroup() 同格式：两侧任一漂移都会在此处爆。
        var identity = new SourceIdentity("H0001", "EP", "1");
        assertThat(identity.identityGroup()).doesNotContain(",");
        assertThat(SourceIdentity.sqlProjection("b")).contains("b.source_key");
    }
}
