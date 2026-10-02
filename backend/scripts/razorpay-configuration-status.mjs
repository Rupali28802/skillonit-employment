import { read, closeStore } from '../dist/lib/store.js';

const config = await read(r => r.get('systemConfig', 'razorpay-config'));
const environments = {};
for (const name of ['test', 'live']) {
  const entry = config?.environments?.[name];
  const version = entry?.version ? await read(r => r.get('systemConfig', entry.version)) : null;
  environments[name] = {
    configured: Boolean(version),
    status: entry?.status ?? 'not_configured',
    secretConfigured: Boolean(version?.encryptedKeySecret),
    webhookConfigured: Boolean(version?.encryptedWebhookSecret),
    active: Boolean(config?.enabled && config?.activeEnvironment === name && config?.activeVersion === entry?.version),
    lastValidatedAt: entry?.lastValidatedAt ?? null,
  };
}
console.log(JSON.stringify({
  encryptionKeyConfigured: Boolean(process.env.PAYMENT_CONFIG_ENCRYPTION_KEY),
  legacyEnvironmentCredentialsConfigured: Boolean(process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET),
  configRecordPresent: Boolean(config),
  enabled: Boolean(config?.enabled),
  activeEnvironment: config?.activeEnvironment ?? null,
  environments,
}));
await closeStore();
