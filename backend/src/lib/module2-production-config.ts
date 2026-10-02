import { z } from 'zod';
import { MongoClient } from 'mongodb';
import { cvProductionConfig } from './cv-production.js';
import { module2Config } from './module2-config.js';
import { authMailConfig } from './auth-mail.js';
import { redisSettings } from './module2-redis.js';

/** Returns variable/category names only, never values or raw validator errors. */
export function module2ProductionIssues(env = process.env): string[] {
  const issues = new Set<string>();
  const required = ['APP_URL', 'AUTH_OTP_SECRET', 'ENABLE_AUTH_EMAIL', 'SMTP_HOST', 'SMTP_PORT', 'SMTP_USER', 'SMTP_PASSWORD', 'AUTH_EMAIL_FROM', 'ENABLE_CV_UPLOADS', 'CV_STORAGE_PROVIDER', 'CV_GOOGLE_DRIVE_CLIENT_ID', 'CV_GOOGLE_DRIVE_CLIENT_SECRET', 'CV_GOOGLE_DRIVE_REFRESH_TOKEN', 'CV_GOOGLE_DRIVE_FOLDER_ID', 'CV_GOOGLE_DRIVE_ACCOUNT', 'CV_SCANNER_PROVIDER', 'CV_SCANNER_URL', 'CV_SCANNER_TOKEN', 'CV_PARSER_PROVIDER', 'CV_PARSER_VERSION', 'REDIS_URL'];
  required.push(...(env.CV_PARSER_PROVIDER === 'textkernel'
    ? ['CV_TEXTKERNEL_ACCOUNT_ID', 'CV_TEXTKERNEL_SERVICE_KEY', 'CV_TEXTKERNEL_REGION']
    : ['CV_PARSER_URL', 'CV_PARSER_TOKEN']));
  for (const key of required) if (!env[key]?.trim()) issues.add(key);
  if (env.DEMO_MODE !== 'false') issues.add('DEMO_MODE');
  if (env.ENABLE_CV_UPLOADS !== 'true') issues.add('ENABLE_CV_UPLOADS');
  if (env.ENABLE_AUTH_EMAIL !== 'true') issues.add('ENABLE_AUTH_EMAIL');
  if (!/^[a-f0-9]{64,}$/i.test(env.AUTH_OTP_SECRET || '')) issues.add('AUTH_OTP_SECRET');
  if (env.DATABASE_URL) { try { const url = new URL(env.DATABASE_URL); if (!['postgres:','postgresql:'].includes(url.protocol)) throw new Error(); } catch { issues.add('DATABASE_URL'); } }
  else {
    if (!/^[A-Za-z0-9_-]+$/.test(env.MONGODB_DATABASE || '')) issues.add('MONGODB_DATABASE');
    try { const client = new MongoClient(env.MONGODB_URI || ''); void client.close(); } catch { issues.add('MONGODB_URI'); }
  }
  try { const url = new URL(env.APP_URL || ''); if (url.protocol !== 'https:' || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new Error(); } catch { issues.add('APP_URL'); }
  try { authMailConfig(env); } catch { issues.add('AUTH_EMAIL_CONFIG'); }
  for (const validate of [() => cvProductionConfig(env), () => module2Config(env)]) {
    try { validate(); } catch (error) {
      if (error instanceof z.ZodError) for (const issue of error.issues) issues.add(String(issue.path[0] || 'CV_CONFIG'));
      else issues.add('CV_CONFIG');
    }
  }
  try { redisSettings({ ...env, NODE_ENV: 'production' }); } catch { issues.add('REDIS_CONFIG'); }
  return [...issues].sort();
}
export function requireModule2Production(env = process.env) {
  const issues = module2ProductionIssues(env);
  if (issues.length) throw new Error('MISSING_OR_INVALID_CONFIG: ' + issues.join(', '));
}
