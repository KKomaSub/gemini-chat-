package com.kkomasub.privategateway;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.telephony.SmsManager;
import android.telephony.SubscriptionManager;

import com.google.android.mms.MMSPart;
import com.klinker.android.send_message.Settings;
import com.klinker.android.send_message.Transaction;

import java.nio.charset.StandardCharsets;
import java.util.ArrayList;
import java.util.List;

final class MmsSender {
    private MmsSender() {}

    static void sendSms(Context context, String recipient, String text) {
        SmsManager manager = smsManager();
        ArrayList<String> parts = manager.divideMessage(text);
        manager.sendMultipartTextMessage(recipient, null, parts, null, null);
    }

    static int maxMediaBytes(Context context) {
        int max = 1024 * 1024;
        try {
            Bundle values = smsManager().getCarrierConfigValues();
            int configured = values.getInt(SmsManager.MMS_CONFIG_MAX_MESSAGE_SIZE, max);
            if (configured > 0) max = configured;
        } catch (Throwable ignored) {}

        max = Math.max(300 * 1024, Math.min(max, 8 * 1024 * 1024));
        int reserve = Math.max(64 * 1024, max / 10);
        return Math.max(200 * 1024, max - reserve);
    }

    static void sendMms(Context context, String recipient, String text,
                        byte[] media, String mimeType, String fileName,
                        String fallbackUrl) throws Exception {
        byte[] pdu = buildPduInMemory(context, recipient, text, media, mimeType, fileName);
        Uri uri = MemoryPduProvider.put(pdu);

        Intent sent = new Intent(context, GatewaySentReceiver.class);
        sent.putExtra("gateway_recipient", recipient);
        sent.putExtra("gateway_text", text == null ? "" : text);
        sent.putExtra("gateway_fallback_url", fallbackUrl == null ? "" : fallbackUrl);

        int requestCode = (int) (System.nanoTime() & 0x7fffffff);
        PendingIntent pending = PendingIntent.getBroadcast(
                context,
                requestCode,
                sent,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE
        );

        SmsManager manager = smsManager();
        Bundle overrides = new Bundle();
        try {
            Bundle carrier = manager.getCarrierConfigValues();
            int max = carrier.getInt(SmsManager.MMS_CONFIG_MAX_MESSAGE_SIZE, 0);
            if (max > 0) overrides.putInt(SmsManager.MMS_CONFIG_MAX_MESSAGE_SIZE, max);
            overrides.putBoolean(SmsManager.MMS_CONFIG_GROUP_MMS_ENABLED, false);
        } catch (Throwable ignored) {}

        manager.sendMultimediaMessage(context, uri, null, overrides, pending);
    }

    private static byte[] buildPduInMemory(Context context, String recipient, String text,
                                           byte[] media, String mimeType, String fileName)
            throws Exception {
        Settings settings = new Settings();
        settings.setUseSystemSending(true);
        settings.setGroup(false);
        settings.setDeliveryReports(false);
        int subId = SubscriptionManager.getDefaultSmsSubscriptionId();
        if (subId != SubscriptionManager.INVALID_SUBSCRIPTION_ID) {
            settings.setSubscriptionId(subId);
        }

        // Initializes the library's static subscription/settings state used by getBytes().
        new Transaction(context.getApplicationContext(), settings);

        List<MMSPart> parts = new ArrayList<>();

        MMSPart mediaPart = new MMSPart();
        mediaPart.Name = fileName;
        mediaPart.MimeType = mimeType;
        mediaPart.Data = media;
        parts.add(mediaPart);

        if (text != null && !text.isEmpty()) {
            MMSPart textPart = new MMSPart();
            textPart.Name = "text.txt";
            textPart.MimeType = "text/plain";
            textPart.Data = text.getBytes(StandardCharsets.UTF_8);
            parts.add(textPart);
        }

        Transaction.MessageInfo info = Transaction.getBytes(
                context.getApplicationContext(),
                false,
                null,
                new String[]{recipient},
                parts.toArray(new MMSPart[0]),
                null
        );
        if (info == null || info.bytes == null || info.bytes.length == 0) {
            throw new IllegalStateException("empty MMS PDU");
        }
        return info.bytes;
    }

    private static SmsManager smsManager() {
        int subId = SubscriptionManager.getDefaultSmsSubscriptionId();
        if (subId != SubscriptionManager.INVALID_SUBSCRIPTION_ID) {
            return SmsManager.getSmsManagerForSubscriptionId(subId);
        }
        return SmsManager.getDefault();
    }
}
