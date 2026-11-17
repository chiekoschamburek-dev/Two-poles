package com.twopoles.app;

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.os.Build;
import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(SupplementNotificationSettings.class);
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationManager manager = getSystemService(NotificationManager.class);
            // Android 只在通道第一次创建时接受 importance，之后 createNotificationChannel 不会改它。
            // 旧版留下的「supplement-reminders」如果已被降级，再调多少次都无效；
            // 因此换成 v2 新通道，并删掉旧同名通道，避免设置页出现两个「补剂提醒」。
            manager.deleteNotificationChannel("supplement-reminders");
            NotificationChannel channel = new NotificationChannel(
                SupplementNotificationSettings.CHANNEL_ID,
                getString(R.string.supplement_notification_channel),
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription(getString(R.string.supplement_notification_channel_description));
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            channel.enableVibration(true);
            channel.setShowBadge(true);
            manager.createNotificationChannel(channel);
        }
    }
}