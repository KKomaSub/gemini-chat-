package com.kkomasub.geminigateway;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class MmsReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        // Dedicated gateway: incoming MMS is intentionally not persisted or displayed.
    }
}
