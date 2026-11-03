package com.kkomasub.privategateway;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.os.Handler;
import android.os.IBinder;
import android.os.Looper;

import org.json.JSONObject;

import java.io.BufferedReader;
import java.io.InputStreamReader;
import java.net.HttpURLConnection;
import java.net.URL;
import java.nio.charset.StandardCharsets;
import java.util.LinkedHashSet;
import java.util.Set;

public class GatewayService extends Service {
    private static final String CHANNEL = "gateway";
    private static final String BOOTSTRAP =
            "https://gemini-chat-no-wifi.pages.dev/api/gateway-bootstrap";

    private final Set<String> seen = new LinkedHashSet<>();
    private volatile boolean running;
    private Thread worker;

    static void start(Context context) {
        Intent intent = new Intent(context, GatewayService.class);
        if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(intent);
        else context.startService(intent);
    }

    @Override public void onCreate() {
        super.onCreate();
        createChannel();
        startForeground(1001, notification());
        running = true;
        worker = new Thread(this::runLoop, "private-gateway");
        worker.start();
    }

    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        return START_STICKY;
    }

    @Override public void onDestroy() {
        running = false;
        if (worker != null) worker.interrupt();
        super.onDestroy();
    }

    @Override public IBinder onBind(Intent intent) { return null; }

    private void runLoop() {
        while (running) {
            try {
                GatewayCrypto crypto = new GatewayCrypto(this);
                JSONObject bootstrap = getJson(BOOTSTRAP);
                JSONObject config = crypto.decrypt(bootstrap);
                String topic = config.getString("topic");
                byte[] authKey = GatewayCrypto.decodeUrl(config.getString("authKey"));
                stream(topic, authKey, crypto);
            } catch (Throwable ignored) {
                sleep(3000);
            }
        }
    }

    private void stream(String topic, byte[] authKey, GatewayCrypto crypto) throws Exception {
        HttpURLConnection c = (HttpURLConnection)
                new URL("https://ntfy.sh/" + topic + "/json?since=30s").openConnection();
        c.setConnectTimeout(12000);
        c.setReadTimeout(0);
        c.setRequestProperty("Accept", "application/x-ndjson");
        c.setRequestProperty("User-Agent", "PrivateMmsGateway/1.1");

        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8))) {
            String line;
            while (running && (line = reader.readLine()) != null) {
                if (line.isEmpty()) continue;
                try {
                    JSONObject event = new JSONObject(line);
                    if (!"message".equals(event.optString("event"))) continue;
                    String message = event.optString("message", "");
                    if (message.isEmpty()) continue;

                    JSONObject envelope = new JSONObject(message);
                    if (!crypto.verify(envelope, authKey)) continue;
                    JSONObject task = crypto.decrypt(envelope);
                    handleTask(task);
                } catch (Throwable ignored) {}
            }
        } finally {
            c.disconnect();
        }
    }

    private void handleTask(JSONObject task) {
        String id = task.optString("id", "");
        if (id.isEmpty() || seen.contains(id)) return;

        long createdAt = task.optLong("createdAt", 0L);
        if (createdAt <= 0L || Math.abs(System.currentTimeMillis() - createdAt) > 10 * 60_000L) {
            return;
        }

        seen.add(id);
        while (seen.size() > 100) {
            String first = seen.iterator().next();
            seen.remove(first);
        }

        String recipient = task.optString("recipient", "").replaceAll("[^0-9]", "");
        String text = task.optString("text", "");
        String mediaUrl = task.optString("mediaUrl", "");
        String permalink = task.optString("permalink", mediaUrl);
        if (recipient.isEmpty() || mediaUrl.isEmpty()) return;

        try {
            int carrierLimit = MmsSender.maxMediaBytes(this);
            MediaMemory.Item item = MediaMemory.downloadAndPrepare(mediaUrl, carrierLimit);
            new Handler(Looper.getMainLooper()).post(() -> {
                try {
                    MmsSender.sendMms(this, recipient, text, item.data, item.mime, item.name, permalink);
                } catch (Throwable e) {
                    sendFallback(recipient, text, permalink);
                }
            });
        } catch (Throwable ignored) {
            sendFallback(recipient, text, permalink);
        }
    }

    private void sendFallback(String recipient, String text, String url) {
        try {
            String body = (text == null || text.isEmpty() ? "" : text + "\n") + url;
            MmsSender.sendSms(this, recipient, body);
        } catch (Throwable ignored) {}
    }

    private JSONObject getJson(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(12000);
        c.setReadTimeout(15000);
        c.setRequestProperty("Accept", "application/json");
        try (BufferedReader reader = new BufferedReader(
                new InputStreamReader(c.getInputStream(), StandardCharsets.UTF_8))) {
            StringBuilder out = new StringBuilder();
            String line;
            while ((line = reader.readLine()) != null) out.append(line);
            return new JSONObject(out.toString());
        } finally {
            c.disconnect();
        }
    }

    private void createChannel() {
        if (Build.VERSION.SDK_INT >= 26) {
            NotificationChannel channel = new NotificationChannel(
                    CHANNEL, "Gateway", NotificationManager.IMPORTANCE_MIN);
            channel.setDescription("Private MMS gateway service");
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
    }

    private Notification notification() {
        Notification.Builder builder = Build.VERSION.SDK_INT >= 26
                ? new Notification.Builder(this, CHANNEL)
                : new Notification.Builder(this);
        return builder
                .setSmallIcon(android.R.drawable.stat_notify_chat)
                .setContentTitle("Private MMS Gateway")
                .setContentText("게이트웨이 활성")
                .setOngoing(true)
                .build();
    }

    private static void sleep(long ms) {
        try { Thread.sleep(ms); } catch (InterruptedException ignored) {}
    }
}
