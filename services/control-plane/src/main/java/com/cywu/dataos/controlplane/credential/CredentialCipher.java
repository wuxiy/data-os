package com.cywu.dataos.controlplane.credential;

import java.nio.charset.StandardCharsets;
import java.security.GeneralSecurityException;
import java.security.SecureRandom;
import java.util.Base64;

import org.springframework.stereotype.Component;

@Component
public class CredentialCipher {

    private static final String TRANSFORMATION = "AES/GCM/NoPadding";
    private static final int IV_LENGTH = 12;
    private static final int KEY_LENGTH = 32;

    private final byte[] key;
    private final SecureRandom random = new SecureRandom();

    public CredentialCipher(CredentialProperties properties) {
        this.key = parseKey(properties.getEncryptionKey());
    }

    public String encrypt(String plaintext) {
        try {
            var iv = new byte[IV_LENGTH];
            random.nextBytes(iv);
            var cipher = javax.crypto.Cipher.getInstance(TRANSFORMATION);
            cipher.init(javax.crypto.Cipher.ENCRYPT_MODE, new javax.crypto.spec.SecretKeySpec(key, "AES"),
                    new javax.crypto.spec.GCMParameterSpec(128, iv));
            var ciphertext = cipher.doFinal(plaintext.getBytes(StandardCharsets.UTF_8));
            var packed = new byte[iv.length + ciphertext.length];
            System.arraycopy(iv, 0, packed, 0, iv.length);
            System.arraycopy(ciphertext, 0, packed, iv.length, ciphertext.length);
            return Base64.getEncoder().encodeToString(packed);
        } catch (GeneralSecurityException exception) {
            throw new IllegalStateException("凭据加密失败", exception);
        }
    }

    public String decrypt(String encoded) {
        try {
            var packed = Base64.getDecoder().decode(encoded);
            if (packed.length <= IV_LENGTH) throw new IllegalArgumentException("凭据密文格式无效");
            var iv = java.util.Arrays.copyOfRange(packed, 0, IV_LENGTH);
            var ciphertext = java.util.Arrays.copyOfRange(packed, IV_LENGTH, packed.length);
            var cipher = javax.crypto.Cipher.getInstance(TRANSFORMATION);
            cipher.init(javax.crypto.Cipher.DECRYPT_MODE, new javax.crypto.spec.SecretKeySpec(key, "AES"),
                    new javax.crypto.spec.GCMParameterSpec(128, iv));
            return new String(cipher.doFinal(ciphertext), StandardCharsets.UTF_8);
        } catch (GeneralSecurityException | IllegalArgumentException exception) {
            throw new IllegalStateException("凭据解密失败", exception);
        }
    }

    private byte[] parseKey(String configured) {
        if (configured == null || configured.isBlank()) {
            // Tests and explicitly isolated local development can run without a
            // durable key; RuntimeConfigurationValidator rejects this in prod.
            return new byte[KEY_LENGTH];
        }
        try {
            var decoded = Base64.getDecoder().decode(configured.trim());
            if (decoded.length != KEY_LENGTH) throw new IllegalArgumentException("base64 key length");
            return decoded;
        } catch (IllegalArgumentException exception) {
            throw new IllegalStateException("DATAOS_CREDENTIAL_ENCRYPTION_KEY 必须是 32 字节 Base64", exception);
        }
    }
}
