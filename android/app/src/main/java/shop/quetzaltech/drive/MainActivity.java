package shop.quetzaltech.drive;

import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override public void onCreate(android.os.Bundle savedInstanceState) {
        registerPlugin(NativeDrivePlugin.class);
        super.onCreate(savedInstanceState);
    }
}
