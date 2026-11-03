package com.kkomasub.privategateway;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class GatewaySentReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (getResultCode() == Activity.RESULT_OK) return;

        String recipient = intent.getStringExtra("gateway_recipient");
        String text = intent.getStringExtra("gateway_text");
        String fallback = intent.getStringExtra("gateway_fallback_url");

        if (recipient == null || recipient.isEmpty() || fallback == null || fallback.isEmpty()) return;

        try {
            String body = (text == null || text.isEmpty() ? "" : text + "\n") + fallback;
            MmsSender.sendSms(context, recipient, body);
        } catch (Throwable ignored) {
            // Intentionally no logs containing message content.
        }
    }
}
