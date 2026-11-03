package com.kkomasub.privategateway;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.Binder;
import android.os.ParcelFileDescriptor;
import android.os.Process;

import java.io.FileNotFoundException;\nimport java.io.IOException;
import java.util.Map;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public final class MemoryPduProvider extends ContentProvider {
    private static final String AUTHORITY = "com.kkomasub.privategateway.pdu";
    private static final long TTL_MS = 2 * 60_000L;

    private static final class Entry {
        final byte[] bytes;
        final long createdAt;
        Entry(byte[] bytes) {
            this.bytes = bytes;
            this.createdAt = System.currentTimeMillis();
        }
    }

    private static final Map<String, Entry> DATA = new ConcurrentHashMap<>();

    public static Uri put(byte[] bytes) {
        cleanup();
        String id = UUID.randomUUID().toString();
        DATA.put(id, new Entry(bytes));
        return Uri.parse("content://" + AUTHORITY + "/pdu/" + id);
    }

    @Override public boolean onCreate() { return true; }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        if (!"r".equals(mode)) throw new SecurityException("read only");
        ensureAllowedCaller();

        String id = uri.getLastPathSegment();
        Entry entry = id == null ? null : DATA.get(id);
        if (entry == null || System.currentTimeMillis() - entry.createdAt > TTL_MS) {
            if (id != null) DATA.remove(id);
            throw new java.io.FileNotFoundException("expired");
        }

        final ParcelFileDescriptor[] pipe;
        try {
            pipe = ParcelFileDescriptor.createPipe();
        } catch (IOException error) {
            FileNotFoundException wrapped = new FileNotFoundException("pipe unavailable");
            wrapped.initCause(error);
            throw wrapped;
        }
        new Thread(() -> {
            try (ParcelFileDescriptor.AutoCloseOutputStream out =
                         new ParcelFileDescriptor.AutoCloseOutputStream(pipe[1])) {
                out.write(entry.bytes);
                out.flush();
            } catch (IOException ignored) {
            }
        }, "mms-memory-pipe").start();
        return pipe[0];
    }

    private void ensureAllowedCaller() {
        int uid = Binder.getCallingUid();
        if (uid == Process.myUid() || uid == Process.SYSTEM_UID || uid == 1001) return;

        if (getContext() != null) {
            String[] pkgs = getContext().getPackageManager().getPackagesForUid(uid);
            if (pkgs != null) {
                for (String pkg : pkgs) {
                    if ("com.android.phone".equals(pkg) ||
                            "com.google.android.mms.service".equals(pkg) ||
                            "com.android.mms.service".equals(pkg)) return;
                }
            }
        }
        throw new SecurityException("caller not allowed");
    }

    private static void cleanup() {
        long now = System.currentTimeMillis();
        for (Map.Entry<String, Entry> item : DATA.entrySet()) {
            if (now - item.getValue().createdAt > TTL_MS) DATA.remove(item.getKey());
        }
    }

    @Override public String getType(Uri uri) { return "application/vnd.wap.mms-message"; }
    @Override public Cursor query(Uri uri, String[] projection, String selection,
                                  String[] selectionArgs, String sortOrder) { return null; }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String selection, String[] selectionArgs) { return 0; }
    @Override public int update(Uri uri, ContentValues values, String selection,
                                String[] selectionArgs) { return 0; }
}
