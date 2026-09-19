import test from 'node:test';
import assert from 'node:assert/strict';
import { createHmac } from 'node:crypto';
import type { Repository, Row } from '../src/lib/store.ts';
import { plans, type User } from '../src/lib/domain.ts';
import { RazorpayProvider } from '../src/lib/providers.ts';
import { processRazorpayWebhook, type PaymentRecord } from '../src/lib/payment-billing.ts';
import type { StudentSubscription } from '../src/lib/student-entitlements.ts';

function repository(seed: Record<string, Row[]> = {}) {
  const data = new Map(Object.entries(seed).map(([name, rows]) => [name, new Map(rows.map(row => [row.id, structuredClone(row)]))]));
  const collection = (name: string) => { let rows = data.get(name); if (!rows) data.set(name, rows = new Map()); return rows; };
  const matches = (row: Row, query: Record<string, unknown>) => Object.entries(query).every(([key, value]) => row[key] === value);
  const repo: Repository = {
    async count(name, query = {}) { return [...collection(name).values()].filter(row => matches(row, query)).length; },
    async scan<T>(name, query, after = '', limit = 250) { return [...collection(name).values()].filter(row => row.id > after && matches(row, query)).slice(0, limit) as T[]; },
    async find<T>(name, query = {}, limit = 100) { return [...collection(name).values()].filter(row => matches(row, query)).slice(0, limit) as T[]; },
    async get<T>(name, id) { return (collection(name).get(id) as T | undefined) ?? null; },
    async put(name, row) { collection(name).set(row.id, structuredClone(row) as Row); },
    async remove(name, id) { collection(name).delete(id); },
  };
  return repo;
}

const user: User = {
  id: 'billing-user', email: 'billing@example.test', name: 'Billing User', passwordHash: null, role: 'student', plan: 'basic', verified: true,
  createdAt: '2026-01-01T00:00:00Z', profile: { name: 'Billing User', headline: '', skills: [], experience: null, education: '', country: '', city: '', confirmed: false },
  preferences: { roles: [], relatedRoles: [], countries: [], modes: [], exclusions: [], automation: false, dailyCap: 5 },
};
const paidPlans = plans.map(plan => plan.code === 'pro' ? { ...plan, price: 999 } : plan);
const order: PaymentRecord = { id: 'order-1', userId: user.id, planCode: 'pro', status: 'created', amount: 99900, currency: 'INR', refundedAmount: 0, createdAt: '2026-01-01T00:00:00Z', updatedAt: '2026-01-01T00:00:00Z' };

test('Razorpay webhook and checkout signatures are HMAC verified', () => {
  const previousWebhook = process.env.RAZORPAY_WEBHOOK_SECRET, previousKey = process.env.RAZORPAY_KEY_SECRET;
  process.env.RAZORPAY_WEBHOOK_SECRET = 'webhook-test-secret'; process.env.RAZORPAY_KEY_SECRET = 'key-test-secret';
  try {
    const provider = new RazorpayProvider(), body = '{"event":"payment.captured"}';
    assert.equal(provider.verify(body, createHmac('sha256', 'webhook-test-secret').update(body).digest('hex')), true);
    assert.equal(provider.verify(body, '00'), false);
    const signature = createHmac('sha256', 'key-test-secret').update('order-1|pay-1').digest('hex');
    assert.equal(provider.verifyCheckout('order-1', 'pay-1', signature), true);
    assert.equal(provider.verifyCheckout('order-1', 'pay-other', signature), false);
  } finally { process.env.RAZORPAY_WEBHOOK_SECRET = previousWebhook; process.env.RAZORPAY_KEY_SECRET = previousKey; }
});

test('captured webhook activates exactly once and writes billing history', async () => {
  const r = repository({ users: [user as unknown as Row], payments: [order as unknown as Row] });
  const event = { event: 'payment.captured', payload: { payment: { entity: { id: 'pay-1', order_id: order.id, amount: order.amount, currency: order.currency } } } };
  assert.deepEqual(await processRazorpayWebhook(r, 'event-1', event, paidPlans, new Date('2026-02-01T00:00:00Z')), { duplicate: false, outcome: 'captured' });
  assert.deepEqual(await processRazorpayWebhook(r, 'event-1', event, paidPlans, new Date('2026-02-01T00:01:00Z')), { duplicate: true });
  assert.deepEqual(await processRazorpayWebhook(r, 'event-2', event, paidPlans, new Date('2026-02-01T00:02:00Z')), { duplicate: false, outcome: 'captured_duplicate' });
  assert.equal((await r.get<PaymentRecord>('payments', order.id))?.status, 'captured');
  assert.equal((await r.get<StudentSubscription>('studentSubscriptions', user.id))?.status, 'active');
  assert.equal(await r.count('billingRecords', { userId: user.id }), 1);
});

test('failed payment records a safe failure without activating subscription', async () => {
  const r = repository({ users: [user as unknown as Row], payments: [order as unknown as Row] });
  await processRazorpayWebhook(r, 'event-failed', { event: 'payment.failed', payload: { payment: { entity: { id: 'pay-failed', order_id: order.id, error_code: 'BAD_REQUEST_ERROR' } } } }, paidPlans);
  assert.equal((await r.get<PaymentRecord>('payments', order.id))?.status, 'failed');
  assert.equal(await r.get('studentSubscriptions', user.id), null);
});

test('partial and full processed refunds update billing and revoke the refunded subscription', async () => {
  const captured = { ...order, status: 'captured' as const, providerPaymentId: 'pay-1' };
  const subscription: StudentSubscription = { id: user.id, userId: user.id, planCode: 'pro', status: 'active', currentPeriodStart: '2026-02-01T00:00:00Z', currentPeriodEnd: '2026-03-01T00:00:00Z', autoRenew: false, cancelAtPeriodEnd: false, revision: 1, source: 'razorpay', providerPaymentId: 'pay-1', planSnapshot: paidPlans[1], createdAt: '2026-02-01T00:00:00Z', updatedAt: '2026-02-01T00:00:00Z', activatedAt: '2026-02-01T00:00:00Z' };
  const r = repository({ users: [{ ...user, plan: 'pro' } as unknown as Row], payments: [captured as unknown as Row], studentSubscriptions: [subscription as unknown as Row] });
  await processRazorpayWebhook(r, 'refund-1', { event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd-1', payment_id: 'pay-1', amount: 10000 } } } }, paidPlans);
  assert.equal((await r.get<PaymentRecord>('payments', order.id))?.status, 'partially_refunded');
  assert.deepEqual(await processRazorpayWebhook(r, 'refund-1-retry', { event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd-1', payment_id: 'pay-1', amount: 10000 } } } }, paidPlans), { duplicate: false, outcome: 'refund_duplicate' });
  await processRazorpayWebhook(r, 'refund-2', { event: 'refund.processed', payload: { refund: { entity: { id: 'rfnd-2', payment_id: 'pay-1', amount: 89900 } } } }, paidPlans);
  assert.equal((await r.get<PaymentRecord>('payments', order.id))?.status, 'refunded');
  assert.equal((await r.get<StudentSubscription>('studentSubscriptions', user.id))?.status, 'cancelled');
  assert.equal((await r.get<User>('users', user.id))?.plan, 'basic');
});
