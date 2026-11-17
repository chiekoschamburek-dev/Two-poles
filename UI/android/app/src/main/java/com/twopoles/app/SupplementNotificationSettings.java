package com.twopoles.app;

import android.app.DownloadManager;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.content.IntentFilter;
import android.content.pm.PackageManager;
import android.net.Uri;
import android.os.Build;
import android.os.Environment;
import android.os.PowerManager;
import android.provider.Settings;
import androidx.core.content.ContextCompat;
import androidx.core.content.FileProvider;
import com.getcapacitor.JSObject;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;
import java.io.File;

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
     */
    @PluginMethod
    public void installApk(PluginCall call) {
        String url = call.getString("url");
        if (url == null || url.isEmpty()) {
            call.reject("缺少安装包地址");
            return;
        }
        String fileName = call.getString("fileName", "twopoles-update.apk");
        Context context = getContext();

        DownloadManager manager = (DownloadManager) context.getSystemService(Context.DOWNLOAD_SERVICE);
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
        long downloadId;
        try {
            downloadId = manager.enqueue(request);
        } catch (Exception exception) {
            call.reject("无法开始下载：" + exception.getMessage(), exception);
            return;
        }

        BroadcastReceiver receiver = new BroadcastReceiver() {
            @Override
            public void onReceive(Context receiverContext, Intent intent) {
                long finished = intent.getLongExtra(DownloadManager.EXTRA_DOWNLOAD_ID, -1L);
                if (finished != downloadId) return;
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
        call.setKeepAlive(true);
    }
}