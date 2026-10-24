import { randomBytes, randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { PlanCode, User } from './domain.js';
import type { Repository, Row } from './store.js';
import { read, transaction } from './store.js';
import { ApiError, audit } from './security.js';
import { decryptRefreshToken, encryptRefreshToken } from '../mailbox-auth.js';

export type ReferralProfile = Row & { userId: string; code: string; createdAt: string };
export type ReferralRecord = Row & { referrerId: string; referredUserId: string; referralCode: string; registeredAt: string; emailVerifiedAt?: string; qualifyingPaymentId?: string; qualifyingPlanCode?: PlanCode };
export type ReferralRewardStatus = 'pending' | 'available' | 'withdrawal_requested' | 'paid' | 'rejected' | 'reversed';
export type ReferralReward = Row & { referrerId: string; referredUserId: string; campaignId: string; qualifyingAction: QualifyingAction; qualifyingEventId: string; amountPaise: number; status: ReferralRewardStatus; createdAt: string; availableAt: string; updatedAt: string; reversedAt?: string; withdrawalId?: string };
export type ReferralWithdrawalStatus = 'requested' | 'approved' | 'processing' | 'paid' | 'rejected' | 'failed';
type EncryptedPayoutHandle = ReturnType<typeof encryptRefreshToken>;
export type ReferralWithdrawal = Row & { userId: string; amountPaise: number; status: ReferralWithdrawalStatus; payoutHandleMasked: string; encryptedPayoutHandle: EncryptedPayoutHandle; rewardIds: string[]; createdAt: string; updatedAt: string; payoutReference?: string; reviewedBy?: string; reviewNote?: string };
export type QualifyingAction = 'email_verified_registration' | 'paid_subscription';
export type ReferralCampaign = Row & { name: string; active: boolean; amountPaise: number; qualifyingAction: QualifyingAction; eligiblePlanCodes: PlanCode[]; startsAt: string | null; endsAt: string | null; maxRewardsPerReferrer: number | null; refundWaitDays: number; minimumWithdrawalPaise: number; createdAt: string; updatedAt: string; updatedBy: string };
type Attribution = Row & { token: string; referrerId: string; referralCode: string; createdAt: string; expiresAt: string; expiresAtDate: Date };

const codeSchema = z.string().trim().toUpperCase().regex(/^[A-Z0-9]{8,20}$/);
const campaignInput = z.object({
  name: z.string().trim().min(1).max(100).default('Default referral campaign'),
  active: z.boolean().default(false),
  amountPaise: z.number().int().min(1).max(10_000_000),
  qualifyingAction: z.enum(['email_verified_registration', 'paid_subscription']).default('paid_subscription'),
  eligiblePlanCodes: z.array(z.string().trim().regex(/^[a-z][a-z0-9-]{1,39}$/)).max(20).default([]),
  startsAt: z.iso.datetime().nullable().default(null),
  endsAt: z.iso.datetime().nullable().default(null),
  maxRewardsPerReferrer: z.number().int().min(1).max(100_000).nullable().default(null),
  refundWaitDays: z.number().int().min(0).max(180).default(14),
  minimumWithdrawalPaise: z.number().int().min(100).max(10_000_000).default(10_000),
}).strict().superRefine((value, context) => {
  if (value.startsAt && value.endsAt && value.startsAt >= value.endsAt)
    context.addIssue({ code: 'custom', path: ['endsAt'], message: 'Campaign end must be after its start.' });
});
const withdrawalInput = z.object({
  amountPaise: z.number().int().positive().max(10_000_000),
  payoutHandle: z.string().trim().regex(/^[A-Za-z0-9._-]{2,80}@[A-Za-z0-9._-]{2,80}$/),
}).strict();
const withdrawalReviewInput = z.object({
  action: z.enum(['approve', 'processing', 'paid', 'reject', 'fail']),
  payoutReference: z.string().trim().max(200).optional(),
  note: z.string().trim().min(3).max(500).optional(),
}).strict().superRefine((value, context) => {
  if (value.action === 'paid' && !value.payoutReference) context.addIssue({ code: 'custom', path: ['payoutReference'], message: 'A confirmed payout reference is required.' });
  if (['reject', 'fail'].includes(value.action) && !value.note) context.addIssue({ code: 'custom', path: ['note'], message: 'A review note is required.' });
});
const backfillInput = z.object({ cursor: z.string().min(1).max(200).optional() }).strict().default({});

const profileId = (userId: string) => `referrer:${userId}`;
const campaignId = 'default-referral-campaign';
const attributionCookie = 'skillonit_referral_attribution';
const appUrl = () => {
  const value = process.env.APP_URL;
  try { const url = new URL(value || 'http://localhost:3000'); return url.origin; }
  catch { return 'http://localhost:3000'; }
};
const nowIso = (now = new Date()) => now.toISOString();
const safeCode = () => randomBytes(7).toString('base64url').replace(/[^A-Za-z0-9]/g, '').toUpperCase().slice(0, 10);
const maskPayoutHandle = (value: string) => {
  const [name, domain] = value.split('@');
  return `${name!.slice(0, 2)}${'•'.repeat(Math.max(2, name!.length - 2))}@${domain}`;
};
const payoutEncryptionKey = () => {
  const key = process.env.REFERRAL_PAYOUT_ENCRYPTION_KEY;
  if (!key || !/^[a-f0-9]{64}$/i.test(key)) throw new ApiError(503, 'REFERRAL_PAYOUT_ENCRYPTION_UNAVAILABLE', 'Reward withdrawals are temporarily unavailable.');
  return key;
};
const sealPayoutHandle = (value: string) => encryptRefreshToken(value, payoutEncryptionKey());
const openPayoutHandle = (value: EncryptedPayoutHandle) => {
  try { return decryptRefreshToken(value, payoutEncryptionKey()); }
  catch { throw new ApiError(503, 'REFERRAL_PAYOUT_ENCRYPTION_UNAVAILABLE', 'Payout details cannot be read securely.'); }
};

function defaultCampaign(now = new Date()): ReferralCampaign {
  const createdAt = nowIso(now);
  return { id: campaignId, name: 'Default referral campaign', active: false, amountPaise: 10_000, qualifyingAction: 'paid_subscription', eligiblePlanCodes: [], startsAt: null, endsAt: null, maxRewardsPerReferrer: null, refundWaitDays: 14, minimumWithdrawalPaise: 10_000, createdAt, updatedAt: createdAt, updatedBy: 'system' };
}

export async function ensureReferralProfile(r: Repository, user: Pick<User, 'id'>, now = new Date()): Promise<ReferralProfile> {
  const existing = await r.get<ReferralProfile>('referralProfiles', profileId(user.id));
  if (existing) return existing;
  for (let attempt = 0; attempt < 20; attempt++) {
    const code = safeCode();
    const collision = (await r.find<ReferralProfile>('referralProfiles', { code }, 1))[0];
    if (collision) continue;
    const row: ReferralProfile = { id: profileId(user.id), userId: user.id, code, createdAt: nowIso(now) };
    await r.put('referralProfiles', row);
    return row;
  }
  throw new ApiError(503, 'REFERRAL_CODE_UNAVAILABLE', 'A referral code could not be generated. Please try again.');
}

export async function createReferralAttribution(codeInput: unknown, currentUserId?: string, now = new Date()) {
  const code = codeSchema.parse(codeInput);
  return transaction(async r => {
    const profile = (await r.find<ReferralProfile>('referralProfiles', { code }, 1))[0];
    if (!profile) throw new ApiError(404, 'REFERRAL_CODE_NOT_FOUND', 'This referral link is unavailable.');
    if (currentUserId && profile.userId === currentUserId) throw new ApiError(409, 'SELF_REFERRAL_FORBIDDEN', 'You cannot use your own referral link.');
    const token = randomBytes(32).toString('base64url');
    const createdAt = nowIso(now), expiresAtDate = new Date(now.getTime() + 30 * 86400000), expiresAt = nowIso(expiresAtDate);
    const attribution: Attribution = { id: `referral-attribution:${token}`, token, referrerId: profile.userId, referralCode: profile.code, createdAt, expiresAt, expiresAtDate };
    await r.put('referralAttributions', attribution);
    return { token, expiresAt };
  });
}

export async function attachRegistrationReferral(r: Repository, referredUser: User, token: string | undefined, now = new Date()) {
  if (!token || !/^[A-Za-z0-9_-]{32,128}$/.test(token)) return null;
  const attribution = await r.get<Attribution>('referralAttributions', `referral-attribution:${token}`);
  if (!attribution || Date.parse(attribution.expiresAt) <= now.getTime() || attribution.referrerId === referredUser.id) return null;
  const existing = await r.get<ReferralRecord>('referrals', referredUser.id);
  if (existing) return existing;
  const referrer = await r.get<User>('users', attribution.referrerId);
  if (!referrer || referrer.disabled) return null;
  const row: ReferralRecord = { id: referredUser.id, referrerId: attribution.referrerId, referredUserId: referredUser.id, referralCode: attribution.referralCode, registeredAt: nowIso(now) };
  await r.put('referrals', row);
  await r.remove('referralAttributions', attribution.id);
  await audit(r, referredUser.id, 'referral.attributed', referredUser.id);
  return row;
}

async function campaign(r: Repository, now = new Date()) {
  const configured = await r.get<ReferralCampaign>('referralCampaigns', campaignId);
  const current = configured ?? defaultCampaign(now);
  if (!configured) await r.put('referralCampaigns', current);
  return current;
}
function campaignIsEligible(value: ReferralCampaign, action: QualifyingAction, planCode?: PlanCode, now = new Date()) {
  return value.active && value.qualifyingAction === action &&
    (!value.startsAt || Date.parse(value.startsAt) <= now.getTime()) &&
    (!value.endsAt || Date.parse(value.endsAt) > now.getTime()) &&
    (!planCode || !value.eligiblePlanCodes.length || value.eligiblePlanCodes.includes(planCode));
}

async function releaseMatureRewards(r: Repository, referrerId: string, now = new Date()) {
  const rows = await r.find<ReferralReward>('referralRewards', { referrerId, status: 'pending' }, 1000);
  let released = 0;
  for (const row of rows) if (Date.parse(row.availableAt) <= now.getTime()) {
    await r.put('referralRewards', { ...row, status: 'available', updatedAt: nowIso(now) });
    released++;
  }
  return released;
}

async function qualify(r: Repository, referredUserId: string, action: QualifyingAction, eventId: string, planCode?: PlanCode, now = new Date()) {
  const referral = await r.get<ReferralRecord>('referrals', referredUserId);
  if (!referral || referral.referrerId === referredUserId) return null;
  const referred = await r.get<User>('users', referredUserId);
  if (!referred || referred.disabled || !referred.verified) return null;
  const current = await campaign(r, now);
  if (!campaignIsEligible(current, action, planCode, now)) return null;
  const unique = `${current.id}:${action}:${referredUserId}`;
  const existing = await r.get<ReferralReward>('referralRewards', unique);
  if (existing) return existing;
  const awarded = await r.find<ReferralReward>('referralRewards', { referrerId: referral.referrerId, campaignId: current.id }, 100_000);
  if (current.maxRewardsPerReferrer !== null && awarded.filter(row => row.status !== 'reversed').length >= current.maxRewardsPerReferrer) return null;
  const availableAt = new Date(now.getTime() + current.refundWaitDays * 86400000);
  const reward: ReferralReward = { id: unique, referrerId: referral.referrerId, referredUserId, campaignId: current.id, qualifyingAction: action, qualifyingEventId: eventId, amountPaise: current.amountPaise, status: 'pending', createdAt: nowIso(now), availableAt: nowIso(availableAt), updatedAt: nowIso(now) };
  await r.put('referralRewards', reward);
  await r.put('referrals', { ...referral, ...(action === 'email_verified_registration' ? { emailVerifiedAt: nowIso(now) } : { qualifyingPaymentId: eventId, qualifyingPlanCode: planCode }) });
  await audit(r, 'referral-engine', 'referral.reward_pending', reward.id);
  return reward;
}

export async function qualifyVerifiedReferral(r: Repository, userId: string, now = new Date()) {
  return qualify(r, userId, 'email_verified_registration', `verified:${userId}`, undefined, now);
}
export async function qualifyPaidReferral(r: Repository, userId: string, orderId: string, planCode: PlanCode, now = new Date()) {
  return qualify(r, userId, 'paid_subscription', orderId, planCode, now);
}
export async function reverseReferralRewardsForPayment(r: Repository, referredUserId: string, orderId: string, now = new Date()) {
  const rows = await r.find<ReferralReward>('referralRewards', { referredUserId, qualifyingEventId: orderId }, 100);
  for (const reward of rows) if (!['reversed', 'rejected'].includes(reward.status)) {
    await r.put('referralRewards', { ...reward, status: 'reversed', reversedAt: nowIso(now), updatedAt: nowIso(now) });
    await audit(r, 'referral-engine', 'referral.reward_reversed', reward.id);
  }
  return rows.length;
}

export async function referralDashboard(user: User, now = new Date()) {
  return transaction(async r => {
    const profile = await ensureReferralProfile(r, user, now);
    await releaseMatureRewards(r, user.id, now);
    const referrals = (await r.find<ReferralRecord>('referrals', { referrerId: user.id }, 1000)).sort((a, b) => b.registeredAt.localeCompare(a.registeredAt));
    const rewards = (await r.find<ReferralReward>('referralRewards', { referrerId: user.id }, 1000)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const withdrawals = (await r.find<ReferralWithdrawal>('referralWithdrawals', { userId: user.id }, 1000)).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const total = (status: ReferralRewardStatus) => rewards.filter(row => row.status === status).reduce((sum, row) => sum + row.amountPaise, 0);
    return {
      code: profile.code, link: `${appUrl()}/register?ref=${encodeURIComponent(profile.code)}`,
      totals: { referrals: referrals.length, emailVerified: referrals.filter(row => !!row.emailVerifiedAt).length, qualifyingConversions: referrals.filter(row => !!row.qualifyingPaymentId).length, pendingPaise: total('pending'), availablePaise: total('available'), paidPaise: total('paid') },
      campaign: await campaign(r, now),
      // A referrer can track referral progress, but never receives another member's profile data.
      referrals: referrals.map(row => ({ id: row.id, registeredAt: row.registeredAt, emailVerified: !!row.emailVerifiedAt, qualifying: !!row.qualifyingPaymentId, name: 'Referred member' })),
      rewards: rewards.map(row => ({ id: row.id, amountPaise: row.amountPaise, status: row.status, action: row.qualifyingAction, createdAt: row.createdAt, availableAt: row.availableAt })),
      withdrawals: withdrawals.map(row => ({ id: row.id, amountPaise: row.amountPaise, status: row.status, payoutHandleMasked: row.payoutHandleMasked, createdAt: row.createdAt, updatedAt: row.updatedAt, payoutReference: row.payoutReference ?? null })),
    };
  });
}

export async function requestReferralWithdrawal(user: User, input: unknown, now = new Date()) {
  const value = withdrawalInput.parse(input);
  return transaction(async r => {
    const current = await campaign(r, now);
    await releaseMatureRewards(r, user.id, now);
    const available = (await r.find<ReferralReward>('referralRewards', { referrerId: user.id, status: 'available' }, 1000)).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const balance = available.reduce((sum, row) => sum + row.amountPaise, 0);
    if (value.amountPaise < current.minimumWithdrawalPaise) throw new ApiError(409, 'WITHDRAWAL_MINIMUM_NOT_REACHED', 'The requested amount is below the configured withdrawal minimum.');
    if (value.amountPaise > balance) throw new ApiError(409, 'INSUFFICIENT_REWARD_BALANCE', 'The requested amount exceeds your available reward balance.');
    let remaining = value.amountPaise; const selected: ReferralReward[] = [];
    for (const reward of available) { if (remaining <= 0) break; if (reward.amountPaise > remaining) break; selected.push(reward); remaining -= reward.amountPaise; }
    if (remaining !== 0) throw new ApiError(409, 'WITHDRAWAL_AMOUNT_NOT_AVAILABLE', 'Choose an amount represented by your available reward credits.');
    const id = randomUUID(), timestamp = nowIso(now);
    const withdrawal: ReferralWithdrawal = { id, userId: user.id, amountPaise: value.amountPaise, status: 'requested', payoutHandleMasked: maskPayoutHandle(value.payoutHandle), encryptedPayoutHandle: sealPayoutHandle(value.payoutHandle), rewardIds: selected.map(row => row.id), createdAt: timestamp, updatedAt: timestamp };
    await r.put('referralWithdrawals', withdrawal);
    for (const reward of selected) await r.put('referralRewards', { ...reward, status: 'withdrawal_requested', withdrawalId: id, updatedAt: timestamp });
    await audit(r, user.id, 'referral.withdrawal_requested', id);
    return { id, status: withdrawal.status, amountPaise: withdrawal.amountPaise };
  });
}

export async function getReferralCampaign(actor: User) {
  return transaction(async r => { const value = await campaign(r); await audit(r, actor.id, 'referral.campaign_viewed', value.id); return value; });
}
export async function updateReferralCampaign(actor: User, input: unknown, now = new Date()) {
  const value = campaignInput.parse(input);
  return transaction(async r => {
    const previous = await campaign(r, now), timestamp = nowIso(now);
    const next: ReferralCampaign = { ...previous, ...value, id: campaignId, createdAt: previous.createdAt, updatedAt: timestamp, updatedBy: actor.id };
    await r.put('referralCampaigns', next); await audit(r, actor.id, 'referral.campaign_updated', next.id); return next;
  });
}
export async function backfillReferralProfiles(actor: User, input: unknown = {}) {
  const { cursor } = backfillInput.parse(input);
  return transaction(async r => {
    const users = await r.scan<User>('users', {}, cursor ?? '', 500);
    let created = 0;
    for (const user of users) {
      if (await r.get<ReferralProfile>('referralProfiles', profileId(user.id))) continue;
      await ensureReferralProfile(r, user);
      created++;
    }
    const nextCursor = users.length === 500 ? users.at(-1)!.id : null;
    await audit(r, actor.id, 'referral.backfill_batch_completed', 'referralProfiles');
    return { processed: users.length, created, nextCursor };
  });
}
export async function adminReferralOverview() {
  return transaction(async r => {
    const [campaignValue, referrals, rewards, withdrawals] = await Promise.all([campaign(r), r.find<ReferralRecord>('referrals', {}, 1000), r.find<ReferralReward>('referralRewards', {}, 1000), r.find<ReferralWithdrawal>('referralWithdrawals', {}, 1000)]);
    return { campaign: campaignValue, totals: { referrals: referrals.length, rewards: rewards.length, pendingPaise: rewards.filter(row => row.status === 'pending').reduce((sum, row) => sum + row.amountPaise, 0), availablePaise: rewards.filter(row => row.status === 'available').reduce((sum, row) => sum + row.amountPaise, 0), withdrawalRequests: withdrawals.filter(row => ['requested', 'approved', 'processing'].includes(row.status)).length }, withdrawals: withdrawals.sort((a, b) => b.createdAt.localeCompare(a.createdAt)).slice(0, 200).map(({ encryptedPayoutHandle: _secret, ...row }) => row) };
  });
}
export async function adminReferralPayoutDetails(id: string) {
  return read(async r => {
    const withdrawal = await r.get<ReferralWithdrawal>('referralWithdrawals', id);
    if (!withdrawal) throw new ApiError(404, 'WITHDRAWAL_NOT_FOUND', 'Withdrawal request not found.');
    return { payoutHandle: openPayoutHandle(withdrawal.encryptedPayoutHandle) };
  });
}
export async function reviewReferralWithdrawal(actor: User, id: string, input: unknown, now = new Date()) {
  const value = withdrawalReviewInput.parse(input);
  return transaction(async r => {
    const current = await r.get<ReferralWithdrawal>('referralWithdrawals', id);
    if (!current) throw new ApiError(404, 'WITHDRAWAL_NOT_FOUND', 'Withdrawal request not found.');
    const map: Record<typeof value.action, ReferralWithdrawalStatus> = { approve: 'approved', processing: 'processing', paid: 'paid', reject: 'rejected', fail: 'failed' };
    const status = map[value.action];
    const transitions: Record<ReferralWithdrawalStatus, ReferralWithdrawalStatus[]> = { requested: ['approved', 'rejected', 'failed'], approved: ['processing', 'rejected', 'failed'], processing: ['paid', 'failed'], paid: [], rejected: [], failed: [] };
    if (!transitions[current.status].includes(status)) throw new ApiError(409, 'INVALID_WITHDRAWAL_TRANSITION', 'This withdrawal status cannot be changed.');
    const timestamp = nowIso(now), next: ReferralWithdrawal = { ...current, status, reviewedBy: actor.id, reviewNote: value.note, payoutReference: value.payoutReference, updatedAt: timestamp };
    await r.put('referralWithdrawals', next);
    for (const rewardId of current.rewardIds) { const reward = await r.get<ReferralReward>('referralRewards', rewardId); if (!reward || reward.withdrawalId !== current.id) continue; await r.put('referralRewards', { ...reward, status: status === 'paid' ? 'paid' : ['rejected', 'failed'].includes(status) ? 'available' : 'withdrawal_requested', updatedAt: timestamp }); }
    await audit(r, actor.id, `referral.withdrawal_${status}`, current.id); return next;
  });
}

export const referralAttributionCookie = attributionCookie;
