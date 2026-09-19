import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { MongoMemoryReplSet } from "mongodb-memory-server";
import { MongoClient } from "mongodb";
import { sampleJobs } from "../src/lib/fixtures.js";

// An isolated, real MongoDB replica set. Never reads .env or a user's database.
const replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
process.env.MONGODB_URI = replica.getUri();
process.env.MONGODB_DATABASE = "architecture_test";
process.env.DEMO_MODE = "true";
process.env.APP_URL = "http://localhost:3000";
const { bootstrapIndexes, transaction, read, closeStore } = await import("../src/lib/store.js");
const { app } = await import("../src/app.js");
const client = new MongoClient(replica.getUri());
let server: ReturnType<typeof app.listen> | undefined;
try {
  await bootstrapIndexes();
  await bootstrapIndexes(); // Repeated bootstrap must preserve existing indexes.
  const applicationIndexes = await client.db('architecture_test').collection('applications').indexes();
  assert.ok(applicationIndexes.some(index => index.key.status === 1 && index.key.scheduledAt === 1), 'application scheduling index');
  assert.ok(applicationIndexes.some(index => index.key.userId === 1 && index.key.jobId === 1 && index.unique), 'application deduplication index');
  const subscriptionIndexes = await client.db('architecture_test').collection('studentSubscriptions').indexes();
  assert.ok(subscriptionIndexes.some(index => index.key.userId === 1 && index.unique), 'subscription ownership index');
  assert.ok(subscriptionIndexes.some(index => index.key.status === 1 && index.key.currentPeriodEnd === 1), 'subscription expiry index');
  const usageIndexes = await client.db('architecture_test').collection('entitlementUsage').indexes();
  assert.ok(usageIndexes.some(index => index.key.userId === 1 && index.key.period === 1 && index.key.metric === 1 && index.unique), 'entitlement usage uniqueness index');
  const paymentIndexes = await client.db('architecture_test').collection('payments').indexes();
  assert.ok(paymentIndexes.some(index => index.key.providerPaymentId === 1 && index.unique), 'provider payment uniqueness index');
  const billingIndexes = await client.db('architecture_test').collection('billingRecords').indexes();
  assert.ok(billingIndexes.some(index => index.key.userId === 1 && index.key.createdAt === -1), 'billing history index');
  for (const name of ["cvDocuments", "studentOnboarding", "candidateConsents", "candidateConsentEvents"]) {
    const entries = await client.db("architecture_test").collection(name).indexes();
    assert.ok(entries.some(index => index.key.userId === 1), `${name} ownership index`);
  }
  const { checkEmailOtp } = await import("./email-otp-checks.js");
  await checkEmailOtp();
  const { checkStudentProfile } = await import("./student-profile-checks.js");
  await checkStudentProfile();
  const { checkModule2 } = await import("./module2-checks.js");
  await checkModule2();
  const { checkModule2Foundation } = await import('./module2-foundation-checks.js');
  await checkModule2Foundation();
  const { checkApplicationEngine } = await import('./application-engine-checks.js');
  await checkApplicationEngine();
  const receipts = await client.db('architecture_test').collection('cvDeletionReceipts').indexes();
  assert.ok(receipts.some(index => index.expireAfterSeconds === 0));
  const cvIndexes = await client.db('architecture_test').collection('cvDocuments').indexes();
  assert.ok(cvIndexes.some(index => index.key.sha256 === 1));
  for (const name of ['studentPreferences', 'automationPreferences']) {
    const entries = await client.db('architecture_test').collection(name).indexes();
    assert.ok(entries.some(index => index.key.userId === 1 && index.unique));
    const existing = await client.db('architecture_test').collection(name).findOne({});
    assert.ok(existing);
    const { _id: _, ...copy } = existing;
    await assert.rejects(client.db('architecture_test').collection(name).insertOne({ ...copy, id: 'duplicate-owner-test' }), { code: 11000 });
  }
  for (const name of ['occupationFamilies', 'locations']) {
    const entries = await client.db('architecture_test').collection(name).indexes();
    assert.ok(entries.some(index => index.key.slug === 1 && index.unique));
    assert.ok(entries.some(index => index.key.parentId === 1));
  }
  const locationIndexes = await client.db('architecture_test').collection('locations').indexes();
  assert.ok(locationIndexes.some(index => index.key.countryCode === 1 && index.key.type === 1));
  console.log('PASS: Module 2 preferences, catalogs, consent, automation configuration, completion, ownership indexes and uniqueness on isolated architecture_test.');
  await transaction(async (r) => {
    for (const job of sampleJobs()) await r.put("jobs", job);
  });
  await assert.rejects(
    transaction(async (r) => {
      await r.put("leads", { id: "rollback-probe", subject: "Must roll back" });
      throw new Error("Deliberate transaction rollback");
    }),
  );
  assert.equal(await read((r) => r.get("leads", "rollback-probe")), null);
  const indexes = await client.db("architecture_test").collection("sessions").indexes();
  assert.ok(indexes.some((index) => index.expireAfterSeconds === 0));
  for (const name of ["passwordResets", "verifications", "rateLimits"]) {
    const ttlIndexes = await client.db("architecture_test").collection(name).indexes();
    assert.ok(
      ttlIndexes.some((index) => index.expireAfterSeconds === 0),
      `${name} TTL`,
    );
  }
  server = app.listen(0, "127.0.0.1");
  await new Promise<void>((resolve) => server!.once("listening", resolve));
  const address = server.address();
  assert.ok(address && typeof address !== "string");
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/integration.mjs"], {
      stdio: "inherit",
      env: { ...process.env, TEST_URL: `http://127.0.0.1:${address.port}` },
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`API suite exited ${code}`)),
    );
  });
  await new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, ["tests/features.mjs"], {
      stdio: "inherit",
      env: {
        ...process.env,
        TEST_URL: `http://127.0.0.1:${address.port}`,
        TEST_ORIGIN: "http://localhost:3000",
      },
    });
    child.on("error", reject);
    child.on("exit", (code) =>
      code === 0 ? resolve() : reject(new Error(`Feature suite exited ${code}`)),
    );
  });
  assert.ok(
    await client
      .db("architecture_test")
      .collection("leads")
      .findOne({ subject: "Local test enquiry" }),
  );
  assert.ok((await client.db("architecture_test").collection("applications").countDocuments()) > 0);
  const { expireJobs } = await import("../src/lib/lifecycle.js");
  const { issuePasswordReset, resetPassword } = await import("../src/lib/auth-lifecycle.js");
  const { randomBytes } = await import("node:crypto");
  const { digest, verifyPassword } = await import("../src/lib/security.js");
  const resetToken = await issuePasswordReset("student@example.test");
  assert.ok(resetToken);
  const resetRow = await client
    .db("architecture_test")
    .collection("passwordResets")
    .findOne({ id: digest(resetToken) });
  assert.ok(resetRow?.expiresAtDate instanceof Date);
  const newPassword = randomBytes(24).toString("base64url");
  const results = await Promise.allSettled([
    resetPassword(resetToken, newPassword),
    resetPassword(resetToken, newPassword),
  ]);
  assert.equal(
    results.filter((result) => result.status === "fulfilled").length,
    1,
    "Reset token must be single-use under Mongo transaction concurrency",
  );
  const resetUser = await client
    .db("architecture_test")
    .collection("users")
    .findOne({ email: "student@example.test" });
  assert.ok(resetUser && verifyPassword(newPassword, resetUser.passwordHash));
  assert.equal(
    await client
      .db("architecture_test")
      .collection("sessions")
      .countDocuments({ userId: resetUser.id }),
    0,
  );
  const expired = sampleJobs()[0];
  await client
    .db("architecture_test")
    .collection("jobs")
    .insertMany(
      Array.from({ length: 1050 }, (_, i) => ({
        ...expired,
        id: `retention-${String(i).padStart(5, "0")}`,
        discoveredAt: "2020-01-01T00:00:00.000Z",
        expiresAt: "2020-04-01T00:00:00.000Z",
      })),
    );
  const before = await client.db("architecture_test").collection("applications").countDocuments();
  assert.equal(await expireJobs(), 1050);
  assert.equal(await expireJobs(), 0, "Retention must be idempotent");
  assert.equal(
    await client.db("architecture_test").collection("applications").countDocuments(),
    before,
  );
  // Real HTTP/session transport and Mongo persistence; no Google response is mocked.
  // These settings belong only to this isolated test process.
  process.env.DEMO_MODE = "false";
  process.env.APP_URL = "https://localhost:3000";
  process.env.GOOGLE_CLIENT_ID = "transport-test";
  process.env.GOOGLE_CLIENT_SECRET = "transport-test";
  process.env.GOOGLE_CALLBACK_URL = "https://localhost:3000/api/v1/auth/google/callback";
  const base = `http://127.0.0.1:${address.port}/api/v1`;
  const loginResponse = await fetch(base + "/auth/login", {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: process.env.APP_URL },
    body: JSON.stringify({ email: resetUser.email, password: newPassword }),
  });
  assert.equal(loginResponse.status, 200);
  const sessionHeader = loginResponse.headers.getSetCookie().find(c => c.startsWith("skillonit_session="));
  assert.ok(sessionHeader);
  assert.ok(/;\s*Secure/i.test(sessionHeader));
  assert.ok(/;\s*HttpOnly/i.test(sessionHeader));
  assert.ok(/;\s*SameSite=Lax/i.test(sessionHeader));
  assert.ok(/;\s*Path=\//i.test(sessionHeader));
  assert.ok(!/;\s*Domain=/i.test(sessionHeader));
  const sessionCookie = sessionHeader.split(";")[0];
  const sessionResponse = await fetch(base + "/session", { headers: { Cookie: sessionCookie } });
  assert.equal((await sessionResponse.json()).data.user.id, resetUser.id);
  const startResponse = await fetch(base + "/auth/google", { headers: { Cookie: sessionCookie }, redirect: "manual" });
  assert.equal(startResponse.status, 302);
  const authorization = new URL(startResponse.headers.get("location")!);
  assert.equal(authorization.searchParams.get("code_challenge_method"), "S256");
  const boundState = await client.db("architecture_test").collection("oauthStates").findOne({ id: digest(authorization.searchParams.get("state")!) });
  assert.equal(boundState?.linkUserId, resetUser.id);
  assert.equal(boundState?.linkCredential, digest(resetUser.passwordHash));
  const logoutResponse = await fetch(base + "/auth/logout", { method: "POST", headers: { Cookie: sessionCookie, Origin: process.env.APP_URL } });
  assert.equal(logoutResponse.status, 200);
  const revokedResponse = await fetch(base + "/session", { headers: { Cookie: sessionCookie } });
  assert.equal((await revokedResponse.json()).data.user, null);
  console.log("PASS: password login, secure host-only cookie, session lookup, authenticated OAuth state binding and logout; Google consent not simulated.");
  console.log(
    "PASS: real MongoDB indexes, transaction rollback, API workflows and persisted contact/application records.",
  );
} finally {
  await new Promise<void>((resolve) => (server ? server.close(() => resolve()) : resolve()));
  await closeStore();
  await client.close();
  await replica.stop();
}
