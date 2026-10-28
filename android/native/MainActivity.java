package io.github.troubledkezoo1.zebraapp;

import android.content.Intent;
import android.database.Cursor;
import android.net.Uri;
import android.os.Bundle;
import android.provider.OpenableColumns;
import com.getcapacitor.BridgeActivity;
import java.io.ByteArrayOutputStream;
import java.io.InputStream;

public class MainActivity extends BridgeActivity {
    static String pendingName = null;
    static String pendingText = null;

    @Override
    public void onCreate(Bundle savedInstanceState) {
        registerPlugin(ApkInstallerPlugin.class);
        super.onCreate(savedInstanceState);
        handleIntent(getIntent());
    }

    @Override
    protected void onNewIntent(Intent intent) {
        super.onNewIntent(intent);
        handleIntent(intent);
    }

    /** A .zpl / .zebra file opened with ZebraApp: keep its text until the web page asks for it. */
    private void handleIntent(Intent intent) {
        if (intent == null || !Intent.ACTION_VIEW.equals(intent.getAction())) return;
        Uri uri = intent.getData();
        if (uri == null) return;
        try {
            String name = "label";
            Cursor c = getContentResolver().query(uri, null, null, null, null);
            if (c != null) {
                try {
                    int i = c.getColumnIndex(OpenableColumns.DISPLAY_NAME);
                    if (i >= 0 && c.moveToFirst()) name = c.getString(i);
                } finally { c.close(); }
            } else if (uri.getLastPathSegment() != null) {
                name = uri.getLastPathSegment();
            }
            InputStream in = getContentResolver().openInputStream(uri);
            if (in == null) return;
            ByteArrayOutputStream out = new ByteArrayOutputStream();
            byte[] buf = new byte[16384];
            int n;
            while ((n = in.read(buf)) > 0) {
                out.write(buf, 0, n);
                if (out.size() > 5 * 1024 * 1024) { in.close(); return; }   // labels are small; ignore huge files
            }
            in.close();
            synchronized (MainActivity.class) {
                pendingName = name;
                pendingText = out.toString("UTF-8");
            }
        } catch (Exception e) {
            // unreadable file: nothing to hand over
        }
    }
}
