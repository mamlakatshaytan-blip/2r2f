# AIDE Project Implementation Guide (Clean Code)

Copy the following code blocks into your AIDE project. Each section shows exactly which file to create or edit.

## 1. Android Package Configuration
**Path:** `AndroidManifest.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<manifest xmlns:android="http://schemas.android.com/apk/res/android"
    package="com.suhaib.wrya">

    <application
        android:allowBackup="true"
        android:label="suhaib"
        android:supportsRtl="true"
        android:theme="@android:style/Theme.Black.NoTitleBar.Fullscreen">
        <activity
            android:name=".MainActivity"
            android:label="suhaib">
            <intent-filter>
                <action android:name="android.intent.action.MAIN" />
                <category android:name="android.intent.category.LAUNCHER" />
            </intent-filter>
        </activity>
    </application>

</manifest>
```

## 2. Layout Design
**Path:** `res/layout/activity_main.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<RelativeLayout xmlns:android="http://schemas.android.com/apk/res/android"
    android:id="@+id/main_layout"
    android:layout_width="match_parent"
    android:layout_height="match_parent"
    android:background="#0F172A">

    <TextView
        android:id="@+id/current_count"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_centerInParent="true"
        android:text="0"
        android:textColor="#D4AF37"
        android:textSize="80sp"
        android:textStyle="bold" />

    <TextView
        android:id="@+id/total_count"
        android:layout_width="wrap_content"
        android:layout_height="wrap_content"
        android:layout_alignParentTop="true"
        android:layout_centerHorizontal="true"
        android:layout_marginTop="50dp"
        android:text="0"
        android:textColor="#FFFFFF"
        android:textSize="20sp" />

    <ImageButton
        android:id="@+id/btn_reset"
        android:layout_width="60dp"
        android:layout_height="60dp"
        android:layout_alignParentBottom="true"
        android:layout_centerHorizontal="true"
        android:layout_marginBottom="60dp"
        android:background="#1E293B"
        android:src="@android:drawable/ic_menu_revert" />

</RelativeLayout>
```

## 3. String Resources
**Path:** `res/values/strings.xml`

```xml
<?xml version="1.0" encoding="utf-8"?>
<resources>
    <string name="app_name">suhaib</string>
</resources>
```

## 4. Main Controller (Java)
**Path:** `src/com/suhaib/wrya/MainActivity.java`

```java
package com.suhaib.wrya;

import android.app.Activity;
import android.os.Bundle;
import android.view.View;
import android.widget.TextView;
import android.content.SharedPreferences;

public class MainActivity extends Activity {
    private int count = 0;
    private int totalCount = 0;
    private TextView countText;
    private TextView totalCountText;
    private SharedPreferences prefs;

    @Override
    protected void onCreate(Bundle savedInstanceState) {
        super.onCreate(savedInstanceState);
        setContentView(R.layout.activity_main);

        prefs = getSharedPreferences("ZikrPrefs", MODE_PRIVATE);
        totalCount = prefs.getInt("total_count", 0);

        countText = (TextView) findViewById(R.id.current_count);
        totalCountText = (TextView) findViewById(R.id.total_count);
        
        if (totalCountText != null) {
            totalCountText.setText(String.valueOf(totalCount));
        }

        View mainLayout = findViewById(R.id.main_layout);
        if (mainLayout != null) {
            mainLayout.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    count++;
                    totalCount++;
                    if (countText != null) countText.setText(String.valueOf(count));
                    if (totalCountText != null) totalCountText.setText(String.valueOf(totalCount));
                    prefs.edit().putInt("total_count", totalCount).apply();
                }
            });
        }

        View btnReset = findViewById(R.id.btn_reset);
        if (btnReset != null) {
            btnReset.setOnClickListener(new View.OnClickListener() {
                @Override
                public void onClick(View v) {
                    count = 0;
                    if (countText != null) countText.setText("0");
                }
            });
        }
    }
}
```

---
### Important Note for AIDE Users:
- **Clean the project:** Go to **Menu** > **Run** > **Clean Project**.
- **No mixed characters:** Always ensure that your files contain exactly the code above.
- **Java Error:** If you see an error related to `wrap_content` in Java, it usually means code from the XML was accidentally pasted into the `.java` file.
