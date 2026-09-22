/** Contrato compartido por el navegador y el adaptador Android. */
export interface PickedMedia { id: string; name: string; size: number; mimeType: string; uri?: string; file?: File; sha256?:string; csrfToken?:string; }
export interface UploadRequest { productId: string; idempotencyKey: string; media: PickedMedia; }
export interface PlatformAdapter {
  pickMedia(): Promise<PickedMedia[]>;
  upload(request: UploadRequest, signal: AbortSignal, onProgress: (sent: number, total: number) => void): Promise<{assetId:string}>;
  keepScreenAwake(enabled: boolean): Promise<void>;
  download(assetId: string, name?: string): Promise<void>;
  share(assetId: string, name?: string, mimeType?: string): Promise<void>;
}
