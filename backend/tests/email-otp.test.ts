import { test } from "node:test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { checkEmailOtp } from "./email-otp-checks.js";

test("OTP attempt persistence, expiry, cooldown, concurrent use, isolation and audit security", async () => {
  const previous = process.cwd(),
    saved = { ...process.env };
  const dir = await mkdtemp(path.join(tmpdir(), "skillonit-otp-"));
  try {
    process.chdir(dir);
    delete process.env.MONGODB_URI;
    process.env.DEMO_MODE = "true";
    process.env.APP_URL = "http://localhost:3000";
    await checkEmailOtp();
  } finally {
    process.chdir(previous);
    process.env = saved;
    if (
      path.dirname(dir) === path.resolve(tmpdir()) &&
      path.basename(dir).startsWith("skillonit-otp-")
    )
      await rm(dir, { recursive: true, force: true });
  }
});
