package com.kkomasub.privategateway;

import android.Manifest;
import android.app.role.RoleManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.provider.Telephony;

public class BootReceiver extends BroadcastReceiver {
    @Override public void onReceive(Context context, Intent intent) {
        if (!Intent.ACTION_BOOT_COMPLETED.equals(intent.getAction())) return;
        boolean role;
        if (Build.VERSION.SDK_INT >= 29) {
            RoleManager rm = context.getSystemService(RoleManager.class);
            role = rm != null && rm.isRoleHeld(RoleManager.ROLE_SMS);
        } else {
            role = context.getPackageName().equals(Telephony.Sms.getDefaultSmsPackage(context));
        }
        if (role && context.checkSelfPermission(Manifest.permission.SEND_SMS) == PackageManager.PERMISSION_GRANTED) {
            GatewayService.start(context);
        }
    }
}
