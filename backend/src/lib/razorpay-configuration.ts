import { randomUUID } from "node:crypto";
import { z } from "zod";
import { encryptRefreshToken, decryptRefreshToken } from "../mailbox-auth.js";
import { read, transaction, type Repository } from "./store.js";
import { ApiError, audit } from "./security.js";
import { requireAdminPermission } from "./admin-rbac.js";
import type { User } from "./domain.js";
import { RazorpayProvider } from "./providers.js";

type Environment = "test" | "live";
type Secret = ReturnType<typeof encryptRefreshToken>;
type Version = {
  id: string;
  kind: "razorpay-version";
  environment: Environment;
  keyId: string;
  encryptedKeySecret: Secret;
  encryptedWebhookSecret?: Secret;
  createdAt: string;
};
type Entry = {
  version?: string;
  status: "connected" | "validation_failed" | "not_configured";
  lastValidatedAt?: string;
  updatedAt?: string;
  updatedBy?: string;
  lastAttemptFailed?: boolean;
};
type Config = {
  id: "razorpay-config";
  revision: number;
  activeEnvironment: Environment;
  enabled: boolean;
  activeVersion?: string;
  activatedVersions?: string[];
  legacyVersion?: string;
  versions: string[];
  environments: Partial<Record<Environment, Entry>>;
};
const environmentSchema = z.enum(["test", "live"]);
const actionSchema = z.object({
  environment: environmentSchema,
  expectedRevision: z.number().int().nonnegative(),
  reason: z.string().trim().min(3).max(300),
  confirmed: z.literal(true),
  liveConfirmed: z.boolean().optional(),
});
const saveSchema = actionSchema
  .extend({
    keyId: z.string().trim().max(100).optional(),
    keySecret: z.string().min(1).max(500).optional(),
    webhookSecret: z.string().min(1).max(500).optional(),
  })
  .strict();
function parseInput<T>(schema: z.ZodType<T>, input: unknown): T {
  const result = schema.safeParse(input);
  if (!result.success)
    throw new ApiError(
      400,
      "INVALID_PAYMENT_CONFIGURATION",
      "Check the environment, required fields, revision, reason and confirmations.",
    );
  return result.data;
}
const unavailable = () =>
  new ApiError(503, "PAYMENTS_UNAVAILABLE", "Razorpay payments are currently unavailable.");
function encryptionKey() {
  const key = process.env.PAYMENT_CONFIG_ENCRYPTION_KEY;
  if (!key || !/^[a-f0-9]{64}$/i.test(key))
    throw new ApiError(
      503,
      "PAYMENT_ENCRYPTION_UNAVAILABLE",
      "Payment configuration encryption is not available.",
    );
  return key;
}
function seal(secret: string) {
  return encryptRefreshToken(secret, encryptionKey());
}
function open(secret: Secret) {
  try {
    return decryptRefreshToken(secret, encryptionKey());
  } catch {
    throw new ApiError(
      503,
      "PAYMENT_ENCRYPTION_UNAVAILABLE",
      "Payment configuration could not be decrypted.",
    );
  }
}
const load = (r: Repository) => r.get<Config>("systemConfig", "razorpay-config");
const empty = (environment: Environment): Config => ({
  id: "razorpay-config",
  revision: 0,
  activeEnvironment: environment,
  enabled: false,
  versions: [],
  environments: {},
});
function legacy() {
  const key = process.env.RAZORPAY_KEY_ID,
    secret = process.env.RAZORPAY_KEY_SECRET;
  if (!key || !secret) return null;
  const environment: Environment | null = key.startsWith("rzp_live_")
    ? "live"
    : key.startsWith("rzp_test_")
      ? "test"
      : null;
  if (!environment) throw unavailable();
  return { key, secret, webhookSecret: process.env.RAZORPAY_WEBHOOK_SECRET, environment };
}
function encryptVersion(
  environment: Environment,
  keyId: string,
  secret: string,
  webhook?: string,
): Version {
  return {
    id: "razorpay-version:" + randomUUID(),
    kind: "razorpay-version",
    environment,
    keyId,
    encryptedKeySecret: seal(secret),
    ...(webhook ? { encryptedWebhookSecret: seal(webhook) } : {}),
    createdAt: new Date().toISOString(),
  };
}
function provider(version: Version) {
  return new RazorpayProvider({
    key: version.keyId,
    secret: open(version.encryptedKeySecret),
    webhookSecret: version.encryptedWebhookSecret
      ? open(version.encryptedWebhookSecret)
      : undefined,
    version: version.id,
  });
}
async function permitted(r: Repository, actor: User, write = false) {
  await requireAdminPermission(r, actor, "payments.read");
  await requireAdminPermission(r, actor, write ? "configuration.update" : "configuration.read");
}
function confirmation(value: z.infer<typeof actionSchema>, current: Config | null) {
  if (
    (value.environment === "live" ||
      (current?.enabled && current.activeEnvironment === "live") ||
      (!current && legacy()?.environment === "live")) &&
    !value.liveConfirmed
  )
    throw new ApiError(
      400,
      "LIVE_CONFIRMATION_REQUIRED",
      "You're changing LIVE Razorpay configuration. This affects real payments.",
    );
}
function revision(current: Config | null, expected: number) {
  if ((current?.revision ?? 0) !== expected)
    throw new ApiError(
      409,
      "CONFIGURATION_CHANGED",
      "Configuration changed. Reload and try again.",
    );
}
async function log(
  r: Repository,
  actor: User,
  action: string,
  environment: Environment,
  success: boolean,
  reason: string,
) {
  await audit(r, actor.id, action, `razorpay:${environment}`);
  await r.put("razorpayConfigurationEvents", {
    id: randomUUID(),
    actorId: actor.id,
    action,
    environment,
    success,
    reason,
    createdAt: new Date().toISOString(),
  });
}
async function redactReason(reason: string) {
  const config = await read(load);
  const values: string[] = [];
  const bootstrap = !config ? legacy() : null;
  if (bootstrap) values.push(bootstrap.key, bootstrap.secret, bootstrap.webhookSecret ?? "");
  for (const id of config?.versions ?? []) {
    const version = await read((r) => r.get<Version>("systemConfig", id));
    if (version)
      values.push(
        version.keyId,
        open(version.encryptedKeySecret),
        version.encryptedWebhookSecret ? open(version.encryptedWebhookSecret) : "",
      );
  }
  for (const value of values) if (value) reason = reason.replaceAll(value, "[redacted]");
  return reason;
}
const mask = (key: string) => key.slice(0, 9) + "****" + key.slice(-4);
export async function razorpayMetadata(actor: User, env: unknown = "test") {
  const environment = environmentSchema.parse(env);
  return read(async (r) => {
    await permitted(r, actor);
    const config = await load(r),
      entry = config?.environments[environment];
    const version = entry?.version ? await r.get<Version>("systemConfig", entry.version) : null;
    const bootstrap = !config ? legacy() : null;
    const matching = bootstrap?.environment === environment ? bootstrap : null;
    return {
      revision: config?.revision ?? 0,
      environment,
      activeEnvironment: config?.activeEnvironment ?? bootstrap?.environment ?? null,
      source: config ? "admin" : "environment",
      configured: !!(version || matching),
      keyIdMasked: version ? mask(version.keyId) : matching ? mask(matching.key) : null,
      secretConfigured: !!(version || matching),
      webhookConfigured: !!(version?.encryptedWebhookSecret || matching?.webhookSecret),
      enabled: config ? config.enabled && config.activeEnvironment === environment : !!matching,
      status: entry?.status ?? (matching ? "not_validated" : "not_configured"),
      pendingActivation: !!entry?.version && entry.version !== config?.activeVersion,
      lastAttemptFailed: entry?.lastAttemptFailed ?? false,
      lastValidatedAt: entry?.lastValidatedAt ?? null,
      updatedAt: entry?.updatedAt ?? null,
      updatedBy: entry?.updatedBy ?? null,
    };
  });
}
export async function saveRazorpayConfiguration(actor: User, input: unknown) {
  await read((r) => permitted(r, actor, true));
  const value = parseInput(saveSchema, input),
    current = await read(load);
  revision(current, value.expectedRevision);
  confirmation(value, current);
  const priorId = current?.environments[value.environment]?.version;
  const prior = priorId ? await read((r) => r.get<Version>("systemConfig", priorId)) : null;
  const keyId = value.keyId || prior?.keyId;
  if (!keyId || !new RegExp(`^rzp_${value.environment}_[A-Za-z0-9]{6,80}$`).test(keyId))
    throw new ApiError(
      400,
      "PAYMENT_KEY_ENVIRONMENT_MISMATCH",
      "Enter a Key ID matching the selected environment.",
    );
  const secret = value.keySecret || (prior ? open(prior.encryptedKeySecret) : null);
  if (!secret) throw new ApiError(400, "PAYMENT_SECRET_REQUIRED", "Key Secret is required.");
  const webhook =
    value.webhookSecret ||
    (prior?.encryptedWebhookSecret ? open(prior.encryptedWebhookSecret) : undefined);
  const candidate = encryptVersion(value.environment, keyId, secret, webhook);
  let reason = await redactReason(value.reason);
  for (const item of [keyId, secret, webhook])
    if (item) reason = reason.replaceAll(item, "[redacted]");
  let valid = true;
  try {
    await provider(candidate).validateConnection();
  } catch {
    valid = false;
  }
  // Encrypt the pre-existing deployment credentials once, for unversioned orders.
  const bootstrap = !current ? legacy() : null;
  const legacyVersion = bootstrap
    ? encryptVersion(
        bootstrap.environment,
        bootstrap.key,
        bootstrap.secret,
        bootstrap.webhookSecret,
      )
    : null;
  await transaction(async (r) => {
    await permitted(r, actor, true);
    const latest = await load(r);
    revision(latest, value.expectedRevision);
    // A failed first save must not turn off an existing environment deployment.
    if (!valid && !latest && bootstrap) {
      await log(r, actor, "RAZORPAY_CONFIGURATION_VALIDATED", value.environment, false, reason);
      return;
    }
    const next: Config = latest ?? empty(value.environment);
    const previous = next.environments[value.environment];
    if (valid) {
      if (legacyVersion) {
        await r.put("systemConfig", legacyVersion);
        next.legacyVersion = legacyVersion.id;
        next.versions.push(legacyVersion.id);
        next.activeVersion = legacyVersion.id;
        next.activatedVersions = [legacyVersion.id];
        next.activeEnvironment = legacyVersion.environment;
        next.enabled = true;
      }
      await r.put("systemConfig", candidate);
      next.versions.push(candidate.id);
      next.environments[value.environment] = {
        version: candidate.id,
        status: "connected",
        lastValidatedAt: new Date().toISOString(),
        updatedAt: new Date().toISOString(),
        updatedBy: actor.id,
        lastAttemptFailed: false,
      };
      await log(
        r,
        actor,
        previous?.version ? "RAZORPAY_CONFIGURATION_UPDATED" : "RAZORPAY_CONFIGURATION_CREATED",
        value.environment,
        true,
        reason,
      );
    } else {
      next.environments[value.environment] = {
        ...previous,
        status: previous?.version ? previous.status : "validation_failed",
        lastAttemptFailed: true,
      };
    }
    next.revision++;
    await r.put("systemConfig", next);
    await log(r, actor, "RAZORPAY_CONFIGURATION_VALIDATED", value.environment, valid, reason);
  });
  return {
    valid,
    message: valid
      ? "Configuration saved. Enable explicitly when ready."
      : "Razorpay credentials could not be validated. Previous configuration was preserved.",
    configuration: await razorpayMetadata(actor, value.environment),
  };
}
export async function razorpayAction(
  actor: User,
  action: "validate" | "enable" | "disable",
  input: unknown,
) {
  await read((r) => permitted(r, actor, true));
  const value = parseInput(actionSchema.strict(), input),
    current = await read(load);
  revision(current, value.expectedRevision);
  confirmation(value, current);
  if (!current)
    throw new ApiError(
      409,
      "ADMIN_CONFIGURATION_REQUIRED",
      "Save an Admin-managed configuration first.",
    );
  const entry = current.environments[value.environment],
    version = entry?.version
      ? await read((r) => r.get<Version>("systemConfig", entry.version!))
      : null;
  let valid = true;
  if (action !== "disable") {
    if (!version) throw unavailable();
    if (action === "enable" && !version.encryptedWebhookSecret)
      throw new ApiError(
        409,
        "WEBHOOK_SECRET_REQUIRED",
        "Configure the separate Razorpay webhook signing secret before enabling.",
      );
    try {
      await provider(version).validateConnection();
    } catch {
      valid = false;
    }
  }
  // Reasons are never allowed to echo stored credentials into audit history.
  let reason = await redactReason(value.reason);
  if (version) {
    for (const secret of [
      version.keyId,
      open(version.encryptedKeySecret),
      version.encryptedWebhookSecret ? open(version.encryptedWebhookSecret) : "",
    ])
      if (secret) reason = reason.replaceAll(secret, "[redacted]");
  }
  await transaction(async (r) => {
    await permitted(r, actor, true);
    const next = await load(r);
    revision(next, value.expectedRevision);
    if (!next) throw unavailable();
    if (action !== "disable")
      next.environments[value.environment] = {
        ...entry!,
        status: valid ? "connected" : entry!.status,
        lastValidatedAt: new Date().toISOString(),
        lastAttemptFailed: !valid,
      };
    if (valid && action === "enable") {
      next.activeEnvironment = value.environment;
      next.activeVersion = version!.id;
      next.activatedVersions = [...new Set([...(next.activatedVersions ?? []), version!.id])];
      next.enabled = true;
    }
    if (action === "disable") next.enabled = false;
    if (next.environments[value.environment]) {
      next.environments[value.environment]!.updatedAt = new Date().toISOString();
      next.environments[value.environment]!.updatedBy = actor.id;
    }
    next.revision++;
    await r.put("systemConfig", next);
    await log(
      r,
      actor,
      action === "validate"
        ? "RAZORPAY_CONFIGURATION_VALIDATED"
        : action === "enable"
          ? "RAZORPAY_CONFIGURATION_ENABLED"
          : "RAZORPAY_CONFIGURATION_DISABLED",
      value.environment,
      valid,
      reason,
    );
  });
  return { valid, configuration: await razorpayMetadata(actor, value.environment) };
}
export async function configuredRazorpayProvider(versionId?: string, newBusiness = true) {
  const config = await read(load);
  if (!config) {
    if (versionId && versionId !== "environment") throw unavailable();
    const value = legacy();
    if (!value) throw unavailable();
    return new RazorpayProvider({ ...value, version: "environment" });
  }
  if (newBusiness && !config.enabled) throw unavailable();
  const id =
    versionId && versionId !== "environment"
      ? versionId
      : !newBusiness
        ? config.legacyVersion
        : config.activeVersion;
  if (!id || !config.versions.includes(id)) throw unavailable();
  const version = await read((r) => r.get<Version>("systemConfig", id));
  if (!version) throw unavailable();
  if (newBusiness && version.id !== config.activeVersion) throw unavailable();
  return provider(version);
}
export async function razorpayForRecord(
  collection: "payments" | "studentSubscriptions",
  id: string,
  userId?: string,
) {
  const row = await read((r) =>
    r.get<{ id: string; userId?: string; razorpayConfigVersion?: string }>(collection, id),
  );
  if (!row || (userId && row.userId !== userId))
    throw new ApiError(404, "PAYMENT_NOT_FOUND", "Payment or subscription not found.");
  return configuredRazorpayProvider(row.razorpayConfigVersion, false);
}
export async function razorpayVersionMatches(
  stored: string | undefined,
  active: string | undefined,
) {
  if (!active) return true;
  if (stored === active) return true;
  if (!stored || stored === "environment") {
    const config = await read(load);
    return config ? config.legacyVersion === active : active === "environment";
  }
  return false;
}
export async function verifyConfiguredWebhook(raw: string, signature: string) {
  const config = await read(load);
  if (!config) return new RazorpayProvider().verify(raw, signature);
  const signingEnvironments = new Set<Environment>();
  for (const id of config.activatedVersions ?? []) {
    const version = await read((r) => r.get<Version>("systemConfig", id));
    if (version && provider(version).verify(raw, signature))
      signingEnvironments.add(version.environment);
  }
  if (!signingEnvironments.size) return false;
  // Bind known events to their stored environment; a TEST webhook cannot update a LIVE payment.
  let expected: Environment | undefined;
  try {
    const event = JSON.parse(raw),
      payment = event?.payload?.payment?.entity,
      subscription = event?.payload?.subscription?.entity;
    const row = await read(async (r) => {
      if (typeof payment?.order_id === "string")
        return r.get<{ razorpayConfigVersion?: string }>("payments", payment.order_id);
      const subscriptionId = subscription?.id ?? payment?.subscription_id;
      if (typeof subscriptionId === "string")
        return (
          await r.find<{ razorpayConfigVersion?: string }>(
            "studentSubscriptions",
            { providerSubscriptionId: subscriptionId },
            1,
          )
        )[0];
      const paymentId = event?.payload?.refund?.entity?.payment_id ?? payment?.id;
      if (typeof paymentId === "string")
        return (
          await r.find<{ razorpayConfigVersion?: string }>(
            "payments",
            { providerPaymentId: paymentId },
            1,
          )
        )[0];
      return null;
    });
    if (row) {
      const id =
        row.razorpayConfigVersion && row.razorpayConfigVersion !== "environment"
          ? row.razorpayConfigVersion
          : config.legacyVersion;
      if (!id) return false;
      expected = (await read((r) => r.get<Version>("systemConfig", id)))?.environment;
      if (!expected) return false;
    }
  } catch {
    return false;
  }
  return !expected || signingEnvironments.has(expected);
}
export async function razorpayConfigurationHistory(actor: User) {
  return read(async (r) => {
    await permitted(r, actor);
    return r.page("razorpayConfigurationEvents", {}, { createdAt: -1 }, 0, 30);
  });
}
