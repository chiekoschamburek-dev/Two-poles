package com.twopoles.app;

import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import androidx.core.app.NotificationCompat;
import java.util.Calendar;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 由本应用自己的 AlarmManager 闹钟触发的广播：直接发通知，不经过 WebView。
 *
 * Capacitor LocalNotifications 的 TimedNotificationPublisher 在发通知前会先回调 JS
 * （fireReceived）。App 在后台时 WebView 被挂起，这个回调会把 notify 一起拖到用户重新打开
 * App 才执行——表现就是「后台收不到，点进应用才弹」。这里把发通知放在纯原生路径上，
 * 顺带绕开这一层时序依赖。
 */
public class SupplementAlarmReceiver extends BroadcastReceiver {
    static final String EXTRA_ID = "supplement.id";
    static final String EXTRA_TITLE = "supplement.title";
    static final String EXTRA_BODY = "supplement.body";
    static final String EXTRA_CHANNEL = "supplement.channel";
    static final String EXTRA_HOUR = "supplement.hour";
    static final String EXTRA_MINUTE = "supplement.minute";
    static final String EXTRA_REPEAT = "supplement.repeat";
    static final String PREFS = "twopoles_native_alarms";
    static final String KEY_ALARMS = "alarms";

    @Override
    public void onReceive(Context context, Intent intent) {
        String action = intent.getAction();
        if (Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
            restore(context);
            return;
        }
        int id = intent.getIntExtra(EXTRA_ID, 0);
        String title = intent.getStringExtra(EXTRA_TITLE);
        String body = intent.getStringExtra(EXTRA_BODY);
        String channel = intent.getStringExtra(EXTRA_CHANNEL);
        post(context, id, title, body, channel);
        if (intent.getBooleanExtra(EXTRA_REPEAT, false)) {
            int hour = intent.getIntExtra(EXTRA_HOUR, -1);
            int minute = intent.getIntExtra(EXTRA_MINUTE, -1);
            if (hour >= 0 && minute >= 0) {
                long next = nextOccurrence(hour, minute);
                SupplementNotificationSettings.scheduleNativeAlarm(
                    context, id, title, body, channel, hour, minute, true, next);
            }
        }
    }

    private void post(Context context, int id, String title, String body, String channel) {
        if (title == null) return;
        NotificationManager manager = (NotificationManager) context.getSystemService(Context.NOTIFICATION_SERVICE);
        if (manager == null) return;
        String channelId = channel != null && !channel.isEmpty() ? channel : SupplementNotificationSettings.CHANNEL_ID;
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        PendingIntent contentIntent = null;
        if (launch != null) {
            launch.setFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
            contentIntent = PendingIntent.getActivity(
                context, id, launch,
                PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        }
        Notification notification = new NotificationCompat.Builder(context, channelId)
            .setContentTitle(title)
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body == null ? "" : body))
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setAutoCancel(true)
            .setOnlyAlertOnce(false)
            .setContentIntent(contentIntent)
            .build();
        try {
            manager.notify(id, notification);
        } catch (Exception ignored) {
            // 通知被系统拒绝时不崩溃；下一次闹钟仍会照常触发
        }
    }

    private static long nextOccurrence(int hour, int minute) {
        Calendar next = Calendar.getInstance();
        next.set(Calendar.HOUR_OF_DAY, hour);
        next.set(Calendar.MINUTE, minute);
        next.set(Calendar.SECOND, 0);
        next.set(Calendar.MILLISECOND, 0);
        if (next.getTimeInMillis() <= System.currentTimeMillis()) {
            next.add(Calendar.DAY_OF_YEAR, 1);
        }
        return next.getTimeInMillis();
    }

    /** 开机或应用更新后，把持久化的每日提醒重新排进 AlarmManager */
    private static void restore(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        String raw = prefs.getString(KEY_ALARMS, null);
        if (raw == null) return;
        try {
            JSONArray array = new JSONArray(raw);
            for (int index = 0; index < array.length(); index++) {
                JSONObject item = array.getJSONObject(index);
                int id = item.optInt("id");
                int hour = item.optInt("hour", -1);
                int minute = item.optInt("minute", -1);
                boolean repeat = item.optBoolean("repeat", true);
                if (hour < 0 || minute < 0) continue;
                long at = repeat ? nextOccurrence(hour, minute) : item.optLong("at", 0L);
                if (at <= System.currentTimeMillis()) continue;
                SupplementNotificationSettings.scheduleNativeAlarm(
                    context, id, item.optString("title"), item.optString("body"),
                    item.optString("channel"), hour, minute, repeat, at);
            }
        } catch (Exception ignored) {
            // 坏数据不影响其他提醒
        }
    }
}