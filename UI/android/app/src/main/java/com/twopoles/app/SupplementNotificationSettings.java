package com.twopoles.app;

import android.content.Intent;
import android.net.Uri;
import android.os.Build;
import android.provider.Settings;
import com.getcapacitor.Plugin;
import com.getcapacitor.PluginCall;
import com.getcapacitor.PluginMethod;
import com.getcapacitor.annotation.CapacitorPlugin;

@CapacitorPlugin(name = "SupplementNotificationSettings")
public class SupplementNotificationSettings extends Plugin {
    static final String CHANNEL_ID = "supplement-reminders";

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
}
