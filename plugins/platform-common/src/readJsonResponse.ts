/**
 * Defensive JSON reader for backend responses.
 *
 * Backend plugin routes always answer with JSON, but the request may never
 * reach them: nginx / Azure App Service replies with its own HTML page when the
 * backend times out, restarts, or the route does not exist. Calling
 * `response.json()` on that page fails with the opaque
 * `Unexpected token '<', "<html> <h"... is not valid JSON`, which hides the
 * real failure. This helper turns those bodies into an actionable message and
 * tolerates empty bodies (204 / no-content responses).
 */

function httpLabel(response: Response): string {
  return response.statusText
    ? `HTTP ${response.status} ${response.statusText}`
    : `HTTP ${response.status}`;
}

export function nonJsonResponseMessage(response: Response): string {
  if (response.status === 401 || response.status === 403) {
    return `Not authorized (${httpLabel(
      response,
    )}). Your session may have expired — reload the page and sign in again.`;
  }
  if (response.status === 404) {
    return `Endpoint not found (${httpLabel(
      response,
    )}). The backend does not expose this route — it is likely running an older version.`;
  }
  if (response.status >= 500 || response.status === 0) {
    return `The backend is unavailable (${httpLabel(
      response,
    )}). The gateway returned an error page instead of a response; retry in a moment.`;
  }
  return `Unexpected non-JSON response from the server (${httpLabel(
    response,
  )}).`;
}

/**
 * Parse a response body as JSON. Returns `{}` for an empty successful body and
 * throws an explanatory Error when the body is not JSON.
 */
export async function readJsonResponse<T = any>(
  response: Response,
): Promise<T> {
  const raw = (await response.text()).trim();
  if (!raw) {
    if (response.ok) {
      return {} as T;
    }
    throw new Error(nonJsonResponseMessage(response));
  }
  try {
    return JSON.parse(raw) as T;
  } catch {
    throw new Error(nonJsonResponseMessage(response));
  }
}

/**
 * Read a JSON body and throw when the response is not `ok`, using the backend's
 * `error` field when present and a gateway-aware message otherwise.
 */
export async function readJsonOrThrow<T = any>(
  response: Response,
  fallbackMessage: string,
): Promise<T> {
  const data = await readJsonResponse<T & { error?: string }>(response);
  if (!response.ok) {
    throw new Error(
      data?.error ?? `${fallbackMessage} (${httpLabel(response)})`,
    );
  }
  return data;
}
