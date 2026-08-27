package com.cywu.dataos.mpi.matcher;

/**
 * Jaro-Winkler 相似度（无外部依赖）。姓名变体通道用：中文姓名常见变体是
 * 单字差异/形近替换，JW ≥ 0.9 视为变体。语料不生成变体（EP 无变体空间），
 * 该通道由单测锁行为。
 */
public final class JaroWinkler {

    private static final double PREFIX_SCALE = 0.1;
    private static final double VARIANT_THRESHOLD = 0.9;

    private JaroWinkler() {
    }

    public static double similarity(String a, String b) {
        if (a == null || b == null) return 0.0;
        if (a.equals(b)) return 1.0;
        if (a.isEmpty() || b.isEmpty()) return 0.0;
        return winkler(jaro(a, b), a, b);
    }

    /** 姓名变体判定：非精确相等但相似度达阈值。 */
    public static boolean isVariant(String a, String b) {
        return !a.equals(b) && similarity(a, b) >= VARIANT_THRESHOLD;
    }

    private static double jaro(String a, String b) {
        int maxDistance = Math.max(a.length(), b.length()) / 2 - 1;
        if (maxDistance < 0) maxDistance = 0;
        boolean[] aMatched = new boolean[a.length()];
        boolean[] bMatched = new boolean[b.length()];
        int matches = 0;
        for (int i = 0; i < a.length(); i++) {
            int start = Math.max(0, i - maxDistance);
            int end = Math.min(i + maxDistance + 1, b.length());
            for (int j = start; j < end; j++) {
                if (bMatched[j] || a.charAt(i) != b.charAt(j)) continue;
                aMatched[i] = true;
                bMatched[j] = true;
                matches++;
                break;
            }
        }
        if (matches == 0) return 0.0;
        int transpositions = 0;
        int k = 0;
        for (int i = 0; i < a.length(); i++) {
            if (!aMatched[i]) continue;
            while (!bMatched[k]) k++;
            if (a.charAt(i) != b.charAt(k)) transpositions++;
            k++;
        }
        double m = matches;
        return (m / a.length() + m / b.length() + (m - transpositions / 2.0) / m) / 3.0;
    }

    private static double winkler(double jaro, String a, String b) {
        int prefix = 0;
        int limit = Math.min(4, Math.min(a.length(), b.length()));
        while (prefix < limit && a.charAt(prefix) == b.charAt(prefix)) prefix++;
        return jaro + prefix * PREFIX_SCALE * (1 - jaro);
    }
}
