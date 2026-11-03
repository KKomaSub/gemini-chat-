package com.kkomasub.geminigateway;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class SendResultReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        // Result is intentionally not written to any message database or history.
    }
}
