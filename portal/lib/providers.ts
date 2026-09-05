import { createHmac, timingSafeEqual } from 'node:crypto';
import { ApiError } from './security';
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
}
export class RazorpayProvider implements PaymentProvider {
  async checkout(input: { amount: number; currency: string; receipt: string }) {
    const key = process.env.RAZORPAY_KEY_ID,
      secret = process.env.RAZORPAY_KEY_SECRET;
    if (!key || !secret)
      throw new ApiError(
        503,
        'PROVIDER_UNAVAILABLE',
        'Payments are not available yet. No charge has been made.',
      );
    const response = await fetch('https://api.razorpay.com/v1/orders', {
      method: 'POST',
      headers: {
        Authorization:
          'Basic ' + Buffer.from(key + ':' + secret).toString('base64'),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(input),
      signal: AbortSignal.timeout(10000),
    });
    if (!response.ok)
      throw new ApiError(
        503,
        'PROVIDER_UNAVAILABLE',
        'The payment provider could not create your order.',
      );
    return response.json();
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
          ? 'Configured — activation pending verification'
          : 'Not configured',
    },
    { name: 'Mailbox OAuth', status: 'Not configured' },
    { name: 'CV scanning and parsing', status: 'Not configured' },
    { name: 'WhatsApp', status: 'Not configured' },
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
