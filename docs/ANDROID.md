# Android personal

La plataforma Capacitor 8.5.2 está en `android/`; el `webDir` empaqueta `web/dist` y no configura `server.url`. El puente nativo Kotlin abre el selector SAF múltiple, conserva permisos URI cuando Android lo permite, calcula SHA-256 y transmite `content://` a disco sin cargar videos completos en JavaScript. Android Keystore cifra el token del dispositivo en preferencias privadas. Mantén la app en primer plano al subir; una interrupción queda como fallida y se reintenta con la misma clave idempotente.

## API y CORS

Define `VITE_API_BASE_URL=https://<origen-del-servicio>` antes de `npm run android:sync`; esta URL queda incorporada al bundle de la app y no debe contener secretos. Añade el origen exacto de Capacitor Android a `ANDROID_ORIGINS` del servidor (normalmente `https://localhost`); no uses comodines. Recompila la web y sincroniza tras cambiar la URL. La app rechaza conexiones sin HTTPS.

## Build local

Requiere Node 22+, Android Studio 2025.2.1 o posterior y un SDK Android API 24+. Usa el JDK integrado por Android Studio. `npm run android:add` solo se ejecuta una vez sobre una carpeta `android/` inexistente; después usa `npm run android:sync`. Abre con `npm run android:open` o compila para depuración desde PowerShell:

```powershell
$env:JAVA_HOME = 'C:\Program Files\Android\Android Studio\jbr'
$env:VITE_API_BASE_URL = 'https://<origen-del-servicio>'
npm run android:sync
Push-Location android
./gradlew.bat assembleDebug
Pop-Location
```

Para `assembleRelease`, configura un keystore persistente, respaldado y externo al repositorio antes de añadir `signingConfig` a Gradle. No se incluye contraseña, clave ni una firma de ejemplo. Una actualización debe usar el mismo certificado de firma que la instalación anterior y aumentar `versionCode`. No publiques APKs de depuración como releases.

La cola de subidas conserva metadatos, URI persistidas cuando el proveedor las autoriza y la misma clave de reintento. Si Android perdió el permiso URI, selecciona otra vez el archivo; no se declara un upload completado sin confirmación del servidor. Las descargas usan DownloadManager con progreso/notificación del sistema; compartir obtiene un ticket temporal y entrega un `content://` con FileProvider. Desvincular revoca el token del dispositivo.

La aceptación de pairing, reapertura, subida mixta, caída de red, pantalla activa, visor y descargas requiere ejecutar en un emulador o dispositivo Android conectado. Registrar el modelo/API y el SHA-256 de la APK en `STATUS.md`; la generación del proyecto por sí sola no cuenta como prueba de dispositivo.
