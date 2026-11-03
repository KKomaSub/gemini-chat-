package com.kkomasub.geminigateway;

import android.content.ContentProvider;
import android.content.ContentValues;
import android.database.Cursor;
import android.net.Uri;
import android.os.ParcelFileDescriptor;

import java.io.FileNotFoundException;
import java.io.OutputStream;
import java.util.UUID;
import java.util.concurrent.ConcurrentHashMap;

public class MemoryPduProvider extends ContentProvider {
    private static final ConcurrentHashMap<String, byte[]> PDUS = new ConcurrentHashMap<>();

    public static Uri register(byte[] bytes) {
        String id = UUID.randomUUID().toString();
        PDUS.put(id, bytes);
        return Uri.parse("content://com.kkomasub.geminigateway.pdu/" + id);
    }

    @Override
    public boolean onCreate() { return true; }

    @Override
    public String getType(Uri uri) { return "application/vnd.wap.mms-message"; }

    @Override
    public ParcelFileDescriptor openFile(Uri uri, String mode) throws FileNotFoundException {
        String id = uri.getLastPathSegment();
        byte[] bytes = id == null ? null : PDUS.remove(id);
        if (bytes == null) throw new FileNotFoundException("PDU expired");
        try {
            ParcelFileDescriptor[] pipe = ParcelFileDescriptor.createPipe();
            new Thread(() -> {
                try (OutputStream out = new ParcelFileDescriptor.AutoCloseOutputStream(pipe[1])) {
                    out.write(bytes);
                    out.flush();
                } catch (Exception ignored) {
                }
            }, "pdu-pipe").start();
            return pipe[0];
        } catch (Exception e) {
            throw new FileNotFoundException(e.toString());
        }
    }

    @Override public Cursor query(Uri uri, String[] p, String s, String[] a, String sort) { return null; }
    @Override public Uri insert(Uri uri, ContentValues values) { throw new UnsupportedOperationException(); }
    @Override public int delete(Uri uri, String s, String[] a) { return 0; }
    @Override public int update(Uri uri, ContentValues v, String s, String[] a) { return 0; }
}
