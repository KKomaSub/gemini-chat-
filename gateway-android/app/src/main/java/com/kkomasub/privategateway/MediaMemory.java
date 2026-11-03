package com.kkomasub.privategateway;

import android.graphics.Bitmap;
import android.graphics.BitmapFactory;

import java.io.ByteArrayOutputStream;
import java.io.InputStream;
import java.net.HttpURLConnection;
import java.net.URL;

final class MediaMemory {
    static final int MAX_DOWNLOAD = 16 * 1024 * 1024;

    static final class Item {
        final byte[] data;
        final String mime;
        final String name;
        Item(byte[] data, String mime, String name) {
            this.data = data;
            this.mime = mime;
            this.name = name;
        }
    }

    static Item downloadAndPrepare(String url, int targetBytes) throws Exception {
        targetBytes = Math.max(200 * 1024, Math.min(targetBytes, 8 * 1024 * 1024));

        HttpURLConnection c = (HttpURLConnection) new URL(url).openConnection();
        c.setConnectTimeout(12000);
        c.setReadTimeout(30000);
        c.setInstanceFollowRedirects(true);
        c.setRequestProperty("User-Agent", "PrivateMmsGateway/1.1");
        c.setRequestProperty("Accept", "image/*,video/*,audio/*,*/*;q=0.3");
        c.connect();

        int status = c.getResponseCode();
        if (status < 200 || status >= 300) {
            throw new IllegalStateException("media HTTP " + status);
        }

        String typeHeader = c.getContentType();
        String mime = typeHeader == null ? "" : typeHeader.split(";")[0].trim().toLowerCase();
        int declared = c.getContentLength();
        if (declared > MAX_DOWNLOAD) throw new IllegalStateException("media too large");

        byte[] raw;
        try (InputStream in = c.getInputStream();
             ByteArrayOutputStream out = new ByteArrayOutputStream()) {
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
            byte[] image = compressImage(raw, targetBytes);
            return new Item(image, "image/jpeg", "reddit.jpg");
        }

        if (mime.startsWith("video/")) {
            if (raw.length > targetBytes) throw new IllegalStateException("video over carrier MMS limit");
            String actual = mime.isEmpty() ? "video/mp4" : mime;
            return new Item(raw, actual, "reddit.mp4");
        }

        if (mime.startsWith("audio/")) {
            if (raw.length > targetBytes) throw new IllegalStateException("audio over carrier MMS limit");
            String actual = mime.isEmpty() ? "audio/mp4" : mime;
            return new Item(raw, actual, "reddit.m4a");
        }

        throw new IllegalStateException("unsupported media type " + mime);
    }

    private static byte[] compressImage(byte[] raw, int targetBytes) throws Exception {
        Bitmap bitmap = BitmapFactory.decodeByteArray(raw, 0, raw.length);
        if (bitmap == null) throw new IllegalStateException("invalid image");

        Bitmap current = bitmap;
        try {
            int w = bitmap.getWidth();
            int h = bitmap.getHeight();
            float scale = Math.min(1f, Math.min(1920f / Math.max(1, w), 1920f / Math.max(1, h)));
            if (scale < 1f) {
                current = Bitmap.createScaledBitmap(
                        bitmap,
                        Math.max(1, Math.round(w * scale)),
                        Math.max(1, Math.round(h * scale)),
                        true
                );
            }

            for (int pass = 0; pass < 6; pass++) {
                for (int q : new int[]{92, 86, 80, 74, 68, 60, 52, 44}) {
                    try (ByteArrayOutputStream out = new ByteArrayOutputStream()) {
                        current.compress(Bitmap.CompressFormat.JPEG, q, out);
                        byte[] bytes = out.toByteArray();
                        if (bytes.length <= targetBytes) return bytes;
                    }
                }

                int nw = Math.max(1, Math.round(current.getWidth() * 0.78f));
                int nh = Math.max(1, Math.round(current.getHeight() * 0.78f));
                Bitmap smaller = Bitmap.createScaledBitmap(current, nw, nh, true);
                if (current != bitmap) current.recycle();
                current = smaller;
            }
            throw new IllegalStateException("image cannot fit carrier MMS limit");
        } finally {
            if (current != bitmap && !current.isRecycled()) current.recycle();
            if (!bitmap.isRecycled()) bitmap.recycle();
        }
    }
}
