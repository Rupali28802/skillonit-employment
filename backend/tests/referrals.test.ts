import test from 'node:test';
import assert from 'node:assert/strict';
import type { Repository, Row } from '../src/lib/store.ts';
import type { User } from '../src/lib/domain.ts';
import { attachRegistrationReferral, ensureReferralProfile, qualifyPaidReferral, qualifyVerifiedReferral, reverseReferralRewardsForPayment } from '../src/lib/referrals.ts';

function repository(seed: Record<string, Row[]> = {}) {
  const data = new Map(Object.entries(seed).map(([name, rows]) => [name, new Map(rows.map(row => [row.id, structuredClone(row)]))]));
  const collection = (name: string) => { let rows = data.get(name); if (!rows) data.set(name, rows = new Map()); return rows; };
  const matches = (row: Row, query: Record<string, unknown>) => Object.entries(query).every(([key, value]) => row[key] === value);
  const repo: Repository = {
    async putMany(name, rows) { for (const row of rows) collection(name).set(row.id, structuredClone(row) as Row); },
    async page(name, query, _sort, skip, limit) { return [...collection(name).values()].filter(row => matches(row, query)).slice(skip, skip + limit); },
    async count(name, query = {}) { return [...collection(name).values()].filter(row => matches(row, query)).length; },
    async scan<T>(name, query, after = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi0123456789_-', limit = 250) { return [...collection(name).values()].filter(row => row.id > after && matches(row, query)).sort((a, b) => a.id.localeCompare(b.id)).slice(0, limit) as T[]; },
    async find<T>(name, query = {}, limit = 100) { return [...collection(name).values()].filter(row => matches(row, query)).slice(0, limit) as T[]; },
    async get<T>(name, id) { return (collection(name).get(id) as T | undefined) ?? null; },
    async put(name, row) { collection(name).set(row.id, structuredClone(row) as Row); },
    async remove(name, id) { collection(name).delete(id); },
  };
  return repo;
}
function user(id: string, verified = true): User {
  return { id, email: `${id}@example.test`, name: id, passwordHash: null, role: 'student', plan: 'basic', verified, createdAt: '2026-01-01T00:00:00.000Z', profile: { name: id, headline: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi0123456789_-', skills: [], experience: null, education: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi0123456789_-', country: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi0123456789_-', city: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi0123456789_-', confirmed: false }, preferences: { roles: [], relatedRoles: [], countries: [], modes: [], exclusions: [], automation: false, dailyCap: 5 } };
}
const campaign = { id: 'default-referral-campaign', name: 'Paid rewards', active: true, amountPaise: 12_500, qualifyingAction: 'paid_subscription', eligiblePlanCodes: ['pro'], startsAt: null, endsAt: null, maxRewardsPerReferrer: null, refundWaitDays: 14, minimumWithdrawalPaise: 10_000, createdAt: '2026-01-01T00:00:00.000Z', updatedAt: '2026-01-01T00:00:00.000Z', updatedBy: 'admin' } as Row;

test('referral codes are unique, attribution is immutable, and a free referrer qualifies from a paid referral', async () => {
  const referrer = user('referrer'), referred = user('referred');
  const r = repository({ users: [referrer as unknown as Row, referred as unknown as Row], referralCampaigns: [campaign], referralAttributions: [{ id: 'referral-attribution:ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi0123456789_-', token: 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi0123456789_-', referrerId: referrer.id, referralCode: 'REFERRER10', createdAt: '2026-01-01T00:00:00.000Z', expiresAt: '2026-02-01T00:00:00.000Z' }] });
  const one = await ensureReferralProfile(r, referrer, new Date('2026-01-01T00:00:00.000Z'));
  const two = await ensureReferralProfile(r, referrer, new Date('2026-01-02T00:00:00.000Z'));
  assert.equal(one.code, two.code);
  const record = await attachRegistrationReferral(r, referred, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi0123456789_-', new Date('2026-01-02T00:00:00.000Z'));
  assert.equal(record?.referrerId, referrer.id);
  assert.equal(await attachRegistrationReferral(r, referred, 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghi0123456789_-', new Date('2026-01-03T00:00:00.000Z')), null, 'consumed attribution cannot be applied again');
  assert.equal((await r.get<Row>('referrals', referred.id))?.referrerId, referrer.id, 'finalized attribution remains unchanged');
  const reward = await qualifyPaidReferral(r, referred.id, 'order-1', 'pro', new Date('2026-01-03T00:00:00.000Z'));
  assert.equal(reward?.status, 'pending');
  assert.equal(reward?.amountPaise, 12_500);
  assert.deepEqual(await qualifyPaidReferral(r, referred.id, 'order-1', 'pro', new Date('2026-01-03T00:01:00.000Z')), reward, 'duplicate payment processing is idempotent');
  assert.equal(await r.count('referralRewards', { referrerId: referrer.id }), 1);
});

test('self referrals never qualify and a refund reverses the single matching credit', async () => {
  const referrer = user('referrer'), referred = user('referred');
  const r = repository({ users: [referrer as unknown as Row, referred as unknown as Row], referralCampaigns: [campaign], referrals: [{ id: referred.id, referrerId: referrer.id, referredUserId: referred.id, referralCode: 'REFERRER10', registeredAt: '2026-01-01T00:00:00.000Z' }] });
  assert.equal(await qualifyVerifiedReferral(r, referred.id, new Date('2026-01-02T00:00:00.000Z')), null, 'paid campaign does not reward verification');
  const reward = await qualifyPaidReferral(r, referred.id, 'order-2', 'pro', new Date('2026-01-02T00:00:00.000Z'));
  assert.equal(reward?.status, 'pending');
  assert.equal(await reverseReferralRewardsForPayment(r, referred.id, 'order-2', new Date('2026-01-04T00:00:00.000Z')), 1);
  assert.equal((await r.get<Row>('referralRewards', reward!.id))?.status, 'reversed');
  await r.put('referrals', { id: referrer.id, referrerId: referrer.id, referredUserId: referrer.id, referralCode: 'REFERRER10', registeredAt: '2026-01-01T00:00:00.000Z' });
  assert.equal(await qualifyPaidReferral(r, referrer.id, 'order-self', 'pro', new Date('2026-01-05T00:00:00.000Z')), null);
});