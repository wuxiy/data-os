package com.cywu.dataos.mpi.normalizer;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.text.Normalizer;
import java.util.HexFormat;
import java.util.Locale;

/**
 * 源身份属性标准化（纯函数）。规则版本 v1：
 * 姓名 NFKC（全角→半角）+去空白；性别中文/代码归一 M/F/U；
 * 卡号 NFKC+大写+去空白。简繁转换留待 V2（占位），年龄仅展示不进规则。
 */
public final class MpiNormalizer {

    public static final String GENDER_UNKNOWN = "U";

    private MpiNormalizer() {
    }

    /** 姓名归一：全角→半角、去全部空白（中文姓名无空格语义）。 */
    public static String normalizeName(String raw) {
        if (raw == null || raw.isBlank()) return "";
        return Normalizer.normalize(raw.trim(), Normalizer.Form.NFKC).replaceAll("\\s+", "");
    }

    /** 性别归一：男/M/1→M，女/F/2→F，其余（含缺失）→U。 */
    public static String normalizeGender(String raw) {
        if (raw == null) return GENDER_UNKNOWN;
        return switch (raw.trim()) {
            case "男", "M", "m", "1" -> "M";
            case "女", "F", "f", "2" -> "F";
            default -> GENDER_UNKNOWN;
        };
    }

    /** 卡号归一：全角→半角、去空白、大写；空值返回 null（缺失而非空串）。 */
    public static String normalizeCardNo(String raw) {
        if (raw == null || raw.isBlank()) return null;
        var normalized = Normalizer.normalize(raw.trim(), Normalizer.Form.NFKC)
                .replaceAll("\\s+", "")
                .toUpperCase(Locale.ROOT);
        return normalized.isEmpty() ? null : normalized;
    }

    /**
     * 敏感字段加盐哈希（联系方式/证件）。盐值未配置时返回 null——宁可空置
     * 也不落无盐哈希（无盐哈希可被彩虹表还原，等于泄露）。
     */
    public static String saltedHash(String raw, String salt) {
        if (raw == null || raw.isBlank() || salt == null || salt.isBlank()) return null;
        try {
            var digest = MessageDigest.getInstance("SHA-256")
                    .digest((salt + ":" + raw.trim()).getBytes(StandardCharsets.UTF_8));
            return HexFormat.of().formatHex(digest);
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("SHA-256 不可用", exception);
        }
    }
}
