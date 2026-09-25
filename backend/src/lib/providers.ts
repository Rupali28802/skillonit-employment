import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApiError } from './security.js';
export interface MailProvider {
  send(input: {
    to: string;
    subject: string;
    body: string;
    idempotencyKey: string;
  }): Promise<{ messageId: string }>;
  disconnect(connectionId: string): Promise<void>;
}
export interface CVProvider {
  scan(bytes: Uint8Array): Promise<'clean' | 'rejected'>;
  parse(
    bytes: Uint8Array,
  ): Promise<{ facts: Record<string, unknown>; requiresConfirmation: true }>;
}
export interface SearchProvider {
  search(
    query: Record<string, unknown>,
  ): Promise<{ ids: string[]; total: number }>;
  index(jobId: string): Promise<void>;
}
export interface NotificationProvider {
  send(
    userId: string,
    template: string,
    data: Record<string, string>,
  ): Promise<void>;
}
export interface PaymentProvider {
  checkout(input: {
    amount: number;
    currency: string;
    receipt: string;
  }): Promise<{ id: string; amount: number; currency: string }>;
  verify(body: string, signature: string): boolean;
  verifyCheckout(orderId: string, paymentId: string, signature: string): boolean;
  refund(paymentId: string, input: { amount?: number; receipt: string }): Promise<{ id: string; paymentId: string; amount: number; status: string }>;
  payment(paymentId: string): Promise<{ id: string; orderId: string; amount: number; amountRefunded: number; currency: string; status: string }>;
  createPlan(input:{period:string;interval:number;item:{name:string;amount:number;currency:string;description?:string};notes:Record<string,string>}):Promise<{id:string;period:string;interval:number;amount:number;currency:string}>;
  createSubscription(input:{planId:string;totalCount:number;notes:Record<string,string>}):Promise<{id:string;planId:string;status:string;shortUrl:string|null;currentStart:number|null;currentEnd:number|null;chargeAt:number|null;customerId:string|null}>;
  cancelSubscription(subscriptionId:string,cancelAtCycleEnd:boolean):Promise<{id:string;status:string;endedAt:number|null}>;
}
export class RazorpayProvider implements PaymentProvider {
  private credentials() {
    const key = process.env.RAZORPAY_KEY_ID, secret = process.env.RAZORPAY_KEY_SECRET;
    if (!key || !secret) throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'Payments are not available yet. No charge has been made.');
    return { key, secret };
  }
  private async request(path: string, init: RequestInit = {}) {
    const { key, secret } = this.credentials();
    const response = await fetch('https://api.razorpay.com/v1/' + path, {
      ...init,
      headers: { Authorization: 'Basic ' + Buffer.from(key + ':' + secret).toString('base64'), 'Content-Type': 'application/json', ...init.headers },
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok) throw new ApiError(503, 'PROVIDER_UNAVAILABLE', 'The payment provider could not complete the request.');
    return response.json() as Promise<Record<string, unknown>>;
  }
  async checkout(input: { amount: number; currency: string; receipt: string }) {
    const value = await this.request('orders', {
      method: 'POST',
      body: JSON.stringify(input),
    });
    return value as unknown as { id: string; amount: number; currency: string };
  }
  verify(body: string, signature: string) {
    const secret = process.env.RAZORPAY_WEBHOOK_SECRET;
    if (!secret) return false;
    const expected = createHmac('sha256', secret).update(body).digest();
    const actual = Buffer.from(signature, 'hex');
    return (
      actual.length === expected.length && timingSafeEqual(actual, expected)
    );
  }
  verifyCheckout(orderId: string, paymentId: string, signature: string) {
    const secret = process.env.RAZORPAY_KEY_SECRET;
    if (!secret || !/^[a-f0-9]{64}$/i.test(signature)) return false;
    const expected = createHmac('sha256', secret).update(orderId + '|' + paymentId).digest();
    const actual = Buffer.from(signature, 'hex');
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  }
  async refund(paymentId: string, input: { amount?: number; receipt: string }) {
    const value = await this.request(`payments/${encodeURIComponent(paymentId)}/refund`, { method: 'POST', body: JSON.stringify(input) });
    return { id: String(value.id), paymentId: String(value.payment_id), amount: Number(value.amount), status: String(value.status) };
  }
  async payment(paymentId: string) {
    const value = await this.request(`payments/${encodeURIComponent(paymentId)}`);
    return { id: String(value.id), orderId: String(value.order_id), amount: Number(value.amount), amountRefunded: Number(value.amount_refunded ?? 0), currency: String(value.currency), status: String(value.status) };
  }
  async createPlan(input:{period:string;interval:number;item:{name:string;amount:number;currency:string;description?:string};notes:Record<string,string>}) {
    const value=await this.request('plans',{method:'POST',body:JSON.stringify(input)});
    const item=value.item as Record<string,unknown>;
    return {id:String(value.id),period:String(value.period),interval:Number(value.interval),amount:Number(item?.amount),currency:String(item?.currency)};
  }
  async createSubscription(input:{planId:string;totalCount:number;notes:Record<string,string>}) {
    const value=await this.request('subscriptions',{method:'POST',body:JSON.stringify({plan_id:input.planId,total_count:input.totalCount,quantity:1,customer_notify:true,notes:input.notes})});
    return {id:String(value.id),planId:String(value.plan_id),status:String(value.status),shortUrl:typeof value.short_url==='string'?value.short_url:null,currentStart:typeof value.current_start==='number'?value.current_start:null,currentEnd:typeof value.current_end==='number'?value.current_end:null,chargeAt:typeof value.charge_at==='number'?value.charge_at:null,customerId:typeof value.customer_id==='string'?value.customer_id:null};
  }
  async cancelSubscription(subscriptionId:string,cancelAtCycleEnd:boolean){
    const value=await this.request(`subscriptions/${encodeURIComponent(subscriptionId)}/cancel`,{method:'POST',body:JSON.stringify({cancel_at_cycle_end:cancelAtCycleEnd?1:0})});
    return {id:String(value.id),status:String(value.status),endedAt:typeof value.ended_at==='number'?value.ended_at:null};
  }
}
export function providerHealth() {
  return [
    {
      name: 'MongoDB',
      status: process.env.MONGODB_URI
        ? 'Configured — connection checked on use'
        : 'Not configured',
    },
    {
      name: 'Payments',
      status:
        process.env.RAZORPAY_KEY_ID && process.env.RAZORPAY_KEY_SECRET
          ? process.env.RAZORPAY_WEBHOOK_SECRET ? 'Configured' : 'Credentials configured — webhook secret missing'
          : 'Not configured',
    },
    { name: 'Mailbox OAuth', status: 'Not configured' },
    { name: 'CV scanning and parsing', status: 'Not configured' },
    { name: 'Search index', status: 'Bounded database fallback' },
    {
      name: 'Redis / workers',
      status: process.env.REDIS_URL
        ? 'Configured — worker heartbeat required'
        : 'Not configured',
    },
  ];
}
export class UnconfiguredMailProvider implements MailProvider {
  async send(): Promise<{ messageId: string }> {
    throw new ApiError(
      503,
      'MAIL_UNAVAILABLE',
      'Connect an approved mailbox provider before sending.',
    );
  }
  async disconnect() {}
}
export class MockMailProvider implements MailProvider {
  private sent = new Map<string, string>();
  async send(input: { idempotencyKey: string }) {
    if (process.env.NODE_ENV !== 'test')
      throw Error('Mock mail is restricted to tests.');
    const messageId =
      this.sent.get(input.idempotencyKey) || 'mock:' + input.idempotencyKey;
    this.sent.set(input.idempotencyKey, messageId);
    return { messageId };
  }
  async disconnect() {}
}
