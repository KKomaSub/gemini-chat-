package com.kkomasub.privategateway;

import android.content.Context;
import android.content.Intent;
import android.net.Uri;
import android.telephony.SmsManager;

import com.klinker.android.send_message.Message;
import com.klinker.android.send_message.Settings;
import com.klinker.android.send_message.Transaction;

import java.util.ArrayList;

final class MmsSender {
    private MmsSender() {}

    static void sendSms(Context context, String recipient, String text) {
        SmsManager manager = SmsManager.getDefault();
        ArrayList<String> parts = manager.divideMessage(text);
        manager.sendMultipartTextMessage(recipient, null, parts, null, null);
    }

    static void sendMms(Context context, String recipient, String text,
                        byte[] media, String mimeType, String fileName,
                        String fallbackUrl) {
        Settings settings = new Settings();
        settings.setUseSystemSending(true);
        settings.setGroup(false);
        settings.setDeliveryReports(false);

        Message message = new Message(text, recipient);
        message.addMedia(media, mimeType, fileName);
        message.setSave(false);
        message.setMessageUri(Uri.parse("content://mms/0"));

        Intent sent = new Intent(context, GatewaySentReceiver.class);
        sent.putExtra("gateway_recipient", recipient);
        sent.putExtra("gateway_text", text);
        sent.putExtra("gateway_fallback_url", fallbackUrl == null ? "" : fallbackUrl);

        Transaction tx = new Transaction(context, settings);
        tx.setExplicitBroadcastForSentMms(sent);
        tx.sendNewMessage(message, Transaction.NO_THREAD_ID);
    }
}
