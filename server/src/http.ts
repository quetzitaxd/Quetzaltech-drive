export class HttpError extends Error {
  constructor(public statusCode: number, public code: string, message: string) { super(message); }
}
export function objectBody(value: unknown, allowed: string[]): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).some(k => !allowed.includes(k))) {
    throw new HttpError(400, 'VALIDATION', 'Campos no válidos.');
  }
  return value as Record<string, unknown>;
}
export function textField(value: unknown, max: number, required = true): string {
  if (typeof value !== 'string' || value.length > max || /[\u0000-\u001f\u007f]/u.test(value) || (required && !value.trim())) {
    throw new HttpError(400, 'VALIDATION', 'Texto no válido.');
  }
  return value.trim();
}
