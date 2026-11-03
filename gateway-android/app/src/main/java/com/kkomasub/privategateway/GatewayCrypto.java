package com.kkomasub.privategateway;

import android.content.Context;
import android.util.Base64;
import org.json.JSONObject;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.nio.charset.StandardCharsets;
import java.security.KeyFactory;
import java.security.MessageDigest;
import java.security.PrivateKey;
import java.security.spec.MGF1ParameterSpec;
import java.security.spec.PKCS8EncodedKeySpec;
import javax.crypto.Cipher;
import javax.crypto.Mac;
import javax.crypto.spec.GCMParameterSpec;
import javax.crypto.spec.OAEPParameterSpec;
import javax.crypto.spec.PSource;
import javax.crypto.spec.SecretKeySpec;

final class GatewayCrypto {
    private final PrivateKey privateKey;

    GatewayCrypto(Context context) throws Exception {
        String key = readAsset(context, "gateway_private_key.b64").trim();
        byte[] der = Base64.decode(key, Base64.DEFAULT);
        privateKey = KeyFactory.getInstance("RSA").generatePrivate(new PKCS8EncodedKeySpec(der));
    }

    JSONObject decrypt(JSONObject envelope) throws Exception {
        Cipher rsa = Cipher.getInstance("RSA/ECB/OAEPWithSHA-256AndMGF1Padding");
        rsa.init(Cipher.DECRYPT_MODE, privateKey, new OAEPParameterSpec(
                "SHA-256", "MGF1", MGF1ParameterSpec.SHA256,
                PSource.PSpecified.DEFAULT));
        byte[] aesRaw = rsa.doFinal(decodeUrl(envelope.getString("ek")));

        Cipher aes = Cipher.getInstance("AES/GCM/NoPadding");
        aes.init(Cipher.DECRYPT_MODE, new SecretKeySpec(aesRaw, "AES"),
                new GCMParameterSpec(128, decodeUrl(envelope.getString("iv"))));
        byte[] plain = aes.doFinal(decodeUrl(envelope.getString("ct")));
        return new JSONObject(new String(plain, StandardCharsets.UTF_8));
    }

    boolean verify(JSONObject envelope, byte[] authKey) throws Exception {
        String sig = envelope.optString("sig", "");
        if (sig.isEmpty()) return false;
        String canonical = envelope.getInt("v") + "." +
                envelope.getString("ek") + "." +
                envelope.getString("iv") + "." +
                envelope.getString("ct");
        Mac mac = Mac.getInstance("HmacSHA256");
        mac.init(new SecretKeySpec(authKey, "HmacSHA256"));
        return MessageDigest.isEqual(mac.doFinal(canonical.getBytes(StandardCharsets.UTF_8)), decodeUrl(sig));
    }

    static byte[] decodeUrl(String value) {
        return Base64.decode(value, Base64.URL_SAFE | Base64.NO_WRAP | Base64.NO_PADDING);
    }

    private static String readAsset(Context context, String name) throws Exception {
        try (InputStream in = context.getAssets().open(name);
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[4096];
            for (int n; (n = in.read(buf)) >= 0;) out.write(buf, 0, n);
            return out.toString("UTF-8");
        }
    }
}
