import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { transaction, read } from "../src/lib/store.js";
import { createEmailOtp, verifyEmailOtp } from "../src/lib/email-otp.js";

export async function checkEmailOtp() {
  const id = randomUUID(),
    email = id + "@example.test";
  const key = "email-otp:" + id;
  await transaction((r) => r.put("users", { id, email, verified: false, role: "student" }));
  const issue = () => transaction((r) => createEmailOtp(r, id));
  const change = async (value: object) =>
    transaction(async (r) => {
      const row = await r.get<{ id: string }>("verifications", key);
      await r.put("verifications", { ...row!, ...value });
    });
  const first = await issue();
  assert.match(first, /^[0-9]{6}$/);
  const row = await read((r) => r.get<Record<string, unknown>>("verifications", key));
  assert.equal(row?.otp, undefined);
  assert.notEqual(row?.otpDigest, first);
  assert.equal(String(row?.otpDigest).length, 64);
  await assert.rejects(issue(), { code: "RESEND_COOLDOWN" });
  const wrong = String((Number(first) + 1) % 1000000).padStart(6, "0");
  for (let i = 0; i < 5; i++) await assert.rejects(verifyEmailOtp(email, wrong));
  assert.equal((await read((r) => r.get<{ attempts: number }>("verifications", key)))?.attempts, 5);
  await assert.rejects(verifyEmailOtp(email, first));
  await change({ resendAfter: 0 });
  await assert.rejects(issue(), { code: "OTP_ATTEMPTS_EXCEEDED" });
  await change({ expiresAt: Date.now() - 1 });
  await assert.rejects(verifyEmailOtp(email, first));
  const replacement = await issue();
  assert.notEqual(
    (await read((r) => r.get<Record<string, unknown>>("verifications", key)))?.otpDigest,
    row?.otpDigest,
  );
  await assert.rejects(verifyEmailOtp("missing-" + email, replacement));
  const results = await Promise.allSettled([
    verifyEmailOtp(email, replacement),
    verifyEmailOtp(email, replacement),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  await assert.rejects(verifyEmailOtp(email, replacement));
  assert.equal(await read((r) => r.get("verifications", key)), null);
  const user = await read((r) => r.get<{ verified: boolean; role: string }>("users", id));
  assert.equal(user?.verified, true);
  assert.equal(user?.role, "student");
  assert.equal(await read((r) => r.count("sessions", { userId: id })), 0);
  const logs = await read((r) => r.find<Record<string, unknown>>("auditLogs", { actorId: id }));
  assert.ok(
    logs.every((r) =>
      Object.keys(r).every((k) => ["id", "actorId", "action", "entityId", "createdAt", "expiresAtDate"].includes(k)),
    ),
  );
  await transaction(async (r) => {
    await r.put("users", { id, email, verified: false, disabled: true });
  });
  const disabledCode = await issue();
  await assert.rejects(verifyEmailOtp(email, disabledCode));
  await transaction(async (r) => {
    await r.remove("users", id);
    await r.remove("verifications", key);
    for (const log of logs) await r.remove("auditLogs", String(log.id));
  });
}
