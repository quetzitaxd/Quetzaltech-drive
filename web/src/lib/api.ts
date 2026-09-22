import { Capacitor } from '@capacitor/core';
import { currentDeviceToken } from '../adapters/native';
const base = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
let csrfToken = '';
export const apiBase = base;
export const authEvents = new EventTarget();
export class ApiError extends Error {
  constructor(public status: number, public code: string, message: string) { super(message); }
}
export function setCsrfToken(value: string) { csrfToken = value; }
export function getCsrfToken() { return csrfToken; }
export async function api<T>(path: string, options: RequestInit = {}, csrf = false): Promise<T> {
  if (Capacitor.isNativePlatform() && (!base || !/^https:\/\//i.test(base))) throw new Error('Configura VITE_API_BASE_URL con la dirección HTTPS de tu servidor antes de compilar la APK.');
  const headers = new Headers(options.headers);
  if (options.body && !(options.body instanceof FormData) && !headers.has('Content-Type')) headers.set('Content-Type', 'application/json');
  if (csrf && csrfToken) headers.set('x-csrf-token', csrfToken);
  if (Capacitor.isNativePlatform() && currentDeviceToken()) headers.set('Authorization', `Bearer ${currentDeviceToken()}`);
  const response = await fetch(`${base}${path}`, { ...options, headers, credentials: Capacitor.isNativePlatform() ? 'omit' : 'include' });
  if (response.status === 401 && !path.endsWith('/auth/login') && !path.endsWith('/auth/session')) authEvents.dispatchEvent(new Event('unauthorized'));
  if (!response.ok) {
    let code = 'REQUEST_FAILED'; let message = `La solicitud falló (${response.status}).`;
    try { const body = await response.json(); code = body.error?.code ?? code; message = body.error?.message ?? message; } catch { /* keep safe fallback */ }
    throw new ApiError(response.status, code, message);
  }
  if (response.status === 204) return undefined as T;
  return response.json() as Promise<T>;
}
export function assetUrl(id: string, kind: 'content'|'thumbnail'|'download') {
  return `${base}/api/assets/${encodeURIComponent(id)}/${kind}`;
}
export function productZipUrl(id: string) { return `${base}/api/products/${encodeURIComponent(id)}/download.zip`; }

export type Product = { id:string; name:string; code:string|null; coverAssetId:string|null; createdAt:string; assetCount:number };
export type Asset = { id:string; productId:string; originalName:string; assignedName:string; mimeType:string; sizeBytes:number; sortOrder:number; thumbnailStatus:'pending'|'ready'|'unsupported'|'failed'; createdAt:string; sha256:string; playbackStatus:'pending'|'playable'|'download_only'|'not_applicable' };
export type Page<T> = {items:T[]; total:number; page:number; pageSize:number};
export type Device = {id:string; name:string; createdAt:string; revokedAt:string|null};
export async function ticket(id:string, scope:'content'|'thumbnail'|'download') {
  return api<{url:string;expiresAt:string}>(`/api/assets/${encodeURIComponent(id)}/ticket`, {method:'POST',body:JSON.stringify({scope})}, true);
}
