import { Capacitor, registerPlugin } from '@capacitor/core';
import type { PickedMedia } from './types';

type NativeDrivePlugin = {
  getToken(): Promise<{token:string}>; setToken(options:{token:string}):Promise<void>; clearToken():Promise<void>;
  pickMedia():Promise<{items:PickedMedia[]}>;
  upload(options:{uploadId:string;uri:string;endpoint:string;idempotencyKey:string}):Promise<{assetId:string}>;
  cancelUpload(options:{uploadId:string}):Promise<void>;
  keepScreenAwake(options:{enabled:boolean}):Promise<void>;
  download(options:{url:string;name:string}):Promise<{downloadId:number}>;
  share(options:{url:string;name:string;mimeType:string}):Promise<void>;
  addListener(event:'uploadProgress', listener:(event:{uploadId:string;sent:number;total:number})=>void):Promise<{remove:()=>Promise<void>}>
};
export const NativeDrive = registerPlugin<NativeDrivePlugin>('NativeDrive');
export const isAndroid = Capacitor.getPlatform() === 'android';
let bearerToken = '';
export async function restoreDeviceToken() { bearerToken = (await NativeDrive.getToken()).token; return bearerToken; }
export function currentDeviceToken() { return bearerToken; }
export async function saveDeviceToken(token:string) { await NativeDrive.setToken({token}); bearerToken=token; }
export async function clearDeviceToken() { bearerToken=''; await NativeDrive.clearToken(); }
