import { useCallback } from 'react';
import {
  discoveryApiRef,
  fetchApiRef,
  useApi,
} from '@backstage/core-plugin-api';

/**
 * Authenticated Server-Sent Events reader for Backstage backend plugins.
 *
 * The browser `EventSource` API cannot send request headers, so it can never
 * carry the Backstage identity token. Every backend route guarded by
 * `httpAuth.credentials({ allow: ['user'] })` therefore rejects an
 * `EventSource` connection with `401 Unauthorized` — which is exactly what
 * happened to the deployment / workspace / GPU log streams.
 *
 * This hook streams the same `text/event-stream` response over `fetchApi`
 * (which injects the identity token) and parses the SSE frames by hand, so the
 * stream authenticates like any other backend call.
 */

export interface BackendStreamEvent {
  /** SSE `event:` name; defaults to `message` when the server omits it. */
  event: string;
  /** Raw `data:` payload (multi-line payloads are joined with `\n`). */
  data: string;
  /** SSE `id:` field when present. */
  id?: string;
}

export interface OpenBackendStreamOptions {
  pluginId: string;
  path: string;
  /** Query parameters; entries with an undefined/null value are skipped. */
  query?: Record<string, string | null | undefined>;
  onEvent: (event: BackendStreamEvent) => void;
  /** Called once the response headers arrive with a 2xx status. */
  onOpen?: () => void;
  signal?: AbortSignal;
}

class BackendStreamError extends Error {
  readonly status: number;

  constructor(message: string, status: number) {
    super(message);
    this.name = 'BackendStreamError';
    this.status = status;
  }
}

// `activePersona` removed — no longer forwarding development persona.

/**
 * Parse one SSE frame (the text between two blank lines) into an event.
 * Returns null for comment-only frames (heartbeats) and frames with no data.
 */
function parseFrame(frame: string): BackendStreamEvent | null {
  let event = 'message';
  let id: string | undefined;
  const dataLines: string[] = [];

  for (const rawLine of frame.split('\n')) {
    const line = rawLine.endsWith('\r') ? rawLine.slice(0, -1) : rawLine;
    if (line.length === 0 || line.startsWith(':')) {
      // Blank line or comment (`: heartbeat`) — nothing to collect.
      continue;
    }
    const colon = line.indexOf(':');
    const field = colon === -1 ? line : line.slice(0, colon);
    let value = colon === -1 ? '' : line.slice(colon + 1);
    if (value.startsWith(' ')) {
      value = value.slice(1);
    }

    if (field === 'event') {
      event = value;
    } else if (field === 'data') {
      dataLines.push(value);
    } else if (field === 'id') {
      id = value;
    }
    // `retry:` is meaningless here — reconnection is the caller's decision.
  }

  if (dataLines.length === 0) {
    return null;
  }
  return { event, data: dataLines.join('\n'), id };
}

export function useBackendEventStream() {
  const discoveryApi = useApi(discoveryApiRef);
  const fetchApi = useApi(fetchApiRef);

  return useCallback(
    async (options: OpenBackendStreamOptions): Promise<void> => {
      const baseUrl = await discoveryApi.getBaseUrl(options.pluginId);
      const suffix = options.path.startsWith('/')
        ? options.path
        : `/${options.path}`;
      const url = new URL(`${baseUrl}${suffix}`);
      for (const [key, value] of Object.entries(options.query ?? {})) {
        if (value !== undefined && value !== null && value !== '') {
          url.searchParams.set(key, value);
        }
      }

      const response = await fetchApi.fetch(url.toString(), {
        method: 'GET',
        headers: {
          Accept: 'text/event-stream',
          'Cache-Control': 'no-cache',
        },
        cache: 'no-store',
        signal: options.signal,
      });

      if (!response.ok) {
        let detail = response.statusText;
        try {
          const text = await response.text();
          if (text) {
            try {
              detail = JSON.parse(text)?.error ?? text;
            } catch {
              detail = text;
            }
          }
        } catch {
          // Body unreadable — keep the status text.
        }
        throw new BackendStreamError(
          `Log stream request failed (${response.status}): ${detail}`,
          response.status,
        );
      }

      if (!response.body) {
        // Some runtimes (jsdom, very old Safari) expose no readable body.
        throw new BackendStreamError(
          'This browser cannot read streaming responses.',
          0,
        );
      }

      options.onOpen?.();

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';

      const drain = (flush: boolean) => {
        // SSE frames are separated by a blank line; tolerate CRLF endings.
        let boundary = buffer.search(/\r?\n\r?\n/);
        while (boundary !== -1) {
          const frame = buffer.slice(0, boundary);
          const match = /\r?\n\r?\n/.exec(buffer.slice(boundary));
          buffer = buffer.slice(boundary + (match?.[0].length ?? 2));
          const parsed = parseFrame(frame);
          if (parsed) {
            options.onEvent(parsed);
          }
          boundary = buffer.search(/\r?\n\r?\n/);
        }
        if (flush && buffer.trim().length > 0) {
          const parsed = parseFrame(buffer);
          buffer = '';
          if (parsed) {
            options.onEvent(parsed);
          }
        }
      };

      const abortHandler = () => {
        void reader.cancel().catch(() => {});
      };
      options.signal?.addEventListener('abort', abortHandler, { once: true });

      try {
        for (;;) {
          const { value, done } = await reader.read();
          if (done) {
            buffer += decoder.decode();
            drain(true);
            return;
          }
          buffer += decoder.decode(value, { stream: true });
          drain(false);
        }
      } finally {
        options.signal?.removeEventListener('abort', abortHandler);
      }
    },
    [discoveryApi, fetchApi],
  );
}

export { BackendStreamError };
