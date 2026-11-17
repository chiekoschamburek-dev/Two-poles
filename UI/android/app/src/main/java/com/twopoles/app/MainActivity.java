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
        super.onCreate(savedInstanceState);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            // 已安装的 App 也可能先加载线上旧页面，由原生端保证渠道已经存在。
            NotificationChannel channel = new NotificationChannel(
                "supplement-reminders",
                getString(R.string.supplement_notification_channel),
                NotificationManager.IMPORTANCE_HIGH
            );
            channel.setDescription(getString(R.string.supplement_notification_channel_description));
            channel.setLockscreenVisibility(Notification.VISIBILITY_PUBLIC);
            getSystemService(NotificationManager.class).createNotificationChannel(channel);
        }
    }
}
