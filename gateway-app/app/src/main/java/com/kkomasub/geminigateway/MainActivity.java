package com.kkomasub.geminigateway;

import android.Manifest;
import android.app.Activity;
import android.app.role.RoleManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.os.Build;
import android.os.Bundle;
import android.provider.Telephony;
import android.view.Gravity;
import android.widget.LinearLayout;
import android.widget.TextView;

import java.util.ArrayList;
import java.util.List;

public class MainActivity extends Activity {
    private static final int REQ_ROLE = 10;
    private static final int REQ_PERMS = 11;
    private TextView status;

    @Override
    protected void onCreate(Bundle state) {
        super.onCreate(state);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(48, 48, 48, 48);

        TextView title = new TextView(this);
        title.setText("Gemini Gateway");
        title.setTextSize(26);
        title.setGravity(Gravity.CENTER);

        status = new TextView(this);
        status.setTextSize(16);
        status.setGravity(Gravity.CENTER);
        status.setPadding(0, 28, 0, 0);

        root.addView(title);
        root.addView(status);
        setContentView(root);
        continueSetup();
    }

    private boolean isDefaultSms() {
        if (Build.VERSION.SDK_INT >= 29) {
            RoleManager rm = getSystemService(RoleManager.class);
            return rm != null && rm.isRoleHeld(RoleManager.ROLE_SMS);
        }
        String pkg = Telephony.Sms.getDefaultSmsPackage(this);
        return getPackageName().equals(pkg);
    }

    private void continueSetup() {
        if (!isDefaultSms()) {
            status.setText("Android 기본 문자 앱 승인만 완료하면 자동으로 시작됩니다.");
            requestSmsRole();
            return;
        }
        requestNeededPermissions();
    }

    private void requestSmsRole() {
        if (Build.VERSION.SDK_INT >= 29) {
            RoleManager rm = getSystemService(RoleManager.class);
            if (rm != null && rm.isRoleAvailable(RoleManager.ROLE_SMS)) {
                startActivityForResult(rm.createRequestRoleIntent(RoleManager.ROLE_SMS), REQ_ROLE);
                return;
            }
        }
        Intent change = new Intent(Telephony.Sms.Intents.ACTION_CHANGE_DEFAULT);
        change.putExtra(Telephony.Sms.Intents.EXTRA_PACKAGE_NAME, getPackageName());
        startActivityForResult(change, REQ_ROLE);
    }

    private void requestNeededPermissions() {
        List<String> need = new ArrayList<>();
        String[] sms = {
                Manifest.permission.SEND_SMS,
                Manifest.permission.RECEIVE_SMS,
                Manifest.permission.READ_SMS,
                Manifest.permission.READ_PHONE_STATE
        };
        for (String p : sms) {
            if (checkSelfPermission(p) != PackageManager.PERMISSION_GRANTED) need.add(p);
        }
        if (Build.VERSION.SDK_INT >= 33 &&
                checkSelfPermission(Manifest.permission.POST_NOTIFICATIONS) != PackageManager.PERMISSION_GRANTED) {
            need.add(Manifest.permission.POST_NOTIFICATIONS);
        }
        if (!need.isEmpty()) {
            status.setText("Android 권한 승인을 완료하면 자동으로 시작됩니다.");
            requestPermissions(need.toArray(new String[0]), REQ_PERMS);
            return;
        }
        startGateway();
    }

    private void startGateway() {
        if (!isDefaultSms() || checkSelfPermission(Manifest.permission.SEND_SMS) != PackageManager.PERMISSION_GRANTED) {
            continueSetup();
            return;
        }
        Intent intent = new Intent(this, GatewayService.class);
        if (Build.VERSION.SDK_INT >= 26) startForegroundService(intent);
        else startService(intent);
        status.setText("준비 완료\n설정할 항목이 없습니다. 이 화면은 닫아도 됩니다.");
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        if (requestCode == REQ_ROLE) continueSetup();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] results) {
        super.onRequestPermissionsResult(requestCode, permissions, results);
        if (requestCode == REQ_PERMS) startGateway();
    }
}
