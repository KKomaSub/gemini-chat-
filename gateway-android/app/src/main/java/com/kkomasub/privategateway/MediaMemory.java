package com.kkomasub.privategateway;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

final class MediaMemory {
    static final int MAX_DOWNLOAD = 8 * 1024 * 1024;
    static final int MMS_TARGET = 900 * 1024;

    static final class Item {
        final byte[] data;
        final String mime;
        final String name;
        Item(byte[] data, String mime, String name) {
            this.data = data; this.mime = mime; this.name = name;
        }
    }

    static Item downloadAndPrepare(String url) throws Exception {
        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(12000);
        c.setReadTimeout(25000);
        c.setInstanceFollowRedirects(true);
        c.setRequestProperty("User-Agent", "PrivateMmsGateway/1.0");
        c.connect();
        if (c.getResponseCode() < 200 || c.getResponseCode() >= 300) {
            throw new IllegalStateException("media HTTP " + c.getResponseCode());
        }

        String mime = String.valueOf(c.getContentType()).split(";")[0].trim().toLowerCase();
        int declared = c.getContentLength();
        if (declared > MAX_DOWNLOAD) throw new IllegalStateException("media too large");

        byte[] raw;
        try (InputStream in = c.getInputStream(); ByteArrayOutputStream out = new ByteArrayOutputStream()) {
            byte[] buf = new byte[16 * 1024];
            int total = 0;
            for (int n; (n = in.read(buf)) >= 0;) {
                total += n;
                if (total > MAX_DOWNLOAD) throw new IllegalStateException("media too large");
                out.write(buf, 0, n);
            }
            raw = out.toByteArray();
        } finally {
            c.disconnect();
        }

        if (mime.startsWith("image/")) {
            byte[] image = compressImage(raw);
            return new Item(image, "image/jpeg", "reddit.jpg");
        }
        if (mime.startsWith("video/") || mime.startsWith("audio/")) {
            if (raw.length > MMS_TARGET) throw new IllegalStateException("video/audio over carrier MMS target");
            String ext = mime.startsWith("video/") ? ".mp4" : ".m4a";
            return new Item(raw, mime, "reddit" + ext);
        }
        throw new IllegalStateException("unsupported media type " + mime);
    }

    private static byte[] compressImage(byte[] raw) throws Exception {
        Bitmap bitmap = BitmapFactory.decodeByteArray(raw, 0, raw.length);
        if (bitmap == null) throw new IllegalStateException("invalid image");

        int w = bitmap.getWidth();
        int h = bitmap.getHeight();
        float scale = Math.min(1f, Math.min(1280f / Math.max(1, w), 1280f / Math.max(1, h)));
        Bitmap scaled = bitmap;
        if (scale < 1f) {
            scaled = Bitmap.createScaledBitmap(bitmap, Math.max(1, Math.round(w * scale)),
                    Math.max(1, Math.round(h * scale)), true);
            if (scaled != bitmap) bitmap.recycle();
        }

        int[] qualities = new int[]{90, 82, 74, 66, 58, 50};
        byte[] best = null;
        for (int q : qualities) {
            try (ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                scaled.compress(Bitmap.CompressFormat.JPEG, q, out);
                best = out.toByteArray();
            }
            if (best.length <= MMS_TARGET) break;
        }
        scaled.recycle();
        if (best == null || best.length > MMS_TARGET) throw new IllegalStateException("image cannot fit MMS target");
        return best;
    }
}
