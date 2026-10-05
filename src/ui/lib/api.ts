// JSON API client. Errors carry the HTTP status and the server's message, which is written for people.
export class ApiError extends Error {
  readonly status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export const SIGNED_OUT_EVENT = 'snapquote:signed-out';

async function parse<T>(res: Response): Promise<T> {
  const text = await res.text();
  let body: unknown = null;
  try {
    body = text ? JSON.parse(text) : null;
  } catch {
    throw new ApiError(res.status, text || res.statusText);
  }
  if (!res.ok) {
    if (res.status === 401) window.dispatchEvent(new Event(SIGNED_OUT_EVENT));
    throw new ApiError(res.status, (body as { error?: string } | null)?.error ?? res.statusText);
  }
  return body as T;
}

const json = (method: string) => async <T = any>(path: string, payload: unknown = {}): Promise<T> =>
  parse<T>(await fetch(`/api${path}`, { method, headers: { 'content-type': 'application/json', accept: 'application/json' }, body: JSON.stringify(payload) }));

export const get = async <T = any>(path: string): Promise<T> => parse<T>(await fetch(`/api${path}`, { headers: { accept: 'application/json' } }));
export const post = json('POST');
export const put = json('PUT');
export const patch = json('PATCH');
export const del = async <T = any>(path: string): Promise<T> => parse<T>(await fetch(`/api${path}`, { method: 'DELETE', headers: { accept: 'application/json' } }));

export async function upload<T = any>(path: string, file: File): Promise<T> {
  return parse<T>(await fetch(`/api${path}${path.includes('?') ? '&' : '?'}name=${encodeURIComponent(file.name)}`, {
    method: 'POST', headers: { 'content-type': 'application/octet-stream', accept: 'application/json' }, body: file,
  }));
}

export const message = (err: unknown): string => (err instanceof Error ? err.message : String(err));
