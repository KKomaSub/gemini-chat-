package com.kkomasub.privategateway;

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class GatewaySentReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        PrivacyCleanup.clean(context, System.currentTimeMillis() - 10 * 60_000L);
    }
}
