package com.cywu.dataos.mpi.candidate;

import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;

/**
 * 候选对的确定性 id：md5(tenant|first|second) 前 8 字节的有符号 long。
 * first/second 为排序后的身份组标识（source_system|source_key），与参数
 * 顺序无关——同一对永远得到同一 id，供 match_result / review_task / 审计
 * 跨表引用。演示规模（万级身份）下碰撞概率可忽略；规模化版本换 xxhash128。
 */
public final class MpiPairId {

    private MpiPairId() {
    }

    public static long of(String tenantId, String identityA, String identityB) {
        String[] ordered = canonical(identityA, identityB);
        byte[] digest;
        try {
            digest = MessageDigest.getInstance("MD5")
                    .digest((tenantId + "|" + ordered[0] + "|" + ordered[1]).getBytes(StandardCharsets.UTF_8));
        } catch (NoSuchAlgorithmException exception) {
            throw new IllegalStateException("MD5 不可用", exception);
        }
        long value = 0L;
        for (int i = 0; i < 8; i++) {
            value = (value << 8) | (digest[i] & 0xFF);
        }
        return value;
    }

    /** 与参数顺序无关的规范序（first ≤ second，字典序）——召回去重与
     *  pair id 共用，同一对在两处的排序结果永远一致。 */
    public static String[] canonical(String identityA, String identityB) {
        return identityA.compareTo(identityB) <= 0
                ? new String[] {identityA, identityB}
                : new String[] {identityB, identityA};
    }
}
