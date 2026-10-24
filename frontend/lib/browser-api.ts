export type BrowserApiPayload<T = unknown> = {
  data?: T;
  error?: { message?: string };
};

/**
 * Parse same-origin API responses defensively. Reverse-proxy and upstream
 * failures can return HTML; exposing JSON parser syntax errors to candidates
 * hides the actual recovery action.
 */
export async function readBrowserApiPayload<T = unknown>(response: Response): Promise<BrowserApiPayload<T>> {
  const contentType = response.headers.get('content-type') || '';
  if (!contentType.toLowerCase().includes('application/json')) {
    throw new Error(response.ok
      ? 'The service returned an unexpected response. Please try again.'
      : 'The service is temporarily unavailable. Please try again.');
  }
  try {
    return await response.json() as BrowserApiPayload<T>;
  } catch {
    throw new Error(response.ok
      ? 'The service returned an invalid response. Please try again.'
      : 'The service is temporarily unavailable. Please try again.');
  }
}
