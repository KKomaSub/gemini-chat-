package com.kkomasub.privategateway;

import android.app.PendingIntent;
import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.os.Bundle;
import android.telephony.SmsManager;
import android.telephony.SubscriptionManager;

import com.klinker.android.send_message.Settings;
import com.klinker.android.send_message.Transaction;

import java.lang.reflect.Array;
import java.lang.reflect.Constructor;
import java.lang.reflect.Field;
import java.lang.reflect.Method;
import java.nio.charset.StandardCharsets;
import java.util.ArrayList;

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

        // Transaction constructor initializes the library's static settings used by getBytes().
        new Transaction(context.getApplicationContext(), settings);

        Class<?> partClass = Class.forName("com.klinker.android.send_message.MMSPart");
        Constructor<?> ctor = partClass.getDeclaredConstructor();
        ctor.setAccessible(true);

        Object mediaPart = ctor.newInstance();
        setField(partClass, mediaPart, "Name", fileName);
        setField(partClass, mediaPart, "MimeType", mimeType);
        setField(partClass, mediaPart, "Data", media);

        int count = (text == null || text.isEmpty()) ? 1 : 2;
        Object partArray = Array.newInstance(partClass, count);
        Array.set(partArray, 0, mediaPart);

        if (count == 2) {
            Object textPart = ctor.newInstance();
            setField(partClass, textPart, "Name", "text.txt");
            setField(partClass, textPart, "MimeType", "text/plain");
            setField(partClass, textPart, "Data", text.getBytes(StandardCharsets.UTF_8));
            Array.set(partArray, 1, textPart);
        }

        Method getBytes = Transaction.class.getDeclaredMethod(
                "getBytes",
                Context.class,
                boolean.class,
                String.class,
                String[].class,
                partArray.getClass(),
                String.class
        );
        getBytes.setAccessible(true);
        Object info = getBytes.invoke(
                null,
                context.getApplicationContext(),
                false,
                null,
                new String[]{recipient},
                partArray,
                null
        );

        Field bytesField = info.getClass().getField("bytes");
        byte[] pdu = (byte[]) bytesField.get(info);
        if (pdu == null || pdu.length == 0) throw new IllegalStateException("empty MMS PDU");
        return pdu;
    }

    private static void setField(Class<?> type, Object target, String name, Object value)
            throws Exception {
        Field field = type.getDeclaredField(name);
        field.setAccessible(true);
        field.set(target, value);
    }

    private static SmsManager smsManager() {
        int subId = SubscriptionManager.getDefaultSmsSubscriptionId();
        if (subId != SubscriptionManager.INVALID_SUBSCRIPTION_ID) {
            return SmsManager.getSmsManagerForSubscriptionId(subId);
        }
        return SmsManager.getDefault();
    }
}
