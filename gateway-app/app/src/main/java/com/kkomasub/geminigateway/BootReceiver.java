package com.kkomasub.geminigateway;

import android.Manifest;
import android.app.role.RoleManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Telephony;

public class BootReceiver extends BroadcastReceiver {
    private boolean isDefaultSms(Context context) {
        if (Build.VERSION.SDK_INT >= 29) {
            RoleManager rm = context.getSystemService(RoleManager.class);
            return rm != null && rm.isRoleHeld(RoleManager.ROLE_SMS);
        }
        return context.getPackageName().equals(Telephony.Sms.getDefaultSmsPackage(context));
    }

    @Override
    public void onReceive(Context context, Intent intent) {
        if (!isDefaultSms(context)) return;
        if (context.checkSelfPermission(Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) return;

        Intent service = new Intent(context, GatewayService.class);
        try {
            if (Build.VERSION.SDK_INT >= 26) context.startForegroundService(service);
            else context.startService(service);
        } catch (Exception ignored) {
        }
    }
}
