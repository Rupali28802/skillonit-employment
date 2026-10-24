import { createHmac, randomBytes, randomInt, timingSafeEqual } from "node:crypto";
import { demoMode, transaction, type Repository } from "./store.js";
import { ApiError, audit } from "./security.js";
import type { User } from "./domain.js";
import { qualifyVerifiedReferral } from './referrals.js';

const demoKey = randomBytes(32).toString("hex");
const lifetime = 5 * 60_000;
const cooldown = 60_000;
const maxAttempts = 5;
type Challenge = {
  id: string;
  userId: string;
  nonce: string;
  otpDigest: string;
  expiresAt: number;
  expiresAtDate: Date;
  resendAfter: number;
  attempts: number;
};

export function otpKey() {
  const key = process.env.AUTH_OTP_SECRET;
  if (key && /^[a-f0-9]{64,}$/i.test(key)) return key;
  if (demoMode()) return demoKey;
  throw new ApiError(503, "VERIFICATION_UNAVAILABLE", "Email verification is unavailable.");
}
function mac(userId: string, nonce: string, otp: string) {
  return createHmac("sha256", otpKey())
    .update(JSON.stringify([userId, nonce, otp]))
    .digest("hex");
}
export async function createEmailOtp(r: Repository, userId: string) {
  const id = "email-otp:" + userId;
  const previous = await r.get<Challenge>("verifications", id);
  if (previous && previous.resendAfter > Date.now())
    throw new ApiError(429, "RESEND_COOLDOWN", "Please wait before requesting another code.");
  // A new code must not reset a still-active guessing budget.
  if (previous && previous.expiresAt > Date.now() && previous.attempts >= maxAttempts)
    throw new ApiError(429, "OTP_ATTEMPTS_EXCEEDED", "Please wait before requesting another code.");
  const otp = randomInt(0, 1_000_000).toString().padStart(6, "0");
  const nonce = randomBytes(16).toString("hex");
  const expiresAt =
    previous && previous.expiresAt > Date.now() ? previous.expiresAt : Date.now() + lifetime;
  await r.put("verifications", {
    id,
    userId,
    nonce,
    otpDigest: mac(userId, nonce, otp),
    expiresAt,
    expiresAtDate: new Date(expiresAt),
    resendAfter: Date.now() + cooldown,
    attempts: previous && previous.expiresAt > Date.now() ? previous.attempts : 0,
  });
  return otp;
}
export async function verifyEmailOtp(email: string, otp: string) {
  otpKey();
  const success = await transaction(async (r) => {
    const user = (await r.find<User>("users", { email }, 1))[0];
    if (!user || user.disabled || user.verified) return false;
    const row = await r.get<Challenge>("verifications", "email-otp:" + user.id);
    if (
      !row ||
      !Number.isFinite(row.expiresAt) ||
      row.expiresAt <= Date.now() ||
      row.attempts >= maxAttempts
    )
      return false;
    const expected = Buffer.from(row.otpDigest, "hex");
    const actual = Buffer.from(mac(user.id, row.nonce, otp), "hex");
    if (expected.length !== actual.length || !timingSafeEqual(expected, actual)) {
      await r.put("verifications", { ...row, attempts: row.attempts + 1 });
      await audit(r, user.id, "email.verification_failed", user.id);
      return false; // Commit the attempt before returning an error to the caller.
    }
    await r.put("users", { ...user, verified: true });
    await qualifyVerifiedReferral(r, user.id);
    await r.remove("verifications", row.id);
    await audit(r, user.id, "email.verified", user.id);
    return true;
  });
  if (!success)
    throw new ApiError(400, "INVALID_OTP", "The code is invalid, expired or unavailable.");
}
