import { randomBytes } from 'node:crypto';
import type { User } from './domain.js';
import { transaction, type Repository } from './store.js';
import { ApiError, audit, digest, hashPassword } from './security.js';

type Reset = { id: string; userId: string; expiresAt: number };
const invalidToken = () =>
  new ApiError(400, 'INVALID_TOKEN', 'This reset link is invalid or expired.');

export async function revokeSessions(r: Repository, userId: string) {
  let after = '';
  for (;;) {
    const rows = await r.scan<{ id: string }>('sessions', { userId }, after);
    if (!rows.length) return;
    for (const row of rows) await r.remove('sessions', row.id);
    after = rows[rows.length - 1].id;
  }
}

// Delivery is deliberately handled by the caller. Raw tokens are never persisted.
export async function issuePasswordReset(email: string) {
  const token = randomBytes(32).toString('base64url');
  return transaction(async (r) => {
    const user = (await r.find<User>('users', { email }, 1))[0];
    if (!user || user.disabled) return null;
    let after = '';
    for (;;) {
      const old = await r.scan<Reset>(
        'passwordResets',
        { userId: user.id },
        after,
      );
      if (!old.length) break;
      for (const row of old) await r.remove('passwordResets', row.id);
      after = old[old.length - 1].id;
    }
    const expiresAt = Date.now() + 30 * 60 * 1000;
    await r.put('passwordResets', {
      id: digest(token),
      userId: user.id,
      expiresAt,
      expiresAtDate: new Date(expiresAt),
    });
    await audit(r, user.id, 'password.reset_requested', user.id);
    return token;
  });
}

export async function resetPassword(token: string, password: string) {
  // Hash before entering a retryable database transaction.
  const passwordHash = hashPassword(password);
  await transaction(async (r) => {
    const reset = await r.get<Reset>('passwordResets', digest(token));
    if (
      !reset ||
      !Number.isFinite(reset.expiresAt) ||
      reset.expiresAt <= Date.now()
    )
      throw invalidToken();
    const user = await r.get<User>('users', reset.userId);
    if (!user || user.disabled) throw invalidToken();
    await r.put('users', { ...user, passwordHash });
    await r.remove('passwordResets', reset.id);
    await revokeSessions(r, user.id);
    await audit(r, user.id, 'password.reset_completed', user.id);
  });
}
