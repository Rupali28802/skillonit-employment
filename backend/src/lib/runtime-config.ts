export function demoEnabled(env = process.env) {
  if (env.DEMO_MODE !== 'true') return false;
  const loopback = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);
  let localOrigin = false;
  try {
    const origin = new URL(env.APP_URL || 'http://localhost:3000');
    localOrigin =
      loopback.has(origin.hostname) && !origin.username && !origin.password;
  } catch {
    /* Invalid configuration must fail closed. */
  }
  if (
    env.NODE_ENV === 'production' ||
    !loopback.has(env.HOST || '127.0.0.1') ||
    !localOrigin
  )
    throw new Error(
      'DEMO_MODE requires a local-only non-production backend and a loopback APP_URL.',
    );
  return true;
}

export function validateRuntime(env = process.env) {
  const demo = demoEnabled(env);
  if (!env.MONGODB_URI?.trim() && !demo)
    throw new Error(
      'MongoDB configuration is required outside explicit local demo mode.',
    );
  if (env.DEMO_MODE && !['true', 'false'].includes(env.DEMO_MODE))
    throw new Error('DEMO_MODE must be true or false.');
  const port = Number(env.PORT || 4000);
  if (!Number.isInteger(port) || port < 1 || port > 65535)
    throw new Error('PORT must be an integer from 1 to 65535.');
}
