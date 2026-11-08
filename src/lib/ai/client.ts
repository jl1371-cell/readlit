/** Browser-side helpers for the app's own API routes. */

export class ApiError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function readError(res: Response): Promise<ApiError> {
  const body = await res.json().catch(() => null);
  return new ApiError(body?.error ?? `Request failed (${res.status}).`, res.status);
}

export async function postJSON<T>(url: string, body: unknown, signal?: AbortSignal): Promise<T> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok) throw await readError(res);
  return (await res.json()) as T;
}

export type StreamEvent =
  | { type: "delta"; text: string }
  | { type: "done"; model?: string }
  | { type: "error"; message: string };

/** POST and read a newline-delimited JSON event stream. */
export async function streamEvents(
  url: string,
  body: unknown,
  onEvent: (e: StreamEvent) => void,
  signal?: AbortSignal,
): Promise<void> {
  const res = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
    signal,
  });
  if (!res.ok || !res.body) throw await readError(res);
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buffer = "";
  for (;;) {
    const { value, done } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let nl: number;
    while ((nl = buffer.indexOf("\n")) >= 0) {
      const line = buffer.slice(0, nl).trim();
      buffer = buffer.slice(nl + 1);
      if (!line) continue;
      try {
        onEvent(JSON.parse(line) as StreamEvent);
      } catch {
        /* ignore a malformed line */
      }
    }
  }
}
