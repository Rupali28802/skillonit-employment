import { razorpayVersionMatches } from './razorpay-configuration.js';
import { randomUUID } from 'node:crypto';
import { z } from 'zod';
import type { Plan, PlanCode, User } from './domain.js';
import type { PaymentProvider } from './providers.js';
import type { Repository } from './store.js';
import { configuredPlans, read, transaction } from './store.js';
import { ApiError, audit, digest } from './security.js';
import type { StudentSubscription, SubscriptionStatus } from './student-entitlements.js';
import type { PaymentRecord } from './payment-billing.js';

const planCodeSchema=z.string().trim().regex(/^[a-z][a-z0-9-]{1,39}$/).refine(code=>code!=='basic','The free plan cannot use recurring billing.');
const providerId=/^(plan|sub|pay|cust)_[A-Za-z0-9]{6,100}$/;
const totalCount=1200;
const iso=(seconds:unknown,fallback:Date)=>typeof seconds==='number'&&Number.isFinite(seconds)?new Date(seconds*1000).toISOString():fallback.toISOString();
function planAmount(plan:Plan){if(plan.price===null||plan.price<=0)throw new ApiError(409,'PLAN_NOT_PAID','A configured paid plan is required.');return Math.round(plan.price*100);}
function recurringPlan(plan:Plan){if(plan.code==='basic')throw new ApiError(409,'FREE_PLAN_RECURRING_FORBIDDEN','The free plan does not use recurring billing.');if(plan.status&&plan.status!=='active')throw new ApiError(409,'PLAN_INACTIVE','This plan is not available.');if(!plan.razorpayPlanId||!providerId.test(plan.razorpayPlanId))throw new ApiError(503,'RAZORPAY_PLAN_NOT_CONFIGURED','The recurring provider plan is not configured.');return plan;}

export async function syncRazorpayPlan(actor:User,code:PlanCode,provider:PaymentProvider){
  if(code==='basic')throw new ApiError(409,'FREE_PLAN_RECURRING_FORBIDDEN','The free plan does not use recurring billing.');
  const plans=await configuredPlans(), plan=plans.find(item=>item.code===code);
  if(!plan)throw new ApiError(404,'PLAN_NOT_FOUND','Plan not found.');
  if(plan.razorpayPlanId&&await razorpayVersionMatches(plan.razorpayConfigVersion,provider.configVersion)) return {planId:plan.razorpayPlanId,reused:true};
  const period=plan.billingPeriod??'monthly',interval=plan.billingInterval??1,amount=planAmount(plan);
  const remote=await provider.createPlan({period,interval,item:{name:plan.name,amount,currency:plan.currency,description:plan.description},notes:{skillonit_plan:plan.code}});
  if(!providerId.test(remote.id)||remote.amount!==amount||remote.currency!==plan.currency||remote.period!==period||remote.interval!==interval)throw new ApiError(503,'PLAN_PROVIDER_MISMATCH','The provider returned an invalid plan.');
  await transaction(async r=>{const latest=(await r.get<{id:string;value:Plan[]}>('systemConfig','plans'))?.value??plans;const next=latest.map(item=>item.code===code?{...item,razorpayPlanId:remote.id,razorpayConfigVersion:provider.configVersion}:item);await r.put('systemConfig',{id:'plans',value:next});await r.put('planConfigHistory',{id:randomUUID(),actorId:actor.id,planCode:code,action:'razorpay_plan_synced',razorpayPlanId:remote.id,createdAt:new Date().toISOString()});await audit(r,actor.id,'plan.razorpay_synced',code);});
  return {planId:remote.id,reused:false};
}

export async function createRecurringSubscription(user:User,input:unknown,idempotencyKey:string,provider:PaymentProvider,now=new Date()){
  const {planCode}=z.object({planCode:planCodeSchema}).strict().parse(input);const key=z.string().trim().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{7,127}$/).parse(idempotencyKey);
  const configuredPlan=(await configuredPlans()).find(item=>item.code===planCode);
  if(!configuredPlan)throw new ApiError(404,'PLAN_NOT_FOUND','Plan not found.');
  const plan=recurringPlan(configuredPlan);
  if(!await razorpayVersionMatches(plan.razorpayConfigVersion,provider.configVersion))throw new ApiError(409,'RAZORPAY_PLAN_CONFIGURATION_CHANGED','An administrator must sync this recurring plan with the active Razorpay configuration.');
  const requestId=digest(`${user.id}:recurring:${key}`),prior=await read(r=>r.get<{id:string;userId:string;providerSubscriptionId?:string;razorpayConfigVersion?:string}>('subscriptionCheckoutRequests',requestId));
  if(prior?.userId&&prior.userId!==user.id)throw new ApiError(409,'IDEMPOTENCY_CONFLICT','Subscription request conflict.');
  if(prior?.providerSubscriptionId){if(!await razorpayVersionMatches(prior.razorpayConfigVersion,provider.configVersion))throw new ApiError(409,'CHECKOUT_CONFIGURATION_CHANGED','Start a new checkout after the payment configuration change.');const existing=await read(r=>r.get<StudentSubscription>('studentSubscriptions',user.id));return {subscriptionId:prior.providerSubscriptionId,keyId:provider.keyId,shortUrl:null,status:existing?.status??'created',reused:true};}
  const existing=await read(r=>r.get<StudentSubscription>('studentSubscriptions',user.id));
  if(existing?.providerSubscriptionId&&['created','authenticated','active','pending','halted'].includes(existing.status))throw new ApiError(409,'ACTIVE_SUBSCRIPTION_EXISTS','Cancel the existing recurring subscription before creating another.');
  await transaction(r=>r.put('subscriptionCheckoutRequests',{id:requestId,userId:user.id,planCode,status:'creating',createdAt:now.toISOString()}));
  const remote=await provider.createSubscription({planId:plan.razorpayPlanId!,totalCount,notes:{skillonit_user:user.id,skillonit_plan:plan.code}});
  if(!providerId.test(remote.id)||remote.planId!==plan.razorpayPlanId)throw new ApiError(503,'SUBSCRIPTION_PROVIDER_MISMATCH','The provider returned an invalid subscription.');
  const start=iso(remote.currentStart,now),end=iso(remote.currentEnd,new Date(now.getTime()+(plan.billingPeriodDays??30)*86400000));
  await transaction(async r=>{const current=await r.get<StudentSubscription>('studentSubscriptions',user.id);const record:StudentSubscription={id:user.id,userId:user.id,planCode:plan.code,status:'created',currentPeriodStart:start,currentPeriodEnd:end,nextBillingAt:remote.chargeAt?iso(remote.chargeAt,new Date(end)):end,autoRenew:true,cancelAtPeriodEnd:false,revision:(current?.revision??0)+1,source:'razorpay',razorpayConfigVersion:provider.configVersion,providerSubscriptionId:remote.id,providerCustomerId:remote.customerId??undefined,planSnapshot:{...plan},createdAt:current?.createdAt??now.toISOString(),updatedAt:now.toISOString(),activatedAt:current?.activatedAt??now.toISOString()};await r.put('studentSubscriptions',record);await r.put('subscriptionCheckoutRequests',{id:requestId,userId:user.id,planCode,razorpayConfigVersion:provider.configVersion,providerSubscriptionId:remote.id,status:'created',createdAt:now.toISOString()});await audit(r,user.id,'subscription.recurring_created',remote.id);});
  return {subscriptionId:remote.id,keyId:provider.keyId,shortUrl:remote.shortUrl,status:remote.status,reused:false};
}

export async function cancelRecurringSubscription(user:User,provider:PaymentProvider,now=new Date()){
  const current=await read(r=>r.get<StudentSubscription>('studentSubscriptions',user.id));
  if(!current?.providerSubscriptionId||!['created','authenticated','active','pending','halted'].includes(current.status))throw new ApiError(409,'NO_ACTIVE_RECURRING_SUBSCRIPTION','No cancellable recurring subscription was found.');
  const remote=await provider.cancelSubscription(current.providerSubscriptionId,true);
  if(remote.id!==current.providerSubscriptionId)throw new ApiError(503,'SUBSCRIPTION_PROVIDER_MISMATCH','The provider returned an invalid subscription.');
  return transaction(async r=>{const latest=await r.get<StudentSubscription>('studentSubscriptions',user.id);if(!latest||latest.providerSubscriptionId!==remote.id)throw new ApiError(409,'SUBSCRIPTION_CONFLICT','Reload the subscription and try again.');const next={...latest,autoRenew:false,cancelAtPeriodEnd:true,cancelledAt:now.toISOString(),revision:latest.revision+1,updatedAt:now.toISOString()};await r.put('studentSubscriptions',next);await audit(r,user.id,'subscription.cancel_at_period_end',remote.id);return next;});
}

const eventStatus:Record<string,SubscriptionStatus>={'subscription.created':'created','subscription.authenticated':'authenticated','subscription.activated':'active','subscription.pending':'pending','subscription.halted':'halted','subscription.cancelled':'cancelled','subscription.completed':'completed','subscription.expired':'expired'};
export async function processRecurringEvent(r:Repository,eventId:string,event:{event:string;payload:Record<string,{entity:Record<string,unknown>}>},plans:Plan[],now=new Date()){
  const payment=event.payload.payment?.entity,paymentId=typeof payment?.id==='string'?payment.id:undefined;
  const entity=event.payload.subscription?.entity;
  const providerSubscriptionId=typeof entity?.id==='string'?entity.id:typeof payment?.subscription_id==='string'?payment.subscription_id:undefined;
  if(!providerSubscriptionId)return null;
  const subscription=(await r.find<StudentSubscription>('studentSubscriptions',{providerSubscriptionId},2))[0];if(!subscription)return 'subscription_unknown';
  const plan=subscription.planSnapshot??plans.find(item=>item.code===subscription.planCode);
  if(!plan||(typeof entity?.plan_id==='string'&&entity.plan_id!==plan.razorpayPlanId))throw new ApiError(409,'SUBSCRIPTION_PLAN_MISMATCH','Subscription plan mapping does not match.');
  if(event.event==='payment.failed'){
    if(paymentId&&!await r.get('payments',`subscription:${paymentId}`)){
      const amount=typeof payment?.amount==='number'?payment.amount:planAmount(plan);
      const currency=typeof payment?.currency==='string'?payment.currency:plan.currency;
      const row:PaymentRecord={id:`subscription:${paymentId}`,userId:subscription.userId,razorpayConfigVersion:subscription.razorpayConfigVersion,planCode:plan.code,status:'failed',amount,currency,refundedAmount:0,providerPaymentId:paymentId,failureCode:'RECURRING_PAYMENT_FAILED',createdAt:now.toISOString(),updatedAt:now.toISOString()};
      await r.put('payments',row);
    }
    await r.put('studentSubscriptions',{...subscription,status:'past_due',revision:subscription.revision+1,updatedAt:now.toISOString()});await audit(r,'razorpay','subscription.payment_failed',providerSubscriptionId);return 'recurring_payment_failed';
  }
  if(!entity)return null;
  if(event.event==='subscription.charged'){
    if(!paymentId||typeof payment?.amount!=='number'||payment.amount!==planAmount(plan)||payment.currency!==plan.currency)throw new ApiError(400,'SUBSCRIPTION_CHARGE_INVALID','Recurring charge details are invalid.');
    if(subscription.lastChargeId===paymentId)return 'renewal_duplicate';
    const start=iso(entity.current_start,now),end=iso(entity.current_end,new Date(now.getTime()+(plan.billingPeriodDays??30)*86400000));
    const record:StudentSubscription={...subscription,status:'active',currentPeriodStart:start,currentPeriodEnd:end,nextBillingAt:iso(entity.charge_at,new Date(end)),autoRenew:true,cancelAtPeriodEnd:false,providerCustomerId:typeof entity.customer_id==='string'?entity.customer_id:subscription.providerCustomerId,lastChargeId:paymentId,revision:subscription.revision+1,updatedAt:now.toISOString(),activatedAt:subscription.activatedAt??now.toISOString()};
    await r.put('studentSubscriptions',record);const user=await r.get<User>('users',subscription.userId);if(user)await r.put('users',{...user,plan:plan.code});
    const id=`subscription:${paymentId}`;if(!await r.get('payments',id)){const row:PaymentRecord={id,userId:subscription.userId,razorpayConfigVersion:subscription.razorpayConfigVersion,planCode:plan.code,status:'captured',amount:payment.amount,currency:plan.currency,refundedAmount:0,providerPaymentId:paymentId,paymentMethod:typeof payment.method==='string'?payment.method:undefined,capturedAt:now.toISOString(),createdAt:now.toISOString(),updatedAt:now.toISOString()};await r.put('payments',row);}
    await r.put('subscriptionRenewals',{id:paymentId,eventId,subscriptionId:providerSubscriptionId,userId:subscription.userId,periodStart:start,periodEnd:end,createdAt:now.toISOString()});await audit(r,'razorpay','subscription.charged',providerSubscriptionId);return 'renewed';
  }
  const status=eventStatus[event.event];if(!status)return null;
  const endStates=['cancelled','completed','expired'];const updated:StudentSubscription={...subscription,status,providerCustomerId:typeof entity.customer_id==='string'?entity.customer_id:subscription.providerCustomerId,currentPeriodStart:iso(entity.current_start,new Date(subscription.currentPeriodStart)),currentPeriodEnd:iso(entity.current_end,new Date(subscription.currentPeriodEnd)),nextBillingAt:typeof entity.charge_at==='number'?iso(entity.charge_at,new Date(subscription.currentPeriodEnd)):subscription.nextBillingAt,autoRenew:!endStates.includes(status),cancelAtPeriodEnd:false,revision:subscription.revision+1,updatedAt:now.toISOString(),...(endStates.includes(status)?{cancelledAt:iso(entity.ended_at,now)}:{})};await r.put('studentSubscriptions',updated);
  if(endStates.includes(status)&&Date.parse(updated.currentPeriodEnd)<=now.getTime()){const user=await r.get<User>('users',subscription.userId);if(user)await r.put('users',{...user,plan:'basic'});}await audit(r,'razorpay',event.event,providerSubscriptionId);return status;
}
