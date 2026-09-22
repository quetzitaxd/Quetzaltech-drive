import type { PlatformAdapter, UploadRequest } from './types';
import { NativeDrive } from './native';
import { apiBase, ticket } from '../lib/api';

let keepAwakeRefs=0;
export const androidAdapter: PlatformAdapter = {
  async pickMedia() { return (await NativeDrive.pickMedia()).items; },
  async upload(request:UploadRequest, signal:AbortSignal, onProgress:(sent:number,total:number)=>void) {
    const uri=request.media.uri;
    if(!uri) throw new Error('Vuelve a seleccionar este archivo para continuar la subida.');
    const uploadId=request.media.id;
    const listener=await NativeDrive.addListener('uploadProgress', event=>{if(event.uploadId===uploadId)onProgress(event.sent,event.total)});
    const cancel=()=>{void NativeDrive.cancelUpload({uploadId})}; signal.addEventListener('abort',cancel,{once:true});
    try {
      const url=new URL(`/api/products/${encodeURIComponent(request.productId)}/assets`,apiBase||location.origin);
      if(url.protocol!=='https:') throw new Error('Configura una dirección HTTPS segura del servidor para la app Android.');
      return await NativeDrive.upload({uploadId,uri,endpoint:url.href,idempotencyKey:request.idempotencyKey});
    } catch(error) { if(signal.aborted)throw new DOMException('Subida cancelada','AbortError'); throw error;
    } finally {signal.removeEventListener('abort',cancel);await listener.remove();}
  },
  async keepScreenAwake(enabled) { keepAwakeRefs=Math.max(0,keepAwakeRefs+(enabled?1:-1)); await NativeDrive.keepScreenAwake({enabled:keepAwakeRefs>0}); },
  async download(assetId,name=assetId) { const url=new URL(`/api/assets/${encodeURIComponent(assetId)}/download`,apiBase||location.origin); if(url.protocol!=='https:')throw new Error('La descarga requiere configurar la API con HTTPS.'); await NativeDrive.download({url:url.href,name}); },
  async share(assetId,name=assetId,mimeType='application/octet-stream') { const t=await ticket(assetId,'download'); await NativeDrive.share({url:new URL(t.url,apiBase||location.origin).href,name,mimeType}); },
};
export async function downloadProductZip(productId:string,name:string) {
  const url=new URL(`/api/products/${encodeURIComponent(productId)}/download.zip`,apiBase||location.origin);
  if(url.protocol!=='https:')throw new Error('La descarga requiere configurar la API con HTTPS.');
  await NativeDrive.download({url:url.href,name:`${name}.zip`});
}
