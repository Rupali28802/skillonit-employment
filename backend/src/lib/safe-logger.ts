type LogLevel = 'info' | 'warn' | 'error';
type Scalar = string | number | boolean | null | undefined;
const safeFields = new Set(['correlationId', 'event', 'method', 'routeGroup', 'status', 'statusClass', 'classification', 'code', 'stage', 'durationMs', 'retryable', 'incomingSessionCookie', 'cookiePresent', 'authenticated', 'startedAuthenticated', 'sameAccount', 'credentialUnchanged', 'googleEmailMatches', 'sessionCookieSet', 'secure', 'httpOnly', 'sameSiteLax', 'operation', 'failed', 'scanStatus', 'extractionStatus', 'task', 'final', 'schedules']);
const secretPattern = /(?:bearer\s+[a-z0-9._~+\/-]+|basic\s+[a-z0-9+/=]+|mongodb(?:\+srv)?:\/\/[^\s]+|(?:password|secret|token|authorization|cookie|api[_-]?key)\s*[=:]\s*[^\s,;]+)/gi;
function clean(value: Scalar) { return typeof value === 'string' ? value.replace(secretPattern, '[REDACTED]').replace(/[\r\n\t]/g, ' ').slice(0, 200) : value; }

/** Emits one-line JSON with an explicit field allowlist; bodies and headers are never accepted. */
export function safeLog(level: LogLevel, event: string, fields: Record<string, Scalar> = {}) {
  const data: Record<string, Scalar> = { timestamp: new Date().toISOString(), level, event: clean(event) };
  for (const [key, value] of Object.entries(fields)) if (safeFields.has(key) && value !== undefined) data[key] = clean(value);
  console[level](JSON.stringify(data));
}
