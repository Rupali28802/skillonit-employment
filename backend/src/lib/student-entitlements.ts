import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Plan, PlanCode, User } from './domain.js';
import type { Repository } from './store.js';
import { configuredPlans, read, transaction } from './store.js';
import { ApiError, audit } from './security.js';

export type SubscriptionStatus = 'created'|'authenticated'|'trialing' | 'active' | 'pending'|'past_due'|'halted'|'cancelled'|'completed'|'expired';
export type StudentSubscription = {
  id: string;
  userId: string;
  planCode: PlanCode;
  status: SubscriptionStatus;
  currentPeriodStart: string;
  currentPeriodEnd: string;
  autoRenew: boolean;
  cancelAtPeriodEnd: boolean;
  revision: number;
  source: 'admin' | 'razorpay' | 'migration';
  providerPaymentId?: string;
  providerSubscriptionId?: string;
  providerCustomerId?: string;
  nextBillingAt?: string;
  lastChargeId?: string;
  planSnapshot: Plan;
  createdAt: string;
  updatedAt: string;
  activatedAt: string;
  cancelledAt?: string;
  expiredAt?: string;
};

export type EntitlementMetric = 'applications' | 'auto_apply';
export type EntitlementUsage = {
  id: string; userId: string; metric: EntitlementMetric; period: string;
  count: number; cap: number; planCode: PlanCode; subscriptionId?: string; updatedAt: string;
};

export type StudentEntitlements = {
  plan: Plan;
  subscription: StudentSubscription | null;
  subscriptionStatus: SubscriptionStatus | 'basic_fallback';
  features: { applications: true; autoApply: boolean; employerIdentity: boolean };
  limits: { applicationsPerDay: number; autoApplyPerDay: number; cvVersions: number };
};

const planCode = z.string().trim().regex(/^[a-z][a-z0-9-]{1,39}$/);
export const subscriptionChangeSchema = z.object({
  planCode,
  status: z.enum(['trialing', 'active']).default('active'),
  currentPeriodStart: z.iso.datetime().optional(),
  currentPeriodEnd: z.iso.datetime().optional(),
  autoRenew: z.boolean().default(false),
  expectedRevision: z.number().int().min(0).default(0),
}).strict();

function activeAt(subscription: StudentSubscription, now: Date) {
  return ['active', 'trialing'].includes(subscription.status) &&
    Date.parse(subscription.currentPeriodStart) <= now.getTime() &&
    Date.parse(subscription.currentPeriodEnd) > now.getTime();
}

function snapshot(plan: Plan): Plan {
  return { ...plan, autoApplyDailyCap: plan.autoApply ? (plan.autoApplyDailyCap ?? plan.dailyCap) : 0, billingPeriodDays: plan.billingPeriodDays ?? 30 };
}

export async function resolveStudentEntitlements(
  r: Repository, user: User, plans: Plan[], now = new Date(),
): Promise<StudentEntitlements> {
  const basic = plans.find(p => p.code === 'basic');
  if (!basic) throw new ApiError(503, 'PLAN_CONFIGURATION_INVALID', 'The basic entitlement is unavailable.');
  const subscription = await r.get<StudentSubscription>('studentSubscriptions', user.id);
  const valid = subscription && activeAt(subscription, now);
  const selected = valid ? plans.find(p => p.code === subscription.planCode) : basic;
  if (!selected) throw new ApiError(503, 'PLAN_CONFIGURATION_INVALID', 'The subscription plan is unavailable.');
  const plan = snapshot(valid ? subscription.planSnapshot ?? selected : selected);
  return {
    plan,
    subscription,
    subscriptionStatus: valid ? subscription.status : subscription ? (Date.parse(subscription.currentPeriodEnd) <= now.getTime() ? 'expired' : subscription.status) : 'basic_fallback',
    features: { applications: true, autoApply: plan.autoApply, employerIdentity: plan.identity },
    limits: { applicationsPerDay: plan.dailyCap, autoApplyPerDay: plan.autoApply ? (plan.autoApplyDailyCap ?? plan.dailyCap) : 0, cvVersions: plan.cvs },
  };
}

export function usageId(userId: string, period: string, metric: EntitlementMetric) {
  return `${userId}:${period}:${metric}`;
}

export async function entitlementUsage(
  r: Repository, user: User, entitlements: StudentEntitlements, metric: EntitlementMetric, at = new Date(),
) {
  const period = at.toISOString().slice(0, 10);
  const id = usageId(user.id, period, metric);
  const row = await r.get<EntitlementUsage>('entitlementUsage', id);
  const planCap = metric === 'auto_apply' ? entitlements.limits.autoApplyPerDay : entitlements.limits.applicationsPerDay;
  const preferenceCap = metric === 'auto_apply'
    ? (user.preferences.automationConstraints?.dailyCap ?? user.preferences.dailyCap)
    : user.preferences.dailyCap;
  const cap = Math.max(0, Math.min(planCap, preferenceCap));
  return { id, period, metric, used: row?.count ?? 0, cap };
}

export async function consumeEntitlement(
  r: Repository, user: User, entitlements: StudentEntitlements, metric: EntitlementMetric, at = new Date(),
) {
  const usage = await entitlementUsage(r, user, entitlements, metric, at);
  if (usage.used >= usage.cap) throw new ApiError(409, metric === 'auto_apply' ? 'AUTO_APPLY_CAP_REACHED' : 'DAILY_CAP_REACHED', 'The subscription allowance has been reached.');
  await r.put<EntitlementUsage>('entitlementUsage', {
    id: usage.id, userId: user.id, metric, period: usage.period, count: usage.used + 1,
    cap: usage.cap, planCode: entitlements.plan.code, subscriptionId: entitlements.subscription?.id, updatedAt: at.toISOString(),
  });
  return { ...usage, used: usage.used + 1 };
}

export async function getStudentSubscription(userId: string, now = new Date()) {
  const plans = await configuredPlans();
  return read(async r => {
    const user = await r.get<User>('users', userId);
    if (!user || user.disabled || user.role !== 'student') throw new ApiError(401, 'AUTH_REQUIRED', 'Please sign in again.');
    const entitlements = await resolveStudentEntitlements(r, user, plans, now);
    const applications = await entitlementUsage(r, user, entitlements, 'applications', now);
    const autoApply = await entitlementUsage(r, user, entitlements, 'auto_apply', now);
    return {
      ...entitlements,
      usage: {
        // count/cap/period preserve the existing dashboard contract.
        count: applications.used,
        cap: applications.cap,
        period: applications.period,
        applications,
        autoApply,
      },
    };
  });
}

export async function activateStudentSubscription(
  actor: User, userId: string, input: unknown, now = new Date(),
) {
  const data = subscriptionChangeSchema.parse(input), plans = await configuredPlans();
  return transaction(async r => {
    const currentActor = await r.get<User>('users', actor.id);
    if (!currentActor || currentActor.disabled || currentActor.role !== 'admin') throw new ApiError(403, 'FORBIDDEN', 'Administrator access required.');
    const user = await r.get<User>('users', userId);
    if (!user || user.role !== 'student') throw new ApiError(404, 'NOT_FOUND', 'Student not found.');
    const previous = await r.get<StudentSubscription>('studentSubscriptions', userId);
    if ((previous?.revision ?? 0) !== data.expectedRevision) throw new ApiError(409, 'SUBSCRIPTION_CONFLICT', 'Reload the subscription before saving.');
    const plan = plans.find(p => p.code === data.planCode);
    if (!plan) throw new ApiError(409, 'PLAN_NOT_FOUND', 'Subscription plan not found.');
    const start = data.currentPeriodStart ? new Date(data.currentPeriodStart) : now;
    const end = data.currentPeriodEnd ? new Date(data.currentPeriodEnd) : new Date(start.getTime() + (plan.billingPeriodDays ?? 30) * 86400000);
    if (end <= start || end <= now) throw new ApiError(400, 'INVALID_SUBSCRIPTION_PERIOD', 'Subscription end must be after its start and in the future.');
    const record: StudentSubscription = {
      id: userId, userId, planCode: plan.code, status: data.status,
      currentPeriodStart: start.toISOString(), currentPeriodEnd: end.toISOString(), autoRenew: data.autoRenew,
      cancelAtPeriodEnd: false, revision: (previous?.revision ?? 0) + 1, source: 'admin', planSnapshot: snapshot(plan),
      createdAt: previous?.createdAt ?? now.toISOString(), updatedAt: now.toISOString(), activatedAt: now.toISOString(),
    };
    await r.put('studentSubscriptions', record);
    await r.put('users', { ...user, plan: plan.code });
    await audit(r, actor.id, 'subscription.activated', userId);
    return record;
  });
}

export async function activatePaidSubscription(
  r: Repository, payment: { userId: string; planCode: PlanCode; providerPaymentId: string }, plans: Plan[], now = new Date(),
) {
  const user = await r.get<User>('users', payment.userId);
  const plan = plans.find(p => p.code === payment.planCode);
  if (!user || user.role !== 'student' || !plan || plan.price === null) throw new ApiError(409, 'SUBSCRIPTION_ACTIVATION_FAILED', 'Payment cannot be matched to an eligible subscription.');
  const previous = await r.get<StudentSubscription>('studentSubscriptions', user.id);
  if (previous?.providerPaymentId === payment.providerPaymentId) return previous;
  const start = previous && activeAt(previous, now) && previous.planCode === plan.code ? new Date(previous.currentPeriodEnd) : now;
  const end = new Date(start.getTime() + (plan.billingPeriodDays ?? 30) * 86400000);
  const record: StudentSubscription = {
    id: user.id, userId: user.id, planCode: plan.code, status: 'active', currentPeriodStart: now.toISOString(),
    currentPeriodEnd: end.toISOString(), autoRenew: false, cancelAtPeriodEnd: false, revision: (previous?.revision ?? 0) + 1,
    source: 'razorpay', providerPaymentId: payment.providerPaymentId, planSnapshot: snapshot(plan),
    createdAt: previous?.createdAt ?? now.toISOString(), updatedAt: now.toISOString(), activatedAt: now.toISOString(),
  };
  await r.put('studentSubscriptions', record);
  await r.put('users', { ...user, plan: plan.code });
  await audit(r, 'razorpay', 'subscription.activated', user.id);
  return record;
}

export async function cancelStudentSubscription(userId: string, now = new Date()) {
  return transaction(async r => {
    const user = await r.get<User>('users', userId);
    if (!user || user.disabled || user.role !== 'student') throw new ApiError(401, 'AUTH_REQUIRED', 'Please sign in again.');
    const current = await r.get<StudentSubscription>('studentSubscriptions', userId);
    if (!current || !activeAt(current, now)) throw new ApiError(409, 'NO_ACTIVE_SUBSCRIPTION', 'No active paid subscription was found.');
    const next = { ...current, autoRenew: false, cancelAtPeriodEnd: true, revision: current.revision + 1, cancelledAt: now.toISOString(), updatedAt: now.toISOString() };
    await r.put('studentSubscriptions', next);
    await audit(r, userId, 'subscription.cancel_at_period_end', userId);
    return next;
  });
}

export async function expireStudentSubscriptionsInRepository(r: Repository, now = new Date()) {
  const candidates = await r.find<StudentSubscription>('studentSubscriptions', { currentPeriodEnd: { $lt: now.toISOString() } }, 1000);
  let expired = 0;
  for (const row of candidates) {
    if (!['active', 'trialing', 'past_due'].includes(row.status)) continue;
    const user = await r.get<User>('users', row.userId);
    await r.put('studentSubscriptions', { ...row, status: 'expired', autoRenew: false, revision: row.revision + 1, expiredAt: now.toISOString(), updatedAt: now.toISOString() });
    if (user) await r.put('users', { ...user, plan: 'basic' });
    await audit(r, 'subscription-worker', 'subscription.expired', row.userId);
    expired++;
  }
  return { expired };
}

export async function expireStudentSubscriptions(now = new Date()) {
  return transaction(r => expireStudentSubscriptionsInRepository(r, now));
}
