import { razorpayVersionMatches } from './razorpay-configuration.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Plan, PlanCode, User } from './domain.js';
import type { PaymentProvider } from './providers.js';
import type { Repository, Row } from './store.js';
import { configuredPlans, read, transaction } from './store.js';
import { ApiError, audit, digest } from './security.js';
import { activatePaidSubscription, type StudentSubscription } from './student-entitlements.js';
import { processRecurringEvent } from './recurring-billing.js';

export type PaymentStatus = 'created' | 'authorized' | 'captured' | 'failed' | 'partially_refunded' | 'refunded';
export type PaymentRecord = {
  id: string; userId: string; planCode: PlanCode; status: PaymentStatus; amount: number; currency: string;
  refundedAmount: number; createdAt: string; updatedAt: string; providerPaymentId?: string; failureCode?: string;
  razorpayConfigVersion?: string; paymentMethod?: string; capturedAt?: string; failedAt?: string;
};
export type BillingRecord = {
  id: string; userId: string; orderId: string; paymentId?: string; refundId?: string;
  type: 'order_created' | 'payment_authorized' | 'payment_captured' | 'payment_failed' | 'refund_requested' | 'refund_processed' | 'refund_failed';
  amount: number; currency: string; createdAt: string;
};

const idempotencySchema = z.string().trim().regex(/^[a-zA-Z0-9][a-zA-Z0-9._:-]{7,127}$/);
const providerOrderSchema = z.object({ id: z.string().min(1).max(100), amount: z.number().int().positive(), currency: z.string().regex(/^[A-Z]{3}$/) }).strict();
const checkoutVerificationSchema = z.object({ razorpay_order_id: z.string().min(1).max(100), razorpay_payment_id: z.string().min(1).max(100), razorpay_signature: z.string().regex(/^[a-f0-9]{64}$/i) }).strict();
export const refundRequestSchema = z.object({ amount: z.number().int().positive().optional(), reason: z.string().trim().min(3).max(300), idempotencyKey: idempotencySchema }).strict();

function minorAmount(plan: Plan) {
  if (plan.price === null || !Number.isFinite(plan.price) || plan.price <= 0) throw new ApiError(503, 'PRICING_PENDING', 'Paid subscriptions are not open yet. Final pricing is being configured.');
  const amount = Math.round(plan.price * 100);
  if (Math.abs(amount / 100 - plan.price) > 0.000001) throw new ApiError(503, 'PLAN_CONFIGURATION_INVALID', 'Plan pricing requires administrator review.');
  return amount;
}

async function billing(r: Repository, input: Omit<BillingRecord, 'id' | 'createdAt'>, now = new Date()) {
  const row: BillingRecord = { id: randomUUID(), createdAt: now.toISOString(), ...input };
  await r.put('billingRecords', row);
  return row;
}

export async function createPaymentOrder(user: User, planCode: PlanCode, idempotencyKey: string, provider: PaymentProvider, now = new Date()) {
  const key = idempotencySchema.parse(idempotencyKey), plans = await configuredPlans();
  const plan = plans.find(item => item.code === planCode);
  if (!plan || plan.code === 'basic') throw new ApiError(409, 'PAID_PLAN_REQUIRED', 'Select an available paid plan.');
  const amount = minorAmount(plan), requestId = digest(`${user.id}:checkout:${key}`);
  const prior = await read(r => r.get<{ id: string; userId: string; orderId?: string; status: string }>('paymentCheckoutRequests', requestId));
  if (prior?.userId !== undefined && prior.userId !== user.id) throw new ApiError(409, 'IDEMPOTENCY_CONFLICT', 'Checkout request conflict.');
  if (prior?.orderId) {
    const payment = await read(r => r.get<PaymentRecord>('payments', prior.orderId!));
    if(payment&&!await razorpayVersionMatches(payment.razorpayConfigVersion,provider.configVersion))throw new ApiError(409,'CHECKOUT_CONFIGURATION_CHANGED','Start a new checkout after the payment configuration change.');
    if (payment) return { order: { id: payment.id, amount: payment.amount, currency: payment.currency }, keyId: provider.keyId, reused: true };
  }
  if (prior?.status === 'creating') throw new ApiError(409, 'CHECKOUT_IN_PROGRESS', 'This checkout is already being created.');
  await transaction(async r => {
    const latest = await r.get<User>('users', user.id);
    if (!latest || latest.disabled || latest.role !== 'student') throw new ApiError(403, 'FORBIDDEN', 'A student account is required.');
    await r.put('paymentCheckoutRequests', { id: requestId, userId: user.id, planCode, status: 'creating', createdAt: now.toISOString(), updatedAt: now.toISOString() });
  });
  let order: z.infer<typeof providerOrderSchema>;
  try {
    order = providerOrderSchema.parse(await provider.checkout({ amount, currency: plan.currency, receipt: requestId.slice(0, 40) }));
    if (order.amount !== amount || order.currency !== plan.currency) throw new ApiError(503, 'PAYMENT_PROVIDER_MISMATCH', 'The payment provider returned an invalid order.');
  }
  catch (error) {
    await transaction(async r => { const row = await r.get<Row>('paymentCheckoutRequests', requestId); if (row) await r.put('paymentCheckoutRequests', { ...row, status: 'failed', updatedAt: new Date().toISOString() }); });
    throw error;
  }
  await transaction(async r => {
    const collision = await r.get<PaymentRecord>('payments', order.id);
    if (collision && collision.userId !== user.id) throw new ApiError(409, 'PAYMENT_CONFLICT', 'Payment order conflict.');
    const record: PaymentRecord = { razorpayConfigVersion:provider.configVersion, id: order.id, userId: user.id, planCode, status: 'created', amount: order.amount, currency: order.currency, refundedAmount: 0, createdAt: now.toISOString(), updatedAt: now.toISOString() };
    await r.put('payments', record);
    await r.put('paymentCheckoutRequests', { id: requestId, userId: user.id, planCode, orderId: order.id, status: 'created', createdAt: now.toISOString(), updatedAt: now.toISOString() });
    await billing(r, { userId: user.id, orderId: order.id, type: 'order_created', amount: order.amount, currency: order.currency }, now);
    await audit(r, user.id, 'checkout.created', order.id);
  });
  return { order, keyId: provider.keyId, reused: false };
}

export async function verifyCheckout(userId: string, input: unknown, provider: PaymentProvider) {
  const value = checkoutVerificationSchema.parse(input);
  if (!provider.verifyCheckout(value.razorpay_order_id, value.razorpay_payment_id, value.razorpay_signature)) throw new ApiError(401, 'INVALID_PAYMENT_SIGNATURE', 'Payment signature is invalid.');
  return transaction(async r => {
    const order = await r.get<PaymentRecord>('payments', value.razorpay_order_id);
    if (!order || order.userId !== userId) throw new ApiError(404, 'PAYMENT_NOT_FOUND', 'Payment order not found.');
    if (order.providerPaymentId && order.providerPaymentId !== value.razorpay_payment_id) throw new ApiError(409, 'PAYMENT_CONFLICT', 'Payment identifier conflict.');
    if (order.status === 'created') {
      await r.put('payments', { ...order, status: 'authorized', providerPaymentId: value.razorpay_payment_id, updatedAt: new Date().toISOString() });
      await billing(r, { userId, orderId: order.id, paymentId: value.razorpay_payment_id, type: 'payment_authorized', amount: order.amount, currency: order.currency });
      await audit(r, userId, 'payment.authorized', order.id);
    }
    return { verified: true, activationPendingWebhook: order.status !== 'captured' };
  });
}

const webhookSchema = z.object({
  event: z.string().min(1).max(100),
  payload: z.record(z.string(), z.object({ entity: z.record(z.string(), z.unknown()) })).default({}),
}).passthrough();

export async function processRazorpayWebhook(r: Repository, eventId: string, input: unknown, plans: Plan[], now = new Date()) {
  if (await r.get('paymentEvents', eventId)) return { duplicate: true };
  const event = webhookSchema.parse(input), payment = event.payload.payment?.entity, refund = event.payload.refund?.entity;
  const recurringOutcome=await processRecurringEvent(r,eventId,event,plans,now);
  if(recurringOutcome){await r.put('paymentEvents',{id:eventId,eventType:event.event,processed:true,processedAt:now.toISOString(),receivedAt:now.toISOString(),outcome:recurringOutcome});return {duplicate:false,outcome:recurringOutcome};}
  const orderId = typeof payment?.order_id === 'string' ? payment.order_id : undefined;
  const order = orderId ? await r.get<PaymentRecord>('payments', orderId) : null;
  let outcome = 'ignored';
  if (event.event === 'payment.captured' && order && payment && payment.amount === order.amount && payment.currency === order.currency && typeof payment.id === 'string' && ['created', 'authorized', 'captured'].includes(order.status)) {
    if (order.providerPaymentId && order.providerPaymentId !== payment.id) throw new ApiError(409, 'PAYMENT_CONFLICT', 'Payment identifier conflict.');
    if (order.status !== 'captured') {
      await r.put('payments', { ...order, status: 'captured', providerPaymentId: payment.id, paymentMethod: typeof payment.method === 'string' ? payment.method.slice(0, 40) : undefined, capturedAt: now.toISOString(), updatedAt: now.toISOString() });
      await activatePaidSubscription(r, { userId: order.userId, planCode: order.planCode, providerPaymentId: payment.id }, plans, now);
      await billing(r, { userId: order.userId, orderId: order.id, paymentId: payment.id, type: 'payment_captured', amount: order.amount, currency: order.currency }, now);
      await audit(r, 'razorpay', 'payment.captured', order.id);
    }
    outcome = order.status === 'captured' ? 'captured_duplicate' : 'captured';
  } else if (event.event === 'payment.failed' && order && payment && !['captured', 'partially_refunded', 'refunded'].includes(order.status)) {
    await r.put('payments', { ...order, status: 'failed', providerPaymentId: typeof payment.id === 'string' ? payment.id : order.providerPaymentId, failureCode: typeof payment.error_code === 'string' ? payment.error_code.slice(0, 100) : 'PROVIDER_DECLINED', failedAt: now.toISOString(), updatedAt: now.toISOString() });
    await billing(r, { userId: order.userId, orderId: order.id, paymentId: typeof payment.id === 'string' ? payment.id : undefined, type: 'payment_failed', amount: order.amount, currency: order.currency }, now);
    await audit(r, 'razorpay', 'payment.failed', order.id); outcome = 'failed';
  } else if (['refund.processed', 'refund.failed'].includes(event.event) && refund && typeof refund.payment_id === 'string') {
    const paymentOrder = (await r.find<PaymentRecord>('payments', { providerPaymentId: refund.payment_id }, 1))[0];
    if (paymentOrder) {
      const refundId = typeof refund.id === 'string' ? refund.id : undefined;
      if (refundId && await r.get('refundEvents', refundId)) {
        await r.put('paymentEvents', { id: eventId, event: event.event, outcome: 'refund_duplicate', createdAt: now.toISOString() });
        return { duplicate: false, outcome: 'refund_duplicate' };
      }
      const amount = typeof refund.amount === 'number' && Number.isInteger(refund.amount) && refund.amount > 0 ? refund.amount : 0;
      if (!amount) throw new ApiError(400, 'REFUND_AMOUNT_INVALID', 'Refund amount is invalid.');
      if (event.event === 'refund.processed') {
        const refundedAmount = Math.min(paymentOrder.amount, paymentOrder.refundedAmount + amount);
        const status: PaymentStatus = refundedAmount >= paymentOrder.amount ? 'refunded' : 'partially_refunded';
        await r.put('payments', { ...paymentOrder, status, refundedAmount, updatedAt: now.toISOString() });
        if (status === 'refunded') {
          const subscription = await r.get<StudentSubscription>('studentSubscriptions', paymentOrder.userId);
          const user = await r.get<User>('users', paymentOrder.userId);
          if (subscription && subscription.providerPaymentId === paymentOrder.providerPaymentId) {
            const cancelled: StudentSubscription = { ...subscription, status: 'cancelled', autoRenew: false, cancelAtPeriodEnd: false, revision: subscription.revision + 1, cancelledAt: now.toISOString(), updatedAt: now.toISOString() };
            await r.put('studentSubscriptions', cancelled);
          }
          if (user) await r.put('users', { ...user, plan: 'basic' });
        }
        await billing(r, { userId: paymentOrder.userId, orderId: paymentOrder.id, paymentId: refund.payment_id, refundId, type: 'refund_processed', amount, currency: paymentOrder.currency }, now);
        outcome = status;
      } else {
        await billing(r, { userId: paymentOrder.userId, orderId: paymentOrder.id, paymentId: refund.payment_id, refundId, type: 'refund_failed', amount, currency: paymentOrder.currency }, now);
        outcome = 'refund_failed';
      }
      await audit(r, 'razorpay', event.event, paymentOrder.id);
      if (refundId) await r.put('refundEvents', { id: refundId, paymentId: refund.payment_id, event: event.event, createdAt: now.toISOString() });
    }
  }
  await r.put('paymentEvents', { id: eventId, eventType: event.event, processed: true, processedAt: now.toISOString(), receivedAt: now.toISOString(), outcome });
  return { duplicate: false, outcome };
}

export async function billingHistory(userId: string) {
  return read(async r => (await r.find<BillingRecord>('billingRecords', { userId }, 200)).sort((a, b) => b.createdAt.localeCompare(a.createdAt)));
}

export async function requestRefund(actor: User, orderId: string, input: unknown, provider: PaymentProvider) {
  const value = refundRequestSchema.parse(input), requestId = digest(`${orderId}:refund:${value.idempotencyKey}`);
  const existing = await read(r => r.get<Row>('refundRequests', requestId));
  if (existing) return { refundId: existing.refundId, reused: true };
  const payment = await read(r => r.get<PaymentRecord>('payments', orderId));
  if (!payment || payment.status !== 'captured' || !payment.providerPaymentId) throw new ApiError(409, 'PAYMENT_NOT_REFUNDABLE', 'A captured payment is required.');
  const refundable = payment.amount - payment.refundedAmount, amount = value.amount ?? refundable;
  if (amount > refundable) throw new ApiError(400, 'REFUND_AMOUNT_INVALID', 'Refund exceeds the refundable amount.');
  const refund = await provider.refund(payment.providerPaymentId, { amount, receipt: requestId.slice(0, 40) });
  if (refund.paymentId !== payment.providerPaymentId || refund.amount !== amount || !refund.id) throw new ApiError(503, 'REFUND_PROVIDER_MISMATCH', 'The payment provider returned an invalid refund.');
  await transaction(async r => {
    await r.put('refundRequests', { id: requestId, orderId, userId: payment.userId, razorpayPaymentId: payment.providerPaymentId, razorpayRefundId: refund.id, refundId: refund.id, amount, reason: value.reason, status: refund.status, createdBy: actor.id, createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
    await billing(r, { userId: payment.userId, orderId, paymentId: payment.providerPaymentId, refundId: refund.id, type: 'refund_requested', amount, currency: payment.currency });
    await audit(r, actor.id, 'refund.requested', orderId);
  });
  return { refundId: refund.id, status: refund.status, reused: false };
}

export async function reconcilePayment(actor: User, orderId: string, provider: PaymentProvider) {
  const payment = await read(r => r.get<PaymentRecord>('payments', orderId));
  if (!payment?.providerPaymentId) throw new ApiError(409, 'PAYMENT_NOT_RECONCILABLE', 'Provider payment identifier is unavailable.');
  const remote = await provider.payment(payment.providerPaymentId), plans = await configuredPlans();
  if (remote.orderId !== orderId || remote.amount !== payment.amount || remote.currency !== payment.currency) throw new ApiError(409, 'PAYMENT_RECONCILIATION_MISMATCH', 'Provider payment does not match the billing record.');
  return transaction(async r => {
    let outcome = remote.status;
    if (remote.status === 'captured' && payment.status !== 'captured') {
      await r.put('payments', { ...payment, status: 'captured', updatedAt: new Date().toISOString() });
      await activatePaidSubscription(r, { userId: payment.userId, planCode: payment.planCode, providerPaymentId: payment.providerPaymentId! }, plans);
      await billing(r, { userId: payment.userId, orderId, paymentId: payment.providerPaymentId, type: 'payment_captured', amount: payment.amount, currency: payment.currency });
    }
    await audit(r, actor.id, 'payment.reconciled', orderId);
    return { orderId, status: outcome, amountRefunded: remote.amountRefunded };
  });
}
