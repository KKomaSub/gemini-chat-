package com.kkomasub.privategateway;
import android.app.Service;
import android.content.Intent;
import android.os.IBinder;
public class RespondService extends Service {
    @Override public int onStartCommand(Intent intent, int flags, int startId) {
        stopSelf(startId); return START_NOT_STICKY;
    }
    @Override public IBinder onBind(Intent intent) { return null; }
}
