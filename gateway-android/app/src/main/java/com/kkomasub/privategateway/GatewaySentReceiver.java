package com.kkomasub.privategateway;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import java.io.File;

public class GatewaySentReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        cleanupCache(context, intent);

        if (getResultCode() != Activity.RESULT_OK) {
            String recipient = intent.getStringExtra("gateway_recipient");
            String text = intent.getStringExtra("gateway_text");
            String fallback = intent.getStringExtra("gateway_fallback_url");
            if (recipient != null && !recipient.isEmpty() && fallback != null && !fallback.isEmpty()) {
                try {
                    MmsSender.sendSms(context, recipient,
                            (text == null || text.isEmpty() ? "" : text + "\n") + fallback);
                } catch (Throwable ignored) {}
            }
        }
    }

    private void cleanupCache(Context context, Intent intent) {
        String path = intent.getStringExtra("file_path");
        if (path == null) path = intent.getStringExtra("com.klinker.android.send_message.MMS_FILE_PATH");
        if (path != null) {
            try {
                File file = new File(path);
                if (file.getCanonicalPath().startsWith(context.getCacheDir().getCanonicalPath())) {
                    file.delete();
                }
            } catch (Throwable ignored) {}
        }
        File[] files = context.getCacheDir().listFiles();
        if (files != null) {
            for (File file : files) {
                if (file.getName().startsWith("send.") && file.getName().endsWith(".dat")) {
                    try { file.delete(); } catch (Throwable ignored) {}
                }
            }
        }
    }
}
