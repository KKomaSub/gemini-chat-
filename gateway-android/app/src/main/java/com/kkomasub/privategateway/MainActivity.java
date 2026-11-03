package com.kkomasub.privategateway;

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
    private static final int REQ_ROLE = 1001;
    private static final int REQ_PERMS = 1002;
    private TextView status;
    private boolean roleRequested;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        LinearLayout root = new LinearLayout(this);
        root.setOrientation(LinearLayout.VERTICAL);
        root.setGravity(Gravity.CENTER);
        root.setPadding(48, 48, 48, 48);
        status = new TextView(this);
        status.setTextSize(20f);
        status.setGravity(Gravity.CENTER);
        root.addView(status, new LinearLayout.LayoutParams(
                LinearLayout.LayoutParams.MATCH_PARENT,
                LinearLayout.LayoutParams.WRAP_CONTENT));
        setContentView(root);
        continueSetup();
    }

    @Override
    protected void onResume() {
        super.onResume();
        if (!roleRequested) continueSetup();
    }

    private boolean isDefaultSmsApp() {
        if (Build.VERSION.SDK_INT >= 29) {
            RoleManager rm = getSystemService(RoleManager.class);
            return rm != null && rm.isRoleHeld(RoleManager.ROLE_SMS);
        }
        return getPackageName().equals(Telephony.Sms.getDefaultSmsPackage(this));
    }

    private void continueSetup() {
        if (!isDefaultSmsApp()) {
            status.setText("기본 문자 앱 권한을 허용해 주세요.\n설정 후 자동으로 계속 진행합니다.");
            if (roleRequested) return;
            roleRequested = true;
            if (Build.VERSION.SDK_INT >= 29) {
                RoleManager rm = getSystemService(RoleManager.class);
                if (rm != null && rm.isRoleAvailable(RoleManager.ROLE_SMS)) {
                    startActivityForResult(rm.createRequestRoleIntent(RoleManager.ROLE_SMS), REQ_ROLE);
                }
            } else {
                Intent intent = new Intent(Telephony.Sms.Intents.ACTION_CHANGE_DEFAULT);
                intent.putExtra(Telephony.Sms.Intents.EXTRA_PACKAGE_NAME, getPackageName());
                startActivityForResult(intent, REQ_ROLE);
            }
            return;
        }

        List<String> missing = new ArrayList<>();
        addIfMissing(missing, Manifest.permission.SEND_SMS);
        addIfMissing(missing, Manifest.permission.RECEIVE_SMS);
        addIfMissing(missing, Manifest.permission.READ_PHONE_STATE);
        if (Build.VERSION.SDK_INT >= 33) addIfMissing(missing, Manifest.permission.POST_NOTIFICATIONS);

        if (!missing.isEmpty()) {
            status.setText("문자 전송 권한을 허용해 주세요.");
            requestPermissions(missing.toArray(new String[0]), REQ_PERMS);
            return;
        }

        GatewayService.start(this);
        status.setText("게이트웨이 활성\n미디어는 저장하지 않고 메모리에서만 처리합니다.\n전송 내역은 문자 DB에 기록하지 않습니다.");
    }

    private void addIfMissing(List<String> list, String permission) {
        if (checkSelfPermission(permission) != PackageManager.PERMISSION_GRANTED) list.add(permission);
    }

    @Override
    protected void onActivityResult(int requestCode, int resultCode, Intent data) {
        super.onActivityResult(requestCode, resultCode, data);
        roleRequested = false;
        continueSetup();
    }

    @Override
    public void onRequestPermissionsResult(int requestCode, String[] permissions, int[] grantResults) {
        super.onRequestPermissionsResult(requestCode, permissions, grantResults);
        continueSetup();
    }
}
