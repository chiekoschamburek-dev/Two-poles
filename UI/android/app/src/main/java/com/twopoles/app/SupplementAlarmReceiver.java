package com.twopoles.app;

import android.app.Activity;
import android.app.AlarmManager;
import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.SharedPreferences;
import android.os.Build;
import android.os.Bundle;
import android.util.Log;
import androidx.core.app.NotificationCompat;
import java.util.Calendar;
import java.util.LinkedHashMap;
import java.util.Map;
import java.util.TimeZone;
import org.json.JSONArray;
import org.json.JSONException;
import org.json.JSONObject;

/** 补剂提醒在独立进程接收和处理，闹钟送达无需唤醒主界面。 */
public class SupplementAlarmReceiver extends BroadcastReceiver {
    static final String ACTION_SCHEDULE = "com.twopoles.app.SCHEDULE_SUPPLEMENT_ALARMS";
    static final String ACTION_CANCEL = "com.twopoles.app.CANCEL_SUPPLEMENT_ALARMS";
    static final String ACTION_STATUS = "com.twopoles.app.SUPPLEMENT_ALARM_STATUS";
    static final String EXTRA_ID = "supplement.id";
    private static final String EXTRA_AT = "supplement.at";
    private static final String PREFS = "twopoles_native_alarms";
    private static final String KEY_ALARMS = "alarms";
    private static final String TAG = "SupplementAlarm";

    @Override
    public void onReceive(Context context, Intent intent) {
        SharedPreferences prefs = context.getSharedPreferences(PREFS, Context.MODE_PRIVATE);
        int id = intent.getIntExtra(EXTRA_ID, 0);
        String action = intent.getAction();
        try {
            Map<Integer, JSONObject> alarms = readAlarms(prefs);
            if (ACTION_STATUS.equals(action)) {
                Bundle result = new Bundle();
                if (prefs.contains("triggerAt")) {
                    result.putLong("triggerAt", prefs.getLong("triggerAt", 0));
                    result.putString("triggerTitle", prefs.getString("triggerTitle", ""));
                }
                if (id != 0) {
                    if (id == prefs.getInt("lastTestId", 0)) result.putString("delivery", "fired");
                    else if (alarms.containsKey(id)) result.putString("delivery", "queued");
                }
                setResult(Activity.RESULT_OK, null, result);
            } else if (ACTION_CANCEL.equals(action)) {
                for (int alarmId : alarms.keySet()) cancel(context, alarmId);
                alarms.clear();
                saveAlarms(prefs, alarms);
                setResultCode(Activity.RESULT_OK);
            } else if (ACTION_SCHEDULE.equals(action)) {
                boolean exact = reconcile(context, prefs, alarms, intent);
                Bundle result = new Bundle();
                result.putBoolean("exact", exact);
                setResult(Activity.RESULT_OK, null, result);
            } else if (Intent.ACTION_BOOT_COMPLETED.equals(action) || Intent.ACTION_MY_PACKAGE_REPLACED.equals(action)) {
                restore(context, prefs, alarms, false);
            } else if (AlarmManager.ACTION_SCHEDULE_EXACT_ALARM_PERMISSION_STATE_CHANGED.equals(action)) {
                restore(context, prefs, alarms, true);
            } else if (action == null && id != 0) {
                deliver(context, prefs, alarms, id, intent.getLongExtra(EXTRA_AT, 0));
            }
        } catch (Exception error) {
            Log.e(TAG, "Failed to handle supplement alarm", error);
            if (isOrderedBroadcast()) setResult(Activity.RESULT_CANCELED, error.getMessage(), null);
        }
    }

    private static Map<Integer, JSONObject> readAlarms(SharedPreferences prefs) {
        Map<Integer, JSONObject> alarms = new LinkedHashMap<>();
        try {
            JSONArray stored = new JSONArray(prefs.getString(KEY_ALARMS, "[]"));
            for (int i = 0; i < stored.length(); i++) {
                JSONObject alarm = stored.optJSONObject(i);
                if (alarm != null && alarm.optInt("id") != 0) alarms.put(alarm.optInt("id"), alarm);
            }
        } catch (JSONException error) {
            Log.w(TAG, "Invalid stored supplement alarms", error);
        }
        return alarms;
    }

    private static void saveAlarms(SharedPreferences prefs, Map<Integer, JSONObject> alarms) {
        if (!prefs.edit().putString(KEY_ALARMS, new JSONArray(alarms.values()).toString()).commit()) {
            throw new IllegalStateException("无法保存系统提醒");
        }
    }

    private static boolean reconcile(
        Context context, SharedPreferences prefs, Map<Integer, JSONObject> alarms, Intent command
    ) throws JSONException {
        JSONArray requested = new JSONArray(command.getStringExtra("alarms"));
        Map<Integer, JSONObject> desired = new LinkedHashMap<>();
        for (int i = 0; i < requested.length(); i++) {
            JSONObject alarm = requested.getJSONObject(i);
            int id = alarm.getInt("id");
            if (id == 0 || alarm.getLong("at") <= 0) throw new IllegalArgumentException("无效的提醒预约");
            desired.put(id, alarm);
        }
        AlarmManager manager = alarmManager(context);
        boolean canExact = canScheduleExact(manager);
        boolean exact = canExact;
        boolean force = command.getBooleanExtra("force", false);
        String timeZone = TimeZone.getDefault().getID();
        try {
            for (Map.Entry<Integer, JSONObject> entry : desired.entrySet()) {
                int id = entry.getKey();
                JSONObject alarm = entry.getValue();
                JSONObject previous = alarms.get(id);
                // 同一时刻的每日提醒保留当前预约，避免回到前台时把待交付的今天提醒改为明天。
                boolean sameTime = alarm.optBoolean("repeat") && previous != null && previous.optBoolean("repeat")
                    && alarm.getInt("hour") == previous.optInt("hour", -1)
                    && alarm.getInt("minute") == previous.optInt("minute", -1)
                    && timeZone.equals(previous.optString("timeZone"))
                    && previous.optLong("at") > 0;
                if (sameTime) alarm.put("at", previous.getLong("at"));
                if (sameTime && !force && previous.has("exact") && previous.getBoolean("exact") == canExact) {
                    alarm.put("exact", canExact);
                } else {
                    if (alarm.optBoolean("repeat") && !sameTime) {
                        alarm.put("at", nextOccurrence(alarm.getInt("hour"), alarm.getInt("minute")));
                    }
                    schedule(context, manager, alarm);
                }
                if (alarm.optBoolean("repeat")) alarm.put("timeZone", timeZone);
                exact &= alarm.getBoolean("exact");
                alarms.put(id, alarm);
            }
            if (command.getBooleanExtra("replace", true)) {
                var iterator = alarms.entrySet().iterator();
                while (iterator.hasNext()) {
                    Map.Entry<Integer, JSONObject> entry = iterator.next();
                    if (entry.getValue().optBoolean("repeat") && !desired.containsKey(entry.getKey())) {
                        cancel(context, entry.getKey());
                        iterator.remove();
                    }
                }
            }
        } finally {
            saveAlarms(prefs, alarms);
        }
        return exact;
    }

    private static void deliver(
        Context context, SharedPreferences prefs, Map<Integer, JSONObject> alarms, int id, long at
    ) throws JSONException {
        JSONObject alarm = alarms.get(id);
        if (alarm == null || at != alarm.optLong("at")) return;
        boolean repeat = alarm.optBoolean("repeat");
        try {
            if (post(context, id, alarm)) {
                SharedPreferences.Editor receipt = prefs.edit()
                    .putLong("triggerAt", System.currentTimeMillis())
                    .putString("triggerTitle", alarm.getString("title"));
                if (!repeat) receipt.putInt("lastTestId", id);
                receipt.apply();
            }
        } finally {
            if (repeat) {
                alarm.put("at", nextOccurrence(alarm.getInt("hour"), alarm.getInt("minute")));
                alarm.remove("exact");
                try {
                    schedule(context, alarmManager(context), alarm);
                } finally {
                    saveAlarms(prefs, alarms);
                }
            } else {
                alarms.remove(id);
                saveAlarms(prefs, alarms);
            }
        }
    }

    private static boolean post(Context context, int id, JSONObject alarm) throws JSONException {
        NotificationManager manager = context.getSystemService(NotificationManager.class);
        if (manager == null || !manager.areNotificationsEnabled()) return false;
        String channel = alarm.optString("channel", SupplementNotificationSettings.CHANNEL_ID);
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel settings = manager.getNotificationChannel(channel);
            if (settings == null || settings.getImportance() == NotificationManager.IMPORTANCE_NONE) return false;
        }
        String body = alarm.optString("body");
        Notification notification = new NotificationCompat.Builder(context, channel)
            .setContentTitle(alarm.getString("title"))
            .setContentText(body)
            .setStyle(new NotificationCompat.BigTextStyle().bigText(body))
            .setSmallIcon(android.R.drawable.ic_dialog_info)
            .setPriority(NotificationCompat.PRIORITY_HIGH)
            .setDefaults(NotificationCompat.DEFAULT_ALL)
            .setAutoCancel(true)
            .setOnlyAlertOnce(false)
            .setContentIntent(launchIntent(context, id))
            .build();
        manager.notify(id, notification);
        return true;
    }

    private static PendingIntent launchIntent(Context context, int id) {
        Intent launch = context.getPackageManager().getLaunchIntentForPackage(context.getPackageName());
        if (launch == null) return null;
        launch.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK | Intent.FLAG_ACTIVITY_CLEAR_TOP | Intent.FLAG_ACTIVITY_SINGLE_TOP);
        return PendingIntent.getActivity(context, id, launch, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    private static AlarmManager alarmManager(Context context) {
        AlarmManager manager = context.getSystemService(AlarmManager.class);
        if (manager == null) throw new IllegalStateException("系统闹钟服务不可用");
        return manager;
    }

    private static boolean canScheduleExact(AlarmManager manager) {
        return Build.VERSION.SDK_INT < Build.VERSION_CODES.S || manager.canScheduleExactAlarms();
    }

    private static void schedule(Context context, AlarmManager manager, JSONObject alarm) throws JSONException {
        int id = alarm.getInt("id");
        long at = alarm.getLong("at");
        Intent intent = new Intent(context, SupplementAlarmReceiver.class).putExtra(EXTRA_ID, id).putExtra(EXTRA_AT, at);
        PendingIntent pending = PendingIntent.getBroadcast(
            context, id, intent, PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        if (canScheduleExact(manager)) {
            PendingIntent show = launchIntent(context, 0);
            try {
                manager.setAlarmClock(new AlarmManager.AlarmClockInfo(at, show == null ? pending : show), pending);
                alarm.put("exact", true);
                return;
            } catch (SecurityException error) {
                // 用户可能恰好在预约时撤回了准时提醒授权。
                Log.w(TAG, "Exact alarm permission changed", error);
            }
        }
        manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
        alarm.put("exact", false);
    }

    private static void cancel(Context context, int id) {
        Intent intent = new Intent(context, SupplementAlarmReceiver.class);
        PendingIntent pending = PendingIntent.getBroadcast(
            context, id, intent, PendingIntent.FLAG_NO_CREATE | PendingIntent.FLAG_IMMUTABLE);
        if (pending != null) {
            alarmManager(context).cancel(pending);
            pending.cancel();
        }
    }

    private static long nextOccurrence(int hour, int minute) {
        Calendar next = Calendar.getInstance();
        next.set(Calendar.HOUR_OF_DAY, hour);
        next.set(Calendar.MINUTE, minute);
        next.set(Calendar.SECOND, 0);
        next.set(Calendar.MILLISECOND, 0);
        if (next.getTimeInMillis() <= System.currentTimeMillis()) next.add(Calendar.DAY_OF_YEAR, 1);
        return next.getTimeInMillis();
    }

    /** 重启或更新后恢复每日提醒。准时权限打开时重新预约仍在等待的提醒。 */
    private static void restore(
        Context context, SharedPreferences prefs, Map<Integer, JSONObject> alarms, boolean permissionChanged
    ) {
        AlarmManager manager = alarmManager(context);
        if (permissionChanged && !canScheduleExact(manager)) return;
        var iterator = alarms.values().iterator();
        while (iterator.hasNext()) {
            JSONObject alarm = iterator.next();
            try {
                if (alarm.optBoolean("repeat")) {
                    if (!permissionChanged) alarm.put("at", nextOccurrence(alarm.getInt("hour"), alarm.getInt("minute")));
                    alarm.put("timeZone", TimeZone.getDefault().getID());
                } else if (!permissionChanged && alarm.getLong("at") <= System.currentTimeMillis()) {
                    iterator.remove();
                    continue;
                }
                schedule(context, manager, alarm);
            } catch (Exception error) {
                alarm.remove("exact");
                Log.e(TAG, "Failed to restore supplement alarm " + alarm.optInt("id"), error);
            }
        }
        saveAlarms(prefs, alarms);
    }
}
