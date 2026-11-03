package com.kkomasub.geminigateway;

import android.util.Base64;

import org.json.JSONObject;

import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.PrivateKey;
import java.security.spec.PKCS8EncodedKeySpec;

import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.SecretKey;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.SecretKeySpec;

final class CryptoBox {
    private CryptoBox() {}

    static byte[] b64url(String value) {
        return Base64.decode(value, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
    }

    private static PrivateKey privateKey() throws Exception {
        if (BuildConfig.GATEWAY_PRIVATE_KEY_B64 == null || BuildConfig.GATEWAY_PRIVATE_KEY_B64.isEmpty()) {
            throw new IllegalStateException("gateway private key missing");
        }
        byte[] der = Base64.decode(BuildConfig.GATEWAY_PRIVATE_KEY_B64, Base64.DEFAULT);
        return KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(der));
    }

    static JSONObject decryptEnvelope(JSONObject envelope) throws Exception {
        byte[] encryptedKey = b64url(envelope.getString("ek"));
        Cipher rsa = Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding");
        rsa.init(Cipher.DECRYPT_MODE, privateKey());
        byte[] aesRaw = rsa.doFinal(encryptedKey);

        SecretKey aes = new SecretKeySpec(aesRaw, "AES");
        Cipher cipher = Cipher.getInstance("AES/GCM/NoPadding");
        cipher.init(Cipher.DECRYPT_MODE, aes, new GCMParameterSpec(128, b64url(envelope.getString("iv"))));
        byte[] plain = cipher.doFinal(b64url(envelope.getString("ct")));
        return new JSONObject(new String(plain, StandardCharsets.UTF_8));
    }

    static boolean verifyEnvelope(JSONObject envelope, byte[] authKey) throws Exception {
        if (!envelope.has("sig")) return false;
        String canonical = envelope.getInt("v") + "." +
                envelope.getString("ek") + "." +
                envelope.getString("iv") + "." +
                envelope.getString("ct");
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(authKey, "HmacSHA256"));
        byte[] expected = mac.doFinal(canonical.getBytes(StandardCharsets.UTF_8));
        byte[] actual = b64url(envelope.getString("sig"));
        if (expected.length != actual.length) return false;
        int diff = 0;
        for (int i = 0; i < expected.length; i++) diff |= expected[i] ^ actual[i];
        return diff == 0;
    }
}
