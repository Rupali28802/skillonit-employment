import { z } from 'zod';
import type { User } from './domain.js';
import type { PaymentRecord, BillingRecord } from './payment-billing.js';
import type { StudentSubscription } from './student-entitlements.js';
import { read } from './store.js';
import { ApiError, safeUser } from './security.js';
import { requireAdminPermission } from './admin-rbac.js';

const filtersSchema = z.object({
  cursor: z.string().max(120).default(''), limit: z.coerce.number().int().min(1).max(100).default(25),
  page: z.coerce.number().int().min(1).max(100000).optional(),
  query: z.string().trim().max(100).optional(), status: z.string().trim().max(40).optional(),
  plan: z.string().trim().regex(/^[a-z][a-z0-9-]{1,39}$/).optional(), from: z.iso.date().optional(), to: z.iso.date().optional(),
}).strict();

function matchesDate(createdAt: string, from?: string, to?: string) {
  const value = Date.parse(createdAt);
  return (!from || value >= Date.parse(from)) && (!to || value < Date.parse(to + 'T23:59:59.999Z'));
}
function paged<T extends { id: string }>(rows: T[], cursor: string, limit: number) {
  const sorted = rows.filter(row => row.id > cursor).sort((a,b) => a.id.localeCompare(b.id));
  const items = sorted.slice(0, limit);
  return { items, nextCursor: sorted.length > limit ? items.at(-1)?.id ?? null : null };
}
function safeProviderId(value?: string) { return value ?? null; }

export async function adminPayments(actor: User, params: URLSearchParams) {
  const input = filtersSchema.parse(Object.fromEntries(params));
  return read(async r => {
    await requireAdminPermission(r, actor, 'payments.read');
    const users = new Map((await r.find<User>('users', {}, 5000)).map(user => [user.id, safeUser(user)]));
    let rows = await r.find<PaymentRecord>('payments', {}, 5000);
    const summary = {
      totalPayments: rows.length,
      totalAmount: rows.filter(row => row.status === 'captured').reduce((sum, row) => sum + row.amount, 0),
      successfulPayments: rows.filter(row => row.status === 'captured').length,
      failedPayments: rows.filter(row => row.status === 'failed').length,
    };
    if (input.status) rows = rows.filter(row => row.status === input.status);
    if (input.plan) rows = rows.filter(row => row.planCode === input.plan);
    rows = rows.filter(row => matchesDate(row.createdAt, input.from, input.to));
    if (input.query) { const q=input.query.toLowerCase(); rows=rows.filter(row => { const user=users.get(row.userId); return [row.id,row.providerPaymentId,row.planCode,user?.name,user?.email].some(value=>String(value??'').toLowerCase().includes(q)); }); }
    const total=rows.length;
    const result=input.page?{items:rows.sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).slice((input.page-1)*input.limit,input.page*input.limit),nextCursor:null}:paged(rows,input.cursor,input.limit);
    return { ...result, total, page:input.page??1, pageSize:input.limit, summary, items: await Promise.all(result.items.map(async row => {
      const user=users.get(row.userId); const refunds=await r.find<Record<string,unknown>>('refundRequests',{orderId:row.id},100);
      const refundedAmount=row.refundedAmount??0;
      return { id:row.id, userId:row.userId, user:user?.name??'Deleted user', email:user?.email??null, plan:row.planCode, amount:row.amount, currency:row.currency, status:row.status, paymentMethod:row.paymentMethod??null, razorpayPaymentId:safeProviderId(row.providerPaymentId), createdAt:row.createdAt, refundedAmount, refundableAmount:Math.max(0,row.amount-refundedAmount), refundStatus:refunds.at(-1)?.status??null };
    })) };
  });
}

export async function adminPaymentDetail(actor: User, orderId: string) {
  return read(async r => {
    await requireAdminPermission(r, actor, 'payments.read');
    const payment=await r.get<PaymentRecord>('payments',orderId);
    if(!payment) throw new ApiError(404,'PAYMENT_NOT_FOUND','Payment not found.');
    const user=await r.get<User>('users',payment.userId);
    const timeline=(await r.find<BillingRecord>('billingRecords',{orderId},500)).sort((a,b)=>a.createdAt.localeCompare(b.createdAt));
    const refunds=(await r.find<Record<string,unknown>>('refundRequests',{orderId},100)).map(row=>({id:row.id,razorpayRefundId:row.razorpayRefundId??row.refundId,amount:row.amount,reason:row.reason,status:row.status,createdAt:row.createdAt}));
    const audits=(await r.find<Record<string,unknown>>('auditLogs',{entityId:orderId},100)).map(row=>({id:row.id,actorId:row.actorId,action:row.action,createdAt:row.createdAt??row.timestamp}));
    const subscription=await r.get<StudentSubscription>('studentSubscriptions',payment.userId);
    const { providerPaymentId, ...safePayment } = payment;
    const refundedAmount=safePayment.refundedAmount??0;
    return { payment:{id:safePayment.id,userId:safePayment.userId,planCode:safePayment.planCode,status:safePayment.status,amount:safePayment.amount,currency:safePayment.currency,refundedAmount,paymentMethod:safePayment.paymentMethod??null,capturedAt:safePayment.capturedAt??null,failedAt:safePayment.failedAt??null,createdAt:safePayment.createdAt,updatedAt:safePayment.updatedAt,razorpayPaymentId:safeProviderId(providerPaymentId),razorpayOrderId:safePayment.id}, user:user?{id:user.id,name:user.name,email:user.email}:null, plan:payment.planCode, subscription:subscription?{id:subscription.id,status:subscription.status,currentPeriodStart:subscription.currentPeriodStart,currentPeriodEnd:subscription.currentPeriodEnd,nextBillingAt:subscription.nextBillingAt??null,cancelAtPeriodEnd:subscription.cancelAtPeriodEnd}:null, refundableAmount:Math.max(0,payment.amount-refundedAmount), timeline, refunds, audits };
  });
}

export async function adminSubscriptions(actor: User, params: URLSearchParams) {
  const input=filtersSchema.parse(Object.fromEntries(params));
  return read(async r=>{
    await requireAdminPermission(r,actor,'subscriptions.read');
    const users=new Map((await r.find<User>('users',{},5000)).map(user=>[user.id,user]));
    let rows=await r.find<StudentSubscription>('studentSubscriptions',{},5000);
    if(input.status) rows=rows.filter(row=>row.status===input.status);
    if(input.plan) rows=rows.filter(row=>row.planCode===input.plan);
    rows=rows.filter(row=>matchesDate(row.createdAt,input.from,input.to));
    if(input.query){const q=input.query.toLowerCase();rows=rows.filter(row=>{const user=users.get(row.userId);return [row.id,row.userId,row.planCode,user?.name,user?.email].some(value=>String(value??'').toLowerCase().includes(q));});}
    const total=rows.length, result=input.page?{items:rows.sort((a,b)=>a.id.localeCompare(b.id)).slice((input.page-1)*input.limit,input.page*input.limit),nextCursor:null}:paged(rows,input.cursor,input.limit);
    return {...result,total,page:input.page??1,pageSize:input.limit,items:result.items.map(row=>{const user=users.get(row.userId);return {id:row.id,userId:row.userId,user:user?.name??'Deleted user',email:user?.email??null,plan:row.planCode,status:row.status,revision:row.revision,razorpaySubscriptionId:row.providerSubscriptionId??null,currentPeriodStart:row.currentPeriodStart,currentPeriodEnd:row.currentPeriodEnd,nextBillingAt:row.nextBillingAt??(row.autoRenew?row.currentPeriodEnd:null),cancelAtPeriodEnd:row.cancelAtPeriodEnd,cancelledAt:row.cancelledAt??null,createdAt:row.createdAt,source:row.source};})};
  });
}

export async function adminSubscriptionDetail(actor:User,subscriptionId:string){
  return read(async r=>{
    await requireAdminPermission(r,actor,'subscriptions.read');
    const subscription=await r.get<StudentSubscription>('studentSubscriptions',subscriptionId);
    if(!subscription)throw new ApiError(404,'SUBSCRIPTION_NOT_FOUND','Subscription not found.');
    const user=await r.get<User>('users',subscription.userId);
    const payments=(await r.find<PaymentRecord>('payments',{userId:subscription.userId},200)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt)).map(row=>({id:row.id,plan:row.planCode,status:row.status,amount:row.amount,currency:row.currency,paymentMethod:row.paymentMethod??null,createdAt:row.createdAt}));
    const activity=(await r.find<Record<string,unknown>>('auditLogs',{entityId:subscription.userId},100)).map(row=>({id:row.id,action:row.action,createdAt:row.createdAt??row.timestamp}));
    return {subscription:{id:subscription.id,userId:subscription.userId,plan:subscription.planCode,status:subscription.status,revision:subscription.revision,currentPeriodStart:subscription.currentPeriodStart,currentPeriodEnd:subscription.currentPeriodEnd,nextBillingAt:subscription.nextBillingAt??null,autoRenew:subscription.autoRenew,cancelAtPeriodEnd:subscription.cancelAtPeriodEnd,source:subscription.source,createdAt:subscription.createdAt,updatedAt:subscription.updatedAt},user:user?{id:user.id,name:user.name,email:user.email,disabled:Boolean(user.disabled)}:null,payments,activity};
  });
}
