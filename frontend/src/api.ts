export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}
export async function api<T>(
  path: string,
  method = 'GET',
  body?: unknown,
  signal?: AbortSignal,
): Promise<T> {
  const response = await fetch(`/api${path}`, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
    signal,
  });
  if (response.status === 204) return undefined as T;
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = Array.isArray(data.detail)
      ? data.detail
          .map(
            (item: { loc: string[]; msg: string }) => `${item.loc.slice(1).join('.')}: ${item.msg}`,
          )
          .join('; ')
      : data.detail || `Request failed (${response.status})`;
    if (response.status === 401 && !path.startsWith('/auth/'))
      window.dispatchEvent(new Event('moe:session-expired'));
    throw new ApiError(response.status, message);
  }
  return data as T;
}
export function errorMessage(error: unknown) {
  return error instanceof Error ? error.message : 'Something went wrong';
}
export function downloadJson(value: unknown, name: string) {
  const url = URL.createObjectURL(
    new Blob([JSON.stringify(value, null, 2)], { type: 'application/json' }),
  );
  const link = document.createElement('a');
  link.href = url;
  link.download = name;
  link.click();
  URL.revokeObjectURL(url);
}
