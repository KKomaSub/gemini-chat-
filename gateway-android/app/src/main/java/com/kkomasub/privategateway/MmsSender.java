package com.kkomasub.privategateway;

import android.app.PendingIntent;
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
                        byte[] media, String mimeType, String fileName) {
        Settings settings = new Settings();
        settings.setUseSystemSending(true);
        settings.setGroup(false);
        settings.setDeliveryReports(false);

        Message message = new Message(text, recipient);
        message.addMedia(media, mimeType, fileName);
        // Do not persist into the Telephony provider. The library's system-sending
        // path expects a non-null URI even when save=false; a guaranteed-missing
        // row keeps the update a no-op while allowing direct SmsManager MMS send.
        message.setSave(false);
        message.setMessageUri(Uri.parse("content://mms/0"));

        Transaction tx = new Transaction(context, settings);
        tx.setExplicitBroadcastForSentMms(new Intent(context, GatewaySentReceiver.class));
        tx.sendNewMessage(message, Transaction.NO_THREAD_ID);
    }
}
