package shop.quetzaltech.drive

import android.app.DownloadManager
import android.content.Context
import android.content.Intent
import android.net.Uri
import android.os.Environment
import android.util.Base64
import android.view.WindowManager
import android.database.Cursor
import android.provider.OpenableColumns
import androidx.activity.result.ActivityResult
import androidx.core.content.FileProvider
import com.getcapacitor.*
import com.getcapacitor.annotation.ActivityCallback
import com.getcapacitor.annotation.CapacitorPlugin
import java.io.*
import java.net.HttpURLConnection
import java.net.URL
import java.security.KeyStore
import java.security.MessageDigest
import java.util.concurrent.ConcurrentHashMap
import java.util.concurrent.Executors
import java.util.concurrent.atomic.AtomicBoolean
import javax.crypto.Cipher
import javax.crypto.KeyGenerator
import javax.crypto.SecretKey
import javax.crypto.spec.GCMParameterSpec

@CapacitorPlugin(name = "NativeDrive")
class NativeDrivePlugin : Plugin() {
    private val executor = Executors.newCachedThreadPool()
    private val cancellations = ConcurrentHashMap<String, AtomicBoolean>()
    private val connections = ConcurrentHashMap<String, HttpURLConnection>()
    private val prefs by lazy { getContext().getSharedPreferences("drive_secure", Context.MODE_PRIVATE) }
    private val alias = "quetzaltech-drive-device-token"
    @Volatile private var keepAwakeRequested = false

    @PluginMethod fun getToken(call: PluginCall) {
        try { call.resolve(JSObject().put("token", decrypt(prefs.getString("token", null)))) }
        catch (_: Exception) { prefs.edit().remove("token").apply(); call.resolve(JSObject().put("token", "")) }
    }
    @PluginMethod fun setToken(call: PluginCall) {
        val token = call.getString("token")
        if (token.isNullOrBlank()) { call.reject("Token inválido"); return }
        try { prefs.edit().putString("token", encrypt(token)).apply(); call.resolve() }
        catch (_: Exception) { call.reject("No se pudo guardar el acceso seguro") }
    }
    @PluginMethod fun clearToken(call: PluginCall) { prefs.edit().remove("token").apply(); call.resolve() }

    @PluginMethod fun pickMedia(call: PluginCall) {
        val intent = Intent(Intent.ACTION_OPEN_DOCUMENT).apply {
            addCategory(Intent.CATEGORY_OPENABLE); type = "*/*"
            putExtra(Intent.EXTRA_MIME_TYPES, arrayOf("image/jpeg", "image/png", "image/webp", "image/gif", "image/avif", "image/heic", "image/heif", "video/mp4", "video/quicktime", "video/webm"))
            putExtra(Intent.EXTRA_ALLOW_MULTIPLE, true)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION or Intent.FLAG_GRANT_PERSISTABLE_URI_PERMISSION)
        }
        startActivityForResult(call, intent, "pickerResult")
    }
    @ActivityCallback private fun pickerResult(call: PluginCall?, result: ActivityResult) {
        if (call == null) return
        val data = result.data
        if (result.resultCode != android.app.Activity.RESULT_OK || data == null) { call.resolve(JSObject().put("items", JSArray())); return }
        val uris = mutableListOf<Uri>()
        data.clipData?.let { clip -> for (i in 0 until clip.itemCount) clip.getItemAt(i).uri?.let(uris::add) }
        if (uris.isEmpty()) data.data?.let(uris::add)
        val items = JSArray()
        for (uri in uris.distinct()) {
            try { getContext().contentResolver.takePersistableUriPermission(uri, Intent.FLAG_GRANT_READ_URI_PERMISSION) } catch (_: Exception) { }
            val (name, size) = metadata(uri)
            items.put(JSObject().put("id", uri.toString()).put("uri", uri.toString()).put("name", name).put("size", size).put("mimeType", getContext().contentResolver.getType(uri) ?: "application/octet-stream"))
        }
        call.resolve(JSObject().put("items", items))
    }

    @PluginMethod fun upload(call: PluginCall) {
        val uploadId = call.getString("uploadId") ?: call.callbackId
        val uri = call.getString("uri"); val endpoint = call.getString("endpoint"); val key = call.getString("idempotencyKey")
        if (uri == null || endpoint == null || key == null) { call.reject("Datos de subida incompletos"); return }
        val base = try { URL(endpoint) } catch (_: Exception) { call.reject("Dirección del servidor inválida"); return }
        if (base.protocol != "https") { call.reject("La aplicación solo permite subir por HTTPS"); return }
        val cancelled = AtomicBoolean(false); cancellations[uploadId] = cancelled
        executor.execute {
            var connection: HttpURLConnection? = null
            try {
                val fileUri = Uri.parse(uri); val (name, size) = metadata(fileUri)
                val digest = MessageDigest.getInstance("SHA-256")
                getContext().contentResolver.openInputStream(fileUri).use { input ->
                    if (input == null) throw IOException("El archivo seleccionado ya no está disponible")
                    val buffer = ByteArray(64 * 1024); var count: Int
                    while (input.read(buffer).also { count = it } >= 0) { if (cancelled.get()) throw InterruptedIOException("Subida cancelada"); digest.update(buffer, 0, count) }
                }
                val sha = digest.digest().joinToString("") { "%02x".format(it) }
                val boundary = "QTD${System.nanoTime()}${uploadId.hashCode()}"; val mime = getContext().contentResolver.getType(fileUri) ?: "application/octet-stream"
                val safe = name.replace("\\", "_").replace("\"", "_").replace("\r", "_").replace("\n", "_")
                val prefix = "--$boundary\r\nContent-Disposition: form-data; name=\"file\"; filename=\"$safe\"\r\nContent-Type: $mime\r\n\r\n".toByteArray(Charsets.UTF_8)
                val suffix = "\r\n--$boundary--\r\n".toByteArray(Charsets.UTF_8)
                val token = decrypt(prefs.getString("token", null)) ?: throw IOException("Vincula de nuevo este dispositivo")
                connection = (base.openConnection() as HttpURLConnection).apply {
                    requestMethod = "POST"; doOutput = true; connectTimeout = 30_000; readTimeout = 120_000
                    setRequestProperty("Authorization", "Bearer $token"); setRequestProperty("Content-Type", "multipart/form-data; boundary=$boundary")
                    setRequestProperty("Idempotency-Key", key); setRequestProperty("X-File-SHA256", sha); setRequestProperty("X-File-Size", size.toString())
                    setFixedLengthStreamingMode(prefix.size.toLong() + size + suffix.size)
                }
                connections[uploadId] = connection
                connection.outputStream.use { out ->
                    out.write(prefix); var sent = 0L; val buffer = ByteArray(64 * 1024)
                    getContext().contentResolver.openInputStream(fileUri).use { input ->
                        if (input == null) throw IOException("El archivo seleccionado ya no está disponible")
                        var count: Int
                        while (input.read(buffer).also { count = it } >= 0) {
                            if (cancelled.get()) throw InterruptedIOException("Subida cancelada")
                            out.write(buffer, 0, count); sent += count
                            notifyListeners("uploadProgress", JSObject().put("uploadId", uploadId).put("sent", sent).put("total", size))
                        }
                    }
                    out.write(suffix)
                }
                val status = connection.responseCode; val response = (if (status in 200..299) connection.inputStream else connection.errorStream)?.bufferedReader()?.use { it.readText() } ?: "{}"
                if (status !in 200..299) {
                    val error = try { JSObject(response).getJSObject("error")?.getString("message") } catch (_: Exception) { null }
                    throw IOException(error ?: "La subida falló ($status)")
                }
                val assetId = JSObject(response).getString("id") ?: throw IOException("El servidor no confirmó el archivo")
                call.resolve(JSObject().put("assetId", assetId))
            } catch (e: Exception) { call.reject(e.message ?: "La subida falló", e) }
            finally { connections.remove(uploadId); connection?.disconnect(); cancellations.remove(uploadId) }
        }
    }
    @PluginMethod fun cancelUpload(call: PluginCall) { val id=call.getString("uploadId"); cancellations[id]?.set(true); connections[id]?.disconnect(); call.resolve() }
    @PluginMethod fun keepScreenAwake(call: PluginCall) {
        val enabled = call.getBoolean("enabled") ?: false
        keepAwakeRequested = enabled
        getActivity().runOnUiThread {
            if (enabled) getActivity().window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            else getActivity().window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON)
            call.resolve()
        }
    }
    override fun handleOnPause() { getActivity().window.clearFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
    override fun handleOnResume() { if (keepAwakeRequested) getActivity().window.addFlags(WindowManager.LayoutParams.FLAG_KEEP_SCREEN_ON) }
    @PluginMethod fun download(call: PluginCall) {
        val url = call.getString("url") ?: run { call.reject("Falta el enlace temporal"); return }
        val name = call.getString("name") ?: "archivo"
        try {
            val parsed = Uri.parse(url); if (parsed.scheme != "https") throw IllegalArgumentException()
            val token = decrypt(prefs.getString("token", null))
            val request = DownloadManager.Request(parsed).setTitle(name).setDescription("QuetzalTech Drive")
                .setNotificationVisibility(DownloadManager.Request.VISIBILITY_VISIBLE_NOTIFY_COMPLETED)
                .setDestinationInExternalFilesDir(getContext(), Environment.DIRECTORY_DOWNLOADS, safeName(name))
            if (token != null && parsed.host != "localhost") request.addRequestHeader("Authorization", "Bearer $token")
            val id = (getContext().getSystemService(Context.DOWNLOAD_SERVICE) as DownloadManager).enqueue(request)
            call.resolve(JSObject().put("downloadId", id))
        } catch (_: Exception) { call.reject("No se pudo iniciar la descarga") }
    }
    @PluginMethod fun share(call: PluginCall) {
        val url = call.getString("url") ?: run { call.reject("Falta el enlace temporal"); return }
        val name = call.getString("name") ?: "archivo"; val mime = call.getString("mimeType") ?: "application/octet-stream"
        executor.execute {
            try {
                val parsed = URL(url); if (parsed.protocol != "https") throw IOException("Solo se permiten enlaces HTTPS")
                val file = File(getContext().cacheDir, safeName(name)); parsed.openStream().use { input -> file.outputStream().use { input.copyTo(it) } }
                val content = FileProvider.getUriForFile(getContext(), "${getContext().packageName}.fileprovider", file)
                val intent = Intent(Intent.ACTION_SEND).setType(mime).putExtra(Intent.EXTRA_STREAM, content).addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
                getActivity().runOnUiThread { getActivity().startActivity(Intent.createChooser(intent, "Compartir archivo")); call.resolve() }
            } catch (e: Exception) { call.reject("No se pudo preparar el archivo para compartir", e) }
        }
    }

    private fun metadata(uri: Uri): Pair<String, Long> {
        var name = "archivo"; var size = -1L
        getContext().contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME, OpenableColumns.SIZE), null, null, null)?.use { c: Cursor ->
            if (c.moveToFirst()) {
                c.getColumnIndex(OpenableColumns.DISPLAY_NAME).takeIf { it >= 0 }?.let { name = c.getString(it) ?: name }
                c.getColumnIndex(OpenableColumns.SIZE).takeIf { it >= 0 }?.let { size = c.getLong(it) }
            }
        }
        if (size < 0) getContext().contentResolver.openAssetFileDescriptor(uri, "r")?.use { size = it.length }
        if (size < 0) throw IOException("No se pudo determinar el tamaño del archivo")
        return name to size
    }
    private fun safeName(value: String) = value.replace(Regex("[^A-Za-z0-9._-]"), "_").take(180).ifBlank { "archivo" }
    private fun secretKey(): SecretKey {
        val store = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }
        (store.getKey(alias, null) as? SecretKey)?.let { return it }
        return KeyGenerator.getInstance("AES", "AndroidKeyStore").apply { init(android.security.keystore.KeyGenParameterSpec.Builder(alias, android.security.keystore.KeyProperties.PURPOSE_ENCRYPT or android.security.keystore.KeyProperties.PURPOSE_DECRYPT).setBlockModes("GCM").setEncryptionPaddings("NoPadding").build()) }.generateKey()
    }
    private fun encrypt(value: String): String {
        val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.ENCRYPT_MODE, secretKey())
        val iv = Base64.encodeToString(cipher.iv, Base64.NO_WRAP); val data = Base64.encodeToString(cipher.doFinal(value.toByteArray(Charsets.UTF_8)), Base64.NO_WRAP)
        return "$iv:$data"
    }
    private fun decrypt(value: String?): String? {
        if (value.isNullOrBlank()) return null
        val parts = value.split(":", limit = 2); if (parts.size != 2) return null
        val cipher = Cipher.getInstance("AES/GCM/NoPadding"); cipher.init(Cipher.DECRYPT_MODE, secretKey(), GCMParameterSpec(128, Base64.decode(parts[0], Base64.NO_WRAP)))
        return String(cipher.doFinal(Base64.decode(parts[1], Base64.NO_WRAP)), Charsets.UTF_8)
    }
}
