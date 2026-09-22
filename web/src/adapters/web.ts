import type { PlatformAdapter, UploadRequest } from './types';
import { api, apiBase, authEvents, getCsrfToken } from '../lib/api';

function xhrUpload(request: UploadRequest, signal: AbortSignal, progress: (sent:number,total:number)=>void): Promise<{assetId:string}> {
  const file = request.media.file;
  if (!file) return Promise.reject(new Error('El archivo ya no está disponible en esta sesión.'));
  return new Promise((resolve,reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', `${apiBase}/api/products/${encodeURIComponent(request.productId)}/assets`);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Idempotency-Key', request.idempotencyKey);
    xhr.setRequestHeader('X-File-SHA256', request.media.sha256 ?? '');
    xhr.setRequestHeader('X-File-Size', String(file.size));
    xhr.setRequestHeader('x-csrf-token', request.media.csrfToken ?? getCsrfToken());
    xhr.upload.onprogress = event => progress(event.loaded, event.lengthComputable ? event.total : file.size);
    xhr.onload = () => {
      if (xhr.status === 401) authEvents.dispatchEvent(new Event('unauthorized'));
      if (xhr.status >= 200 && xhr.status < 300) {
        try { resolve({assetId:JSON.parse(xhr.responseText).id}); } catch { reject(new Error('El servidor respondió sin confirmar el archivo.')); }
      } else {
        let message = `La subida falló (${xhr.status}).`;
        try { message = JSON.parse(xhr.responseText).error?.message ?? message; } catch { /* safe fallback */ }
        reject(Object.assign(new Error(message), {status:xhr.status}));
      }
    };
    xhr.onerror = () => reject(new Error('Se perdió la conexión durante la subida.'));
    xhr.onabort = () => reject(new DOMException('Subida cancelada','AbortError'));
    const abort = () => xhr.abort();
    signal.addEventListener('abort', abort, {once:true});
    xhr.onloadend = () => signal.removeEventListener('abort',abort);
    const body = new FormData(); body.append('file',file,file.name); xhr.send(body);
  });
}

export const webAdapter: PlatformAdapter = {
  async pickMedia() { throw new Error('Selecciona los archivos desde el botón de la página.'); },
  async upload(request, signal, progress) { return xhrUpload(request, signal, progress); },
  async keepScreenAwake(enabled) {
    if (enabled) throw new Error('El navegador no garantiza mantener la pantalla activa.');
  },
  async download(assetId) { window.location.assign(`${apiBase}/api/assets/${encodeURIComponent(assetId)}/download`); },
  async share(assetId) {
    const result = await api<{url:string;expiresAt:string}>(`/api/assets/${encodeURIComponent(assetId)}/ticket`,{method:'POST',body:JSON.stringify({scope:'download'})},true);
    const url = new URL(result.url,apiBase||location.origin).href;
    if (navigator.share) await navigator.share({url}); else await navigator.clipboard.writeText(url);
  },
};
