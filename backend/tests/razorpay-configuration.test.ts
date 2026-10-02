import test from "node:test";
import assert from "node:assert/strict";
import { createHmac, randomBytes } from "node:crypto";
import { once } from "node:events";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { plans, type User } from "../src/lib/domain.ts";

// Isolated provider-contract fixtures, never sent to Razorpay or written to production.
test("Admin-managed Razorpay HTTP, encryption, rotation and billing regression", async (t) => {
  const old = { ...process.env },
    realFetch = globalThis.fetch;
  const replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  delete process.env.DATABASE_URL;
  delete process.env.RAZORPAY_KEY_ID;
  delete process.env.RAZORPAY_KEY_SECRET;
  delete process.env.RAZORPAY_WEBHOOK_SECRET;
  Object.assign(process.env, {
    MONGODB_URI: replica.getUri(),
    MONGODB_DATABASE: "razorpay_config_isolated",
    DEMO_MODE: "true",
    APP_URL: "http://localhost:3102",
    PAYMENT_CONFIG_ENCRYPTION_KEY: randomBytes(32).toString("hex"),
  });
  const store = await import("../src/lib/store.ts"),
    security = await import("../src/lib/security.ts");
  const config = await import("../src/lib/razorpay-configuration.ts");
  const { app } = await import("../src/app.ts");
  const server = app.listen(0, "127.0.0.1");
  await once(server, "listening");
  const base = `http://127.0.0.1:${(server.address() as { port: number }).port}/api/v1/`;
  const secret = randomBytes(24).toString("hex"),
    webhook = randomBytes(24).toString("hex");
  const nextSecret = randomBytes(24).toString("hex"),
    liveSecret = randomBytes(24).toString("hex");
  const liveWebhook = randomBytes(24).toString("hex");
  const keyId = "rzp_test_" + randomBytes(8).toString("hex");
  const liveKeyId = "rzp_live_" + randomBytes(8).toString("hex");
  let fail = false,
    providerCalls = 0,
    orderNumber = 0;
  globalThis.fetch = async (input, init) => {
    const url = String(input);
    if (!url.startsWith("https://api.razorpay.com/")) return realFetch(input, init);
    providerCalls++;
    if (fail) return new Response(JSON.stringify({ error: secret }), { status: 401 });
    assert.ok(new Headers(init?.headers).get("Authorization")?.startsWith("Basic "));
    if (url.endsWith("payments?count=1"))
      return Response.json({ entity: "collection", items: [], count: 0 });
    if (url.endsWith("/orders")) {
      const body = JSON.parse(String(init?.body));
      return Response.json({ ...body, id: `order_fixture${++orderNumber}` });
    }
    if (url.endsWith("/plans")) {
      const body = JSON.parse(String(init?.body));
      return Response.json({ ...body, id: "plan_fixture001" });
    }
    if (url.endsWith("/subscriptions")) {
      const body = JSON.parse(String(init?.body));
      return Response.json({ id: "sub_fixture001", plan_id: body.plan_id, status: "created" });
    }
    if (url.endsWith("/refund")) {
      assert.ok(
        new Headers(init?.headers).get("Authorization") ===
          "Basic " + Buffer.from(keyId + ":" + secret).toString("base64"),
      );
      return Response.json({
        id: "rfnd_fixture001",
        payment_id: "pay_fixture01",
        amount: 100,
        status: "pending",
      });
    }
    if (url.endsWith("/cancel"))
      return Response.json({ id: "sub_fixture001", status: "cancelled" });
    throw new Error("Unexpected provider operation in isolated test");
  };
  const password = randomBytes(18).toString("hex");
  const user = (id: string, role: User["role"]): User => ({
    id,
    role,
    email: `${id}@example.test`,
    name: id,
    passwordHash: security.hashPassword(password),
    verified: true,
    plan: "basic",
    createdAt: new Date().toISOString(),
    profile: {
      name: id,
      headline: "",
      skills: [],
      experience: null,
      education: "",
      country: "",
      city: "",
      confirmed: true,
    },
    preferences: {
      roles: [],
      relatedRoles: [],
      countries: [],
      modes: [],
      exclusions: [],
      automation: false,
      dailyCap: 5,
    },
  });
  async function call(
    path: string,
    cookie = "",
    method = "GET",
    body?: unknown,
    expected = 200,
    extra: Record<string, string> = {},
  ) {
    const response = await realFetch(base + path, {
      method,
      headers: {
        Origin: process.env.APP_URL!,
        "Content-Type": "application/json",
        Cookie: cookie,
        ...extra,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const text = await response.text();
    for (const value of [secret, webhook, nextSecret, liveSecret, liveWebhook])
      assert.equal(text.includes(value), false, "Response must not contain secrets");
    assert.equal(response.status, expected, `${method} ${path}: ${response.status}`);
    return {
      data: JSON.parse(text).data,
      cookie: response.headers
        .getSetCookie()
        .map((value) => value.split(";")[0])
        .join("; "),
    };
  }
  const prefix = "admin/payments/razorpay/";
  let admin = "",
    student = "",
    finance = "";
  async function metadata(env = "test") {
    return (await call(prefix + "config?environment=" + env, admin)).data;
  }
  async function change(action: string, fields: Record<string, unknown> = {}, expected = 200) {
    const env = fields.environment === "live" ? "live" : "test";
    return (
      await call(
        prefix + action,
        admin,
        "POST",
        {
          environment: env,
          expectedRevision: (await metadata(env)).revision,
          reason: "Isolated security verification",
          confirmed: true,
          ...fields,
        },
        expected,
      )
    ).data;
  }
  try {
    await store.bootstrapIndexes();
    await store.transaction(async (r) => {
      for (const item of [
        user("admin", "admin"),
        user("finance", "admin"),
        user("candidate", "student"),
      ])
        await r.put("users", item);
      await r.put("adminAssignments", { id: "admin", userId: "admin", roleId: "super_admin" });
      await r.put("adminAssignments", { id: "finance", userId: "finance", roleId: "finance" });
      await r.put("systemConfig", {
        id: "plans",
        value: plans.map((plan) => (plan.code === "pro" ? { ...plan, price: 299 } : plan)),
      });
    });
    for (const id of ["admin", "candidate", "finance"]) {
      const result = await call("auth/login", "", "POST", {
        email: `${id}@example.test`,
        password,
      });
      if (id === "admin") admin = result.cookie;
      else if (id === "candidate") student = result.cookie;
      else finance = result.cookie;
    }
    await t.test("RBAC rejects anonymous, candidate and finance config access", async () => {
      await call(prefix + "config", "", "GET", undefined, 401);
      for (const cookie of [student, finance])
        for (const action of ["config", "validate", "enable", "disable"])
          await call(prefix + action, cookie, "POST", {}, 403);
      await call(prefix + "config", finance, "GET", undefined, 403);
    });
    await t.test("save encrypts and masks secrets; explicit activation required", async () => {
      const result = await change("config", {
        keyId,
        keySecret: secret,
        webhookSecret: webhook,
        reason: `Rotate ${secret}`,
      });
      assert.equal(result.valid, true);
      assert.equal(result.configuration.enabled, false);
      assert.equal(result.configuration.keyIdMasked.includes(keyId), false);
      const rows = await store.read((r) => r.find("systemConfig", {}, 100));
      assert.equal(JSON.stringify(rows).includes(secret), false);
      assert.equal(JSON.stringify(rows).includes(webhook), false);
      const history = (await call(prefix + "history", admin)).data;
      assert.ok(history.some((row: { reason: string }) => row.reason.includes("[redacted]")));
      assert.equal(
        JSON.stringify((await call("admin/flags", finance)).data).includes("razorpay-"),
        false,
      );
      await call("admin/flags/razorpay-config", finance, "PATCH", { status: "disabled" }, 404);
      const before = providerCalls;
      await call("billing/checkout", student, "POST", { planCode: "pro" }, 503, {
        "idempotency-key": "disabled-order",
      });
      assert.equal(providerCalls, before);
      assert.equal((await change("enable")).configuration.enabled, true);
    });
    let orderId = "";
    await t.test("checkout exposes only public key and version binds old signatures", async () => {
      const checkout = (
        await call("billing/checkout", student, "POST", { planCode: "pro" }, 201, {
          "idempotency-key": "managed-order-1",
        })
      ).data;
      assert.equal(checkout.keyId, keyId);
      orderId = checkout.order.id;
      assert.ok(
        (await store.read((r) => r.get<{ razorpayConfigVersion: string }>("payments", orderId)))
          ?.razorpayConfigVersion,
      );
      await change("config", { keySecret: nextSecret });
      assert.equal(
        (await config.configuredRazorpayProvider()).verifyCheckout(
          orderId,
          "pay_fixture01",
          createHmac("sha256", secret)
            .update(orderId + "|pay_fixture01")
            .digest("hex"),
        ),
        true,
      );
      await change("enable");
      await call("billing/verify", student, "POST", {
        razorpay_order_id: orderId,
        razorpay_payment_id: "pay_fixture01",
        razorpay_signature: createHmac("sha256", secret)
          .update(orderId + "|pay_fixture01")
          .digest("hex"),
      });
      await call(
        "billing/verify",
        student,
        "POST",
        {
          razorpay_order_id: orderId,
          razorpay_payment_id: "pay_fixture01",
          razorpay_signature: "0".repeat(64),
        },
        401,
      );
    });
    await t.test(
      "failed replacement and stale revision preserve active configuration",
      async () => {
        const active = (await config.configuredRazorpayProvider()).configVersion;
        fail = true;
        assert.equal(
          (await change("config", { keySecret: randomBytes(24).toString("hex") })).valid,
          false,
        );
        fail = false;
        assert.equal((await config.configuredRazorpayProvider()).configVersion, active);
        await change("disable", { expectedRevision: 0 }, 409);
        const current = await metadata();
        const outcomes = await Promise.allSettled(
          [1, 2].map(() =>
            config.razorpayAction(user("admin", "admin"), "validate", {
              environment: "test",
              expectedRevision: current.revision,
              reason: "Concurrency check",
              confirmed: true,
            }),
          ),
        );
        assert.equal(outcomes.filter((value) => value.status === "fulfilled").length, 1);
      },
    );
    await t.test("LIVE confirmation and environment mismatch cannot be bypassed", async () => {
      await change("config", { environment: "live", keyId: liveKeyId, keySecret: liveSecret }, 400);
      await change("config", { keyId: liveKeyId }, 400);
      await change("config", {
        environment: "live",
        liveConfirmed: true,
        keyId: liveKeyId,
        keySecret: liveSecret,
        webhookSecret: liveWebhook,
      });
      await change("enable", { environment: "live", liveConfirmed: true });
      assert.equal((await config.configuredRazorpayProvider()).keyId, liveKeyId);
      await change("disable", {}, 400);
    });
    await t.test(
      "separate webhook signatures, environment binding and duplicate protection",
      async () => {
        const event = {
          event: "payment.captured",
          payload: {
            payment: {
              entity: { id: "pay_fixture01", order_id: orderId, amount: 29900, currency: "INR" },
            },
          },
        };
        const signature = (key: string) =>
          createHmac("sha256", key).update(JSON.stringify(event)).digest("hex");
        await call("webhooks/razorpay", "", "POST", event, 401, {
          "x-razorpay-signature": signature(secret),
          "x-razorpay-event-id": "fixture-capture",
        });
        await call("webhooks/razorpay", "", "POST", event, 401, {
          "x-razorpay-signature": signature(liveWebhook),
          "x-razorpay-event-id": "fixture-capture",
        });
        for (let i = 0; i < 2; i++)
          await call("webhooks/razorpay", "", "POST", event, 200, {
            "x-razorpay-signature": signature(webhook),
            "x-razorpay-event-id": "fixture-capture",
          });
        assert.equal(
          await store.read((r) => r.count("paymentEvents", { id: "fixture-capture" })),
          1,
        );
        assert.equal(
          (await store.read((r) => r.get<{ status: string }>("payments", orderId)))?.status,
          "captured",
        );
        await call(`admin/payments/${orderId}/refund`, admin, "POST", {
          amount: 100,
          reason: "Isolated refund verification",
          idempotencyKey: "fixture-refund-01",
        });
      },
    );
    await t.test(
      "managed recurring plans, subscription keys and cancellation survive disable",
      async () => {
        const recurring = await import("../src/lib/recurring-billing.ts");
        const provider = await config.configuredRazorpayProvider();
        await recurring.syncRazorpayPlan(user("admin", "admin"), "pro", provider);
        const publicPlans = (await call("plans")).data.plans;
        await call("admin/plans", admin, "PUT", publicPlans);
        assert.equal(
          (await store.configuredPlans()).find((plan) => plan.code === "pro")
            ?.razorpayConfigVersion,
          provider.configVersion,
        );
        const result = await recurring.createRecurringSubscription(
          user("candidate", "student"),
          { planCode: "pro" },
          "recurring-fixture",
          provider,
        );
        assert.equal(result.keyId, liveKeyId);
        await change("disable", { environment: "live", liveConfirmed: true });
        await call("billing/checkout", student, "POST", { planCode: "pro" }, 503, {
          "idempotency-key": "disabled-final-order",
        });
        await call("billing/subscriptions/cancel", student, "POST", {});
        assert.ok(await config.razorpayForRecord("payments", orderId));
      },
    );
    await t.test("encryption failure is safe and audit contains no credentials", async () => {
      const savedKey = process.env.PAYMENT_CONFIG_ENCRYPTION_KEY;
      delete process.env.PAYMENT_CONFIG_ENCRYPTION_KEY;
      await change("config", { keySecret: nextSecret }, 503);
      process.env.PAYMENT_CONFIG_ENCRYPTION_KEY = savedKey;
      const history = JSON.stringify(
        await store.read((r) => r.find("razorpayConfigurationEvents", {}, 100)),
      );
      for (const value of [secret, webhook, nextSecret, liveSecret, liveWebhook])
        assert.equal(history.includes(value), false);
    });
    await t.test(
      "bootstrap migration preserves old credentials and never falls back after activation",
      async () => {
        await store.transaction((r) => r.remove("systemConfig", "razorpay-config"));
        process.env.RAZORPAY_KEY_ID = keyId;
        process.env.RAZORPAY_KEY_SECRET = secret;
        process.env.RAZORPAY_WEBHOOK_SECRET = webhook;
        assert.equal((await metadata()).source, "environment");
        fail = true;
        assert.equal(
          (await change("config", { keyId, keySecret: nextSecret, webhookSecret: webhook })).valid,
          false,
        );
        fail = false;
        assert.equal(await store.read((r) => r.get("systemConfig", "razorpay-config")), null);
        await change("config", { keyId, keySecret: nextSecret, webhookSecret: webhook });
        const signature = createHmac("sha256", secret)
          .update("order_legacy|pay_legacy")
          .digest("hex");
        assert.equal(
          (await config.configuredRazorpayProvider()).verifyCheckout(
            "order_legacy",
            "pay_legacy",
            signature,
          ),
          true,
        );
        delete process.env.RAZORPAY_KEY_ID;
        delete process.env.RAZORPAY_KEY_SECRET;
        delete process.env.RAZORPAY_WEBHOOK_SECRET;
        assert.equal(
          (await config.configuredRazorpayProvider(undefined, false)).verifyCheckout(
            "order_legacy",
            "pay_legacy",
            signature,
          ),
          true,
        );
        await change("enable");
        assert.equal(
          (await config.configuredRazorpayProvider()).verifyCheckout(
            "order_legacy",
            "pay_legacy",
            signature,
          ),
          false,
        );
      },
    );
  } finally {
    globalThis.fetch = realFetch;
    server.closeAllConnections();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await store.closeStore();
    await replica.stop();
    process.env = old;
  }
});
