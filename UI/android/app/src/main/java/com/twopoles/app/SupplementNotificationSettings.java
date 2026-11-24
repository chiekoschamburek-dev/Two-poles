package com.twopoles.app;

import android.app.AlarmManager;
import android.app.DownloadManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.PendingIntent;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.SharedPreferences;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.Handler;
import android.os.Looper;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSArray;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;
import java.io.FileInputStream;
import java.io.InputStream;
import java.security.MessageDigest;
import java.util.Locale;
import org.json.JSONArray;
import org.json.JSONObject;

/**
 * 补剂通知的入口与自检。
 *
 * 通道 ID 必须与 MainActivity 里创建的一致；改 ID 等于新建通道，是 Android 允许
 * 重新设定 importance 的唯一办法——对已存在的通道调用 createNotificationChannel
 * 不会更新重要性，旧版安装留下的 DEFAULT 通道会一直是 DEFAULT。
 */
@CapacitorPlugin(name = "SupplementNotificationSettings")
public class SupplementNotificationSettings extends Plugin {
    static final String CHANNEL_ID = "supplement-reminders-v2";
    /** 安装包下载超时：超过就取消并报错，避免 Promise 永远挂着 */
    static final long DOWNLOAD_TIMEOUT_MS = 10 * 60 * 1000L;

    /**
     * 用本应用自己的 AlarmManager 排每日提醒：广播由 SupplementAlarmReceiver 直接发通知，
     * 不再经过 Capacitor LocalNotifications 的 JS 回调。App 在后台时 WebView 被挂起，
     * 插件会先回调 JS 再 notify，结果通知被拖到用户重新打开 App 才出现。
     */
    @PluginMethod
    public void scheduleAlarms(PluginCall call) {
        JSArray alarms = call.getArray("alarms");
        if (alarms == null) {
            call.reject("缺少 alarms");
            return;
        }
        Context context = getContext();
        boolean replace = !Boolean.FALSE.equals(call.getBoolean("replace", true));
        if (replace) cancelScheduledAlarms(context);
        try {
            for (int index = 0; index < alarms.length(); index++) {
                JSONObject raw = alarms.getJSONObject(index);
                scheduleNativeAlarm(
                    context,
                    raw.optInt("id"),
                    raw.optString("title"),
                    raw.optString("body"),
                    raw.optString("channel", CHANNEL_ID),
                    raw.optInt("hour", -1),
                    raw.optInt("minute", -1),
                    raw.optBoolean("repeat", false),
                    raw.optLong("at", 0L)
                );
            }
            SharedPreferences prefs = context.getSharedPreferences(SupplementAlarmReceiver.PREFS, Context.MODE_PRIVATE);
            JSONArray stored = new JSONArray();
            if (!replace) {
                String previous = prefs.getString(SupplementAlarmReceiver.KEY_ALARMS, null);
                if (previous != null) {
                    try {
                        stored = new JSONArray(previous);
                    } catch (Exception ignored) {
                        stored = new JSONArray();
                    }
                }
            }
            for (int index = 0; index < alarms.length(); index++) {
                stored.put(alarms.getJSONObject(index));
            }
            prefs.edit().putString(SupplementAlarmReceiver.KEY_ALARMS, stored.toString()).apply();
            call.resolve();
        } catch (Exception exception) {
            call.reject(exception.getMessage());
        }
    }

    @PluginMethod
    public void cancelAlarms(PluginCall call) {
        cancelScheduledAlarms(getContext());
        call.resolve();
    }

    /** 取消上一次排的所有补剂闹钟（PendingIntent 只按 requestCode + 类匹配，extras 不影响） */
    private static void cancelScheduledAlarms(Context context) {
        SharedPreferences prefs = context.getSharedPreferences(SupplementAlarmReceiver.PREFS, Context.MODE_PRIVATE);
        String raw = prefs.getString(SupplementAlarmReceiver.KEY_ALARMS, null);
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (raw != null && manager != null) {
            try {
                JSONArray array = new JSONArray(raw);
                for (int index = 0; index < array.length(); index++) {
                    int id = array.getJSONObject(index).optInt("id");
                    PendingIntent pending = alarmPendingIntent(context, id);
                    if (pending != null) manager.cancel(pending);
                }
            } catch (Exception ignored) {
                // 坏数据不影响重新排
            }
        }
        prefs.edit().remove(SupplementAlarmReceiver.KEY_ALARMS).apply();
    }

    private static PendingIntent alarmPendingIntent(Context context, int id) {
        Intent intent = new Intent(context, SupplementAlarmReceiver.class);
        return PendingIntent.getBroadcast(
            context, id, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
    }

    /** 排一条本地闹钟；没有「闹钟和提醒」权限时退回非精确闹钟，不让提醒整体失效 */
    static void scheduleNativeAlarm(
        Context context,
        int id,
        String title,
        String body,
        String channel,
        int hour,
        int minute,
        boolean repeat,
        long at
    ) {
        if (at <= 0L) return;
        if (!repeat && at <= System.currentTimeMillis()) return;
        AlarmManager manager = (AlarmManager) context.getSystemService(Context.ALARM_SERVICE);
        if (manager == null) return;
        Intent intent = new Intent(context, SupplementAlarmReceiver.class)
            .putExtra(SupplementAlarmReceiver.EXTRA_ID, id)
            .putExtra(SupplementAlarmReceiver.EXTRA_TITLE, title)
            .putExtra(SupplementAlarmReceiver.EXTRA_BODY, body)
            .putExtra(SupplementAlarmReceiver.EXTRA_CHANNEL, channel)
            .putExtra(SupplementAlarmReceiver.EXTRA_HOUR, hour)
            .putExtra(SupplementAlarmReceiver.EXTRA_MINUTE, minute)
            .putExtra(SupplementAlarmReceiver.EXTRA_REPEAT, repeat);
        PendingIntent pending = PendingIntent.getBroadcast(
            context, id, intent,
            PendingIntent.FLAG_UPDATE_CURRENT | PendingIntent.FLAG_IMMUTABLE);
        try {
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S && !manager.canScheduleExactAlarms()) {
                manager.setAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
            } else {
                manager.setExactAndAllowWhileIdle(AlarmManager.RTC_WAKEUP, at, pending);
            }
        } catch (Exception ignored) {
            // 排不上时保留异常静默：上层页面仍会显示「已预约/失败」状态
        }
    }

    @PluginMethod
    public void open(PluginCall call) {
        String packageName = getContext().getPackageName();
        Intent intent;
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            intent = new Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS)
                .putExtra(Settings.EXTRA_APP_PACKAGE, packageName);
            if (Boolean.TRUE.equals(call.getBoolean("channel", true))) {
                intent.setAction(Settings.ACTION_CHANNEL_NOTIFICATION_SETTINGS);
                intent.putExtra(Settings.EXTRA_CHANNEL_ID, CHANNEL_ID);
                intent.putExtra(Settings.EXTRA_APP_PACKAGE, packageName);
            }
        } else {
            intent = new Intent(Settings.ACTION_APPLICATION_DETAILS_SETTINGS, Uri.fromParts("package", packageName, null));
        }

        try {
            getActivity().startActivity(intent);
            call.resolve();
        } catch (android.content.ActivityNotFoundException exception) {
            call.reject("无法打开通知设置", exception);
        }
    }

    /**
     * 返回通知链路上每一环的真实状态，供界面显示「卡在哪」。
     * importance 为 -1 表示通道还不存在（首次运行）。
     */
    @PluginMethod
    public void status(PluginCall call) {
        JSObject result = new JSObject();
        NotificationManager manager = getContext().getSystemService(NotificationManager.class);
        boolean notificationsEnabled = manager != null && manager.areNotificationsEnabled();
        int importance = -1;
        if (manager != null && Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
            NotificationChannel channel = manager.getNotificationChannel(CHANNEL_ID);
            if (channel != null) importance = channel.getImportance();
        }
        result.put("channelId", CHANNEL_ID);
        result.put("notificationsEnabled", notificationsEnabled);
        result.put("importance", importance);
        result.put("batteryUnrestricted", isBatteryUnrestricted());
        result.put("sdk", Build.VERSION.SDK_INT);
        call.resolve(result);
    }

    /** 国产 ROM 会冻结后台闹钟，必须在电池优化白名单里才稳 */
    @PluginMethod
    public void requestBatteryExemption(PluginCall call) {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) {
            call.resolve();
            return;
        }
        String packageName = getContext().getPackageName();
        Intent direct = new Intent(Settings.ACTION_REQUEST_IGNORE_BATTERY_OPTIMIZATIONS, Uri.parse("package:" + packageName));
        PackageManager packageManager = getContext().getPackageManager();
        try {
            if (packageManager.resolveActivity(direct, 0) != null) {
                getActivity().startActivity(direct);
            } else {
                getActivity().startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
            }
            call.resolve();
        } catch (Exception exception) {
            try {
                getActivity().startActivity(new Intent(Settings.ACTION_IGNORE_BATTERY_OPTIMIZATION_SETTINGS));
                call.resolve();
            } catch (Exception fallbackException) {
                call.reject("无法打开电池优化设置", fallbackException);
            }
        }
    }

    private boolean isBatteryUnrestricted() {
        if (Build.VERSION.SDK_INT < Build.VERSION_CODES.M) return true;
        PowerManager powerManager = getContext().getSystemService(PowerManager.class);
        return powerManager == null || powerManager.isIgnoringBatteryOptimizations(getContext().getPackageName());
    }

    /**
     * 网页层从 /apk/version.json 拿到最新 versionCode，和这里返回的已安装版本比对，
     * 就能在 App 内提示更新，不必等用户自己发现。
     */
    @PluginMethod
    public void appVersion(PluginCall call) {
        JSObject result = new JSObject();
        try {
            PackageManager manager = getContext().getPackageManager();
            android.content.pm.PackageInfo info;
            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                info = manager.getPackageInfo(getContext().getPackageName(), PackageManager.PackageInfoFlags.of(0));
            } else {
                info = manager.getPackageInfo(getContext().getPackageName(), 0);
            }
            long versionCode = Build.VERSION.SDK_INT >= Build.VERSION_CODES.P
                ? info.getLongVersionCode()
                : info.versionCode;
            result.put("versionCode", versionCode);
            result.put("versionName", info.versionName == null ? "" : info.versionName);
        } catch (Exception exception) {
            call.reject("读取应用版本失败", exception);
            return;
        }
        call.resolve(result);
    }

    /**
     * 应用内更新：下载安装包后拉起系统安装器。
     * Android 不允许侧载应用静默自安装，这里做到的是省掉「自己找文件再点安装」，
     * 最后的系统安装确认框必须由用户点一次，无法绕过。
     *
     * 清单里带了 size 与 sha256 就必须核对：下载被截断或被替换时宁可报错，也不拉起安装器。
     */
    @PluginMethod
    public void installApk(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("缺少安装包地址");
            return;
        }
        String fileName = call.getString("fileName", "twopoles-update.apk");
        final long expectedSize = call.getLong("size", 0L);
        final String expectedSha256 = call.getString("sha256", "");
        Context context = getContext();

        final DownloadManager manager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
        if (manager == null) {
            call.reject("系统下载服务不可用");
            return;
        }

        DownloadManager.Request request = new DownloadManager.Request(Uri.parse(url));
        request.setTitle("两仪更新");
        request.setDescription("正在下载新版本安装包");
        request.setMimeType("application/vnd.android.package-archive");
        request.setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED);
        request.setDestinationInExternalFilesDir(context, Environment.DIRECTORY_DOWNLOADS, fileName);
        final long downloadId;
        try {
            downloadId = manager.enqueue(request);
        } catch (Exception exception) {
            call.reject("无法开始下载：" + exception.getMessage(), exception);
            return;
        }

        final boolean[] settled = { false };
        final Handler handler = new Handler(Looper.getMainLooper());
        final BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context receiverContext, Intent intent) {
                long finished = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L);
                if (finished != downloadId || settled[0]) return;
                settled[0] = true;
                handler.removeCallbacksAndMessages(null);
                try {
                    context.unregisterReceiver(this);
                } catch (Exception ignored) {
                    // 已注销或进程重建，不重复处理
                }
                File file = new File(context.getExternalFilesDir(Environment.DIRECTORY_DOWNLOADS), fileName);
                if (!file.exists() || file.length() == 0) {
                    call.reject("安装包下载失败，请重试");
                    return;
                }
                if (expectedSize > 0 && file.length() != expectedSize) {
                    file.delete();
                    call.reject("安装包大小与清单不符，可能下载不完整，请重试");
                    return;
                }
                if (expectedSha256 != null && !expectedSha256.isEmpty()) {
                    String actual = sha256Of(file);
                    if (actual == null || !actual.equalsIgnoreCase(expectedSha256.trim())) {
                        file.delete();
                        call.reject("安装包校验失败，已删除下载文件，请重试");
                        return;
                    }
                }
                try {
                    Uri uri = FileProvider.getUriForFile(context, context.getPackageName() + ".fileprovider", file);
                    Intent install = new Intent(Intent.ACTION_VIEW);
                    install.setDataAndType(uri, "application/vnd.android.package-archive");
                    install.addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION);
                    install.addFlags(Intent.FLAG_ACTIVITY_NEW_TASK);
                    context.startActivity(install);
                    call.resolve();
                } catch (Exception exception) {
                    call.reject("无法拉起安装器：" + exception.getMessage(), exception);
                }
            }
        };

        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
            context.registerReceiver(receiver, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE), Context.RECEIVER_EXPORTED);
        } else {
            ContextCompat.registerReceiver(context, receiver, new IntentFilter(DownloadManager.ACTION_DOWNLOAD_COMPLETE), ContextCompat.RECEIVER_EXPORTED);
        }

        // 下载排队后可能永远收不到完成广播（网络卡死、系统清理任务）：超时后取消下载并释放 Promise
        handler.postDelayed(new Runnable() {
            @Override
            public void run() {
                if (settled[0]) return;
                settled[0] = true;
                try {
                    manager.remove(downloadId);
                } catch (Exception ignored) {
                    // 取消失败不影响报错
                }
                try {
                    context.unregisterReceiver(receiver);
                } catch (Exception ignored) {
                    // 已注销
                }
                call.reject("安装包下载超时，请检查网络后重试");
            }
        }, DOWNLOAD_TIMEOUT_MS);
        call.setKeepAlive(true);
    }

    /** 安装包 SHA-256（小写十六进制）；读文件失败返回 null */
    private static String sha256Of(File file) {
        try (InputStream input = new FileInputStream(file)) {
            MessageDigest digest = MessageDigest.getInstance("SHA-256");
            byte[] buffer = new byte[8192];
            int read;
            while ((read = input.read(buffer)) != -1) digest.update(buffer, 0, read);
            StringBuilder hex = new StringBuilder();
            for (byte value : digest.digest()) hex.append(String.format(Locale.US, "%02x", value));
            return hex.toString();
        } catch (Exception exception) {
            return null;
        }
    }
}