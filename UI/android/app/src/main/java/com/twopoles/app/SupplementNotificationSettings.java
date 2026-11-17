package com.twopoles.app;

import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.Intent;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.PowerManager;
import android.provider.Settings;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

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
}