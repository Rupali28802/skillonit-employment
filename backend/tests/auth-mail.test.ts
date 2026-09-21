import { test } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";
import { authMailConfig, authMessage, sendAuthMail } from "../src/lib/auth-mail.js";

test("auth email requires explicit enablement, HTTPS origin and complete SMTP configuration", () => {
  const config = {
    ENABLE_AUTH_EMAIL: "true",
    SMTP_HOST: "smtp.example.test",
    SMTP_PORT: "587",
    SMTP_USER: "test",
    SMTP_PASSWORD: randomBytes(16).toString("hex"),
    AUTH_EMAIL_FROM: "accounts@example.test",
    APP_URL: "https://example.test",
  };
  assert.equal(authMailConfig(config).SMTP_PORT, "587");
  assert.equal(authMailConfig({ ...config, APP_URL: "http://localhost:3100", NODE_ENV: "development" }).APP_URL, "http://localhost:3100");
  assert.throws(() => authMailConfig({ ...config, APP_URL: "http://localhost:3100", NODE_ENV: "production" }));
  for (const change of [
    { ENABLE_AUTH_EMAIL: "false" },
    { SMTP_PASSWORD: "" },
    { APP_URL: "http://example.test" },
    { APP_URL: "https://example.test/redirect" },
    { SMTP_PORT: "25" },
  ])
    assert.throws(() => authMailConfig({ ...config, ...change }));
});

test("auth mail uses fragment links and sanitizes transport errors", async () => {
  const saved = { ...process.env };
  const token = randomBytes(32).toString("base64url");
  Object.assign(process.env, {
    ENABLE_AUTH_EMAIL: "true",
    SMTP_HOST: "smtp.example.test",
    SMTP_PORT: "465",
    SMTP_USER: "test",
    SMTP_PASSWORD: randomBytes(16).toString("hex"),
    AUTH_EMAIL_FROM: "accounts@example.test",
    APP_URL: "https://example.test",
  });
  try {
    const message = authMessage(
      "accounts@example.test",
      "user@example.test",
      "reset-password",
      token,
      "https://example.test",
    );
    assert.ok(message.text.includes("/reset-password#token="));
    assert.ok(!message.text.includes("?token="));
    let sent = false;
    await sendAuthMail("user@example.test", "reset-password", token, {
      async sendMail(mail) {
        sent = true;
        assert.ok(mail.text.includes("/reset-password#token="));
        return { accepted: [mail.to] };
      },
    });
    assert.ok(sent);
    await assert.rejects(
      sendAuthMail("user@example.test", "reset-password", token, {
        async sendMail() {
          throw new Error("sensitive-provider-error");
        },
      }),
      (error: Error) =>
        !error.message.includes("sensitive-provider-error") && !error.message.includes(token),
    );
    await assert.rejects(
      sendAuthMail("user@example.test", "reset-password", token, {
        async sendMail() {
          return { accepted: [] };
        },
      }),
    );
  } finally {
    process.env = saved;
  }
});

test("verification mail contains a six-digit code and no bearer link", () => {
  const otp = String(Math.floor(Math.random() * 1000000)).padStart(6, "0");
  const mail = authMessage(
    "accounts@example.test",
    "user@example.test",
    "verify-email",
    otp,
    "https://example.test",
  );
  assert.ok(mail.text.includes(otp));
  assert.ok(!mail.text.includes("https://") && !mail.text.includes("#token="));
});

test("email connection mail uses a short-lived fragment link and clear security copy", () => {
  const token = randomBytes(32).toString("base64url");
  const mail = authMessage(
    "accounts@example.test",
    "user@example.test",
    "connect-email",
    token,
    "https://example.test",
    "Candidate",
  );
  assert.equal(mail.subject, "Connect your email to SkillOnIT");
  assert.ok(mail.text.includes("Connect My Email"));
  assert.ok(mail.text.includes("expires in 15 minutes"));
  assert.ok(mail.text.includes(`/connect-email#token=${token}`));
  assert.ok(mail.html?.includes("Connect My Email"));
  assert.ok(!mail.text.toLowerCase().includes("gmail password:"));
});
