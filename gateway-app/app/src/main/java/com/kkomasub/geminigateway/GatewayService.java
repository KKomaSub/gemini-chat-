package com.kkomasub.geminigateway;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.os.Bundle;
import android.os.IBinder;
import android.os.PersistableBundle;
import android.telephony.CarrierConfigManager;
import android.telephony.SmsManager;
import android.telephony.SubscriptionManager;
import android.util.Base64;

import com.google.android.mms.MMSPart;
import com.klinker.android.send_message.Settings;
import com.klinker.android.send_message.Transaction;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.net.URLEncoder;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;

public class GatewayService extends Service {
    private static final int NOTIFICATION_ID = 17031;
    private static final String CHANNEL_ID = "gateway_background";
    private static final String PREFS = "gateway_meta";
    private static final int DEFAULT_MMS_MAX = 1024 * 1024;
    private static final int RAM_SAFETY_MAX = 8 * 1024 * 1024;

    private volatile boolean running;
    private Thread worker;

    private String topic;
    private byte[] authKey;

    @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public void onCreate() {
        super.onCreate();
        createChannel();
        startForeground(NOTIFICATION_ID, buildNotification());
    }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        if (worker == null || !worker.isAlive()) {
            running = true;
            worker = new Thread(this::loop, "gateway-worker");
            worker.start();
        }
        return START_STICKY;
    }

    @Override
    public void onDestroy() {
        running = false;
        if (worker != null) worker.interrupt();
        super.onDestroy();
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT < 26) return;
        NotificationChannel ch = new NotificationChannel(
                CHANNEL_ID,
                "Gemini Gateway",
                NotificationManager.IMPORTANCE_MIN
        );
        ch.setDescription("백그라운드 문자 게이트웨이");
        ch.setShowBadge(false);
        NotificationManager nm = getSystemService(NotificationManager.class);
        if (nm != null) nm.createNotificationChannel(ch);
    }

    private Notification buildNotification() {
        Notification.Builder b = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL_ID)
                : new Notification.Builder(this);
        return b.setContentTitle("Gemini Gateway")
                .setContentText("게이트웨이 활성")
                .setSmallIcon(android.R.drawable.stat_notify_sync_noanim)
                .setOngoing(true)
                .setShowWhen(false)
                .build();
    }

    private void loop() {
        while (running) {
            try {
                if (topic == null || authKey == null) bootstrap();
                pollOnce();
            } catch (Throwable ignored) {
                sleep(5000);
            }
        }
    }

    private void bootstrap() throws Exception {
        HttpURLConnection c = open(BuildConfig.SERVER_BASE_URL + "/api/gateway-bootstrap");
        c.setConnectTimeout(15000);
        c.setReadTimeout(15000);
        if (c.getResponseCode() / 100 != 2) throw new IllegalStateException("bootstrap HTTP");
        String body = readAll(c.getInputStream());
        JSONObject envelope = new JSONObject(body);
        JSONObject plain = CryptoBox.decryptEnvelope(envelope);
        topic = plain.getString("topic");
        authKey = CryptoBox.b64url(plain.getString("authKey"));
        c.disconnect();
    }

    private void pollOnce() throws Exception {
        String last = getSharedPreferences(PREFS, MODE_PRIVATE).getString("last_ntfy_id", "");
        String since = last.isEmpty() ? "10m" : last;
        String url = "https://ntfy.sh/" + URLEncoder.encode(topic, "UTF-8") +
                "/json?poll=1&since=" + URLEncoder.encode(since, "UTF-8");

        HttpURLConnection c = open(url);
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        if (c.getResponseCode() / 100 != 2) throw new IllegalStateException("relay HTTP");

        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while (running && (line = reader.readLine()) != null) {
                if (line.trim().isEmpty()) continue;
                JSONObject event = new JSONObject(line);
                if (!"message".equals(event.optString("event"))) continue;
                String eventId = event.optString("id", "");
                String message = event.optString("message", "");
                if (eventId.isEmpty() || message.isEmpty()) continue;

                boolean handled = handleEnvelope(new JSONObject(message));
                if (handled) {
                    getSharedPreferences(PREFS, MODE_PRIVATE)
                            .edit()
                            .putString("last_ntfy_id", eventId)
                            .apply();
                } else {
                    break;
                }
            }
        } finally {
            c.disconnect();
        }
        sleep(2500);
    }

    private boolean handleEnvelope(JSONObject envelope) {
        try {
            if (!CryptoBox.verifyEnvelope(envelope, authKey)) return true;
            JSONObject task = CryptoBox.decryptEnvelope(envelope);

            long now = System.currentTimeMillis();
            long expiresAt = task.optLong("expiresAt", 0L);
            long createdAt = task.optLong("createdAt", 0L);
            if (expiresAt > 0L && now > expiresAt) return true;
            if (expiresAt == 0L && createdAt > 0L && now - createdAt > 10 * 60 * 1000L) return true;

            String recipient = digitsOnly(task.optString("recipient", ""));
            String text = task.optString("text", "");
            String mediaUrl = task.optString("mediaUrl", "");
            String fallback = task.optString("permalink", mediaUrl);

            if (recipient.isEmpty()) return true;

            if (mediaUrl.isEmpty()) {
                if (!text.isEmpty()) sendTextNoPersist(recipient, text);
                return true;
            }

            try {
                sendMediaNoPersist(recipient, text, mediaUrl);
            } catch (Throwable mediaError) {
                String fallbackText = text;
                if (fallback != null && !fallback.isEmpty()) {
                    fallbackText = fallbackText.isEmpty() ? fallback : fallbackText + "\n" + fallback;
                }
                if (!fallbackText.isEmpty()) sendTextNoPersist(recipient, fallbackText);
            }
            return true;
        } catch (Throwable ignored) {
            return false;
        }
    }

    public static void sendTextNoPersist(String recipient, String text) {
        SmsManager manager = SmsManager.getDefault();
        ArrayList<String> parts = manager.divideMessage(text);
        if (parts.size() <= 1) {
            manager.sendTextMessage(recipient, null, text, null, null);
        } else {
            manager.sendMultipartTextMessage(recipient, null, parts, null, null);
        }
    }

    private void sendMediaNoPersist(String recipient, String text, String mediaUrl) throws Exception {
        int carrierMax = getCarrierMmsMax();
        int downloadLimit = Math.max(64 * 1024, Math.min(carrierMax - 32 * 1024, RAM_SAFETY_MAX));
        Media media = downloadMedia(mediaUrl, downloadLimit);

        Settings settings = new Settings();
        settings.setUseSystemSending(true);
        new Transaction(this, settings);

        ArrayList<MMSPart> parts = new ArrayList<>();

        if (text != null && !text.isEmpty()) {
            MMSPart textPart = new MMSPart();
            textPart.Name = "text.txt";
            textPart.MimeType = "text/plain";
            textPart.Data = text.getBytes(StandardCharsets.UTF_8);
            parts.add(textPart);
        }

        MMSPart mediaPart = new MMSPart();
        mediaPart.Name = fileNameForMime(media.mimeType);
        mediaPart.MimeType = media.mimeType;
        mediaPart.Data = media.bytes;
        parts.add(mediaPart);

        Transaction.MessageInfo info = Transaction.getBytes(
                this,
                false,
                null,
                new String[]{ recipient },
                parts.toArray(new MMSPart[0]),
                null
        );

        if (info == null || info.bytes == null || info.bytes.length == 0) {
            throw new IllegalStateException("empty PDU");
        }
        if (info.bytes.length > carrierMax) {
            throw new IllegalStateException("carrier MMS limit exceeded");
        }

        Uri pduUri = MemoryPduProvider.register(info.bytes);
        SmsManager manager = SmsManager.getDefault();
        Bundle config = new Bundle();
        config.putInt(SmsManager.MMS_CONFIG_MAX_MESSAGE_SIZE, carrierMax);
        manager.sendMultimediaMessage(this, pduUri, null, config, null);
    }

    private int getCarrierMmsMax() {
        try {
            int subId = SubscriptionManager.getDefaultSmsSubscriptionId();
            CarrierConfigManager ccm = (CarrierConfigManager) getSystemService(Context.CARRIER_CONFIG_SERVICE);
            PersistableBundle config = ccm == null ? null : ccm.getConfigForSubId(subId);
            if (config != null) {
                int value = config.getInt(CarrierConfigManager.KEY_MMS_MAX_MESSAGE_SIZE_INT, DEFAULT_MMS_MAX);
                if (value > 0) return Math.min(value, RAM_SAFETY_MAX);
            }
        } catch (Throwable ignored) {
        }
        return DEFAULT_MMS_MAX;
    }

    private Media downloadMedia(String target, int maxBytes) throws Exception {
        HttpURLConnection c = open(target);
        c.setInstanceFollowRedirects(true);
        c.setConnectTimeout(15000);
        c.setReadTimeout(30000);
        c.setRequestProperty("User-Agent", "GeminiGateway/1.0");
        c.setRequestProperty("Accept", "image/*,video/*,audio/*;q=0.9,*/*;q=0.3");

        if (c.getResponseCode() / 100 != 2) throw new IllegalStateException("media HTTP");
        int declared = c.getContentLength();
        if (declared > maxBytes) throw new IllegalStateException("media too large");

        String mime = c.getContentType();
        if (mime == null) mime = "application/octet-stream";
        int semi = mime.indexOf(';');
        if (semi >= 0) mime = mime.substring(0, semi);
        mime = mime.trim().toLowerCase();

        if (!(mime.startsWith("image/") || mime.startsWith("video/") || mime.startsWith("audio/"))) {
            throw new IllegalStateException("unsupported media type");
        }

        ByteArrayOutputStream out = new ByteArrayOutputStream(Math.max(8192, Math.min(maxBytes, declared > 0 ? declared : 65536)));
        try (InputStream in = c.getInputStream()) {
            byte[] buffer = new byte[16384];
            int n;
            while ((n = in.read(buffer)) >= 0) {
                if (out.size() + n > maxBytes) throw new IllegalStateException("media too large");
                out.write(buffer, 0, n);
            }
        } finally {
            c.disconnect();
        }

        return new Media(mime, out.toByteArray());
    }

    private static String fileNameForMime(String mime) {
        if (mime == null) return "media.bin";
        if (mime.equals("image/jpeg")) return "image.jpg";
        if (mime.equals("image/png")) return "image.png";
        if (mime.equals("image/webp")) return "image.webp";
        if (mime.equals("video/mp4")) return "video.mp4";
        if (mime.equals("video/3gpp")) return "video.3gp";
        if (mime.startsWith("audio/")) return "audio.bin";
        return mime.startsWith("video/") ? "video.bin" : "media.bin";
    }

    private static String digitsOnly(String value) {
        return value == null ? "" : value.replaceAll("\\D+", "");
    }

    private static HttpURLConnection open(String url) throws Exception {
        return (HttpURLConnection) new URL(url).openConnection();
    }

    private static String readAll(InputStream in) throws Exception {
        try (InputStream input = in; ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buffer = new byte[8192];
            int n;
            while ((n = input.read(buffer)) >= 0) out.write(buffer, 0, n);
            return out.toString("UTF-8");
        }
    }

    private static void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException ignored) { Thread.currentThread().interrupt(); }
    }

    private static final class Media {
        final String mimeType;
        final byte[] bytes;
        Media(String mimeType, byte[] bytes) {
            this.mimeType = mimeType;
            this.bytes = bytes;
        }
    }
}
