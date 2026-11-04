package com.kkomasub.privategateway;

import android.app.Activity;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;

public class GatewaySentReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (getResultCode() == Activity.RESULT_OK) return;

        String recipient = intent.getStringExtra("gateway_recipient");
        if (recipient == null || recipient.isEmpty()) return;
        try {
            MmsSender.sendSms(context, recipient, "이미지 MMS 전송에 실패했습니다.");
        } catch (Throwable ignored) {
            // Intentionally do not log private message contents.
        }
    }
}
