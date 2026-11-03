package com.kkomasub.geminigateway;

import android.app.Service;
import android.content.Intent;
import android.os.IBinder;

/**
 * Required by Android's default-SMS role contract.
 * The gateway intentionally exposes no compose/history UI and persists nothing.
 */
public class HeadlessSmsSendService extends Service {
    @Override public IBinder onBind(Intent intent) { return null; }

    @Override
    public int onStartCommand(Intent intent, int flags, int startId) {
        stopSelf(startId);
        return START_NOT_STICKY;
    }
}
