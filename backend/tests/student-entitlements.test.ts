import test from 'node:test';
import assert from 'node:assert/strict';
import type { Repository, Row } from '../src/lib/store.ts';
import type { User } from '../src/lib/domain.ts';
import { plans } from '../src/lib/domain.ts';
import {
  activatePaidSubscription,
  consumeEntitlement,
  entitlementUsage,
  expireStudentSubscriptionsInRepository,
  resolveStudentEntitlements,
  type StudentSubscription,
} from '../src/lib/student-entitlements.ts';

function repository(seed: Record<string, Row[]> = {}): Repository {
  const data = new Map(Object.entries(seed).map(([collection, rows]) => [collection, new Map(rows.map(row => [row.id, structuredClone(row)]))]));
  const collection = (name: string) => { let rows = data.get(name); if (!rows) data.set(name, rows = new Map()); return rows; };
  const matches = (row: Row, query: Record<string, unknown>) => Object.entries(query).every(([key, expected]) => {
    if (expected && typeof expected === 'object' && '$lt' in expected) return String(row[key]) < String((expected as { $lt: unknown }).$lt);
    return row[key] === expected;
  });
  return {
    async count(name, query = {}) { return [...collection(name).values()].filter(row => matches(row, query)).length; },
    async scan<T>(name, query, after = '', limit = 250) { return [...collection(name).values()].filter(row => row.id > after && matches(row, query)).slice(0, limit) as T[]; },
    async find<T>(name, query = {}, limit = 100) { return [...collection(name).values()].filter(row => matches(row, query)).slice(0, limit) as T[]; },
    async get<T>(name, id) { return (collection(name).get(id) as T | undefined) ?? null; },
    async put(name, row) { collection(name).set(row.id, structuredClone(row) as Row); },
    async remove(name, id) { collection(name).delete(id); },
  };
}

function student(overrides: Partial<User> = {}): User {
  return {
    id: 'student-1', email: 'student@example.test', name: 'Student', passwordHash: null, role: 'student', plan: 'premium', verified: true,
    createdAt: '2026-01-01T00:00:00.000Z', profile: { name: 'Student', headline: '', skills: ['TypeScript'], experience: 2, education: '', country: 'India', city: 'Pune', confirmed: true },
    preferences: { roles: [], relatedRoles: [], countries: [], modes: [], exclusions: [], automation: true, dailyCap: 40, automationConstraints: { enabled: true, dailyCap: 8, minimumMatch: 0, excludedMethods: [] } },
    ...overrides,
  };
}

test('missing or expired paid subscription safely falls back to Basic', async () => {
  const user = student();
  const r = repository({ users: [user as unknown as Row] });
  const missing = await resolveStudentEntitlements(r, user, plans, new Date('2026-02-01T00:00:00Z'));
  assert.equal(missing.plan.code, 'basic');
  assert.equal(missing.features.autoApply, false);
  await r.put('studentSubscriptions', {
    id: user.id, userId: user.id, planCode: 'premium', status: 'active', currentPeriodStart: '2026-01-01T00:00:00Z', currentPeriodEnd: '2026-01-31T00:00:00Z',
    autoRenew: false, cancelAtPeriodEnd: false, revision: 1, source: 'admin', planSnapshot: plans[2], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', activatedAt: '2026-01-01T00:00:00Z',
  } satisfies StudentSubscription);
  const expired = await resolveStudentEntitlements(r, user, plans, new Date('2026-02-01T00:00:00Z'));
  assert.equal(expired.subscriptionStatus, 'expired');
  assert.equal(expired.plan.code, 'basic');
});

test('active subscription resolves immutable plan snapshot and separate quota caps', async () => {
  const user = student();
  const paidPlan = { ...plans[2], dailyCap: 30, autoApplyDailyCap: 12 };
  const subscription: StudentSubscription = {
    id: user.id, userId: user.id, planCode: 'premium', status: 'active', currentPeriodStart: '2026-01-01T00:00:00Z', currentPeriodEnd: '2026-03-01T00:00:00Z',
    autoRenew: true, cancelAtPeriodEnd: false, revision: 1, source: 'admin', planSnapshot: paidPlan, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', activatedAt: '2026-01-01T00:00:00Z',
  };
  const r = repository({ users: [user as unknown as Row], studentSubscriptions: [subscription as unknown as Row] });
  const entitlements = await resolveStudentEntitlements(r, user, plans, new Date('2026-02-01T00:00:00Z'));
  assert.equal(entitlements.plan.code, 'premium');
  assert.equal(entitlements.limits.applicationsPerDay, 30);
  assert.equal((await entitlementUsage(r, user, entitlements, 'applications', new Date('2026-02-01T00:00:00Z'))).cap, 30);
  assert.equal((await entitlementUsage(r, user, entitlements, 'auto_apply', new Date('2026-02-01T00:00:00Z'))).cap, 8);
  await consumeEntitlement(r, user, entitlements, 'applications', new Date('2026-02-01T00:00:00Z'));
  await consumeEntitlement(r, user, entitlements, 'auto_apply', new Date('2026-02-01T00:00:00Z'));
  assert.equal((await entitlementUsage(r, user, entitlements, 'applications', new Date('2026-02-01T00:00:00Z'))).used, 1);
  assert.equal((await entitlementUsage(r, user, entitlements, 'auto_apply', new Date('2026-02-01T00:00:00Z'))).used, 1);
});

test('verified payment activates once, preserves identity and extends same-plan renewal', async () => {
  const user = student({ plan: 'basic' });
  const paidPlans = plans.map(plan => plan.code === 'pro' ? { ...plan, price: 999 } : plan);
  const r = repository({ users: [user as unknown as Row] });
  const first = await activatePaidSubscription(r, { userId: user.id, planCode: 'pro', providerPaymentId: 'pay-1' }, paidPlans, new Date('2026-02-01T00:00:00Z'));
  const replay = await activatePaidSubscription(r, { userId: user.id, planCode: 'pro', providerPaymentId: 'pay-1' }, paidPlans, new Date('2026-02-02T00:00:00Z'));
  assert.equal(replay.revision, first.revision);
  const renewed = await activatePaidSubscription(r, { userId: user.id, planCode: 'pro', providerPaymentId: 'pay-2' }, paidPlans, new Date('2026-02-02T00:00:00Z'));
  assert.equal(renewed.revision, first.revision + 1);
  assert.ok(Date.parse(renewed.currentPeriodEnd) > Date.parse(first.currentPeriodEnd));
  assert.equal((await r.get<User>('users', user.id))?.plan, 'pro');
});

test('quota consumption rejects at the enforced cap', async () => {
  const user = student({ preferences: { ...student().preferences, dailyCap: 1 } });
  const r = repository({ users: [user as unknown as Row] });
  const entitlements = await resolveStudentEntitlements(r, user, plans, new Date('2026-02-01T00:00:00Z'));
  await consumeEntitlement(r, user, entitlements, 'applications', new Date('2026-02-01T00:00:00Z'));
  await assert.rejects(() => consumeEntitlement(r, user, entitlements, 'applications', new Date('2026-02-01T00:00:00Z')), /allowance has been reached/i);
});

test('expiry worker revokes paid entitlement and returns the user to Basic', async () => {
  const user = student();
  const expired: StudentSubscription = {
    id: user.id, userId: user.id, planCode: 'premium', status: 'active', currentPeriodStart: '2026-01-01T00:00:00Z', currentPeriodEnd: '2026-01-31T00:00:00Z',
    autoRenew: true, cancelAtPeriodEnd: false, revision: 1, source: 'admin', planSnapshot: plans[2], createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z', activatedAt: '2026-01-01T00:00:00Z',
  };
  const r = repository({ users: [user as unknown as Row], studentSubscriptions: [expired as unknown as Row] });
  assert.deepEqual(await expireStudentSubscriptionsInRepository(r, new Date('2026-02-01T00:00:00Z')), { expired: 1 });
  assert.equal((await r.get<StudentSubscription>('studentSubscriptions', user.id))?.status, 'expired');
  assert.equal((await r.get<User>('users', user.id))?.plan, 'basic');
});
