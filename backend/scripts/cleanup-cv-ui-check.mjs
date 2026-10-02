import { transaction, closeStore } from '../dist/lib/store.js';
const userId = 'cv-ui-check';
await transaction(async r => { for (const collection of ['sessions', 'auditLogs', 'cvDocuments', 'cvDeletionReceipts', 'cvVersions']) for (const row of await r.find(collection, { userId }, 1000)) await r.remove(collection, row.id); await r.remove('users', userId); });
await closeStore(); console.log(JSON.stringify({ cleaned: true }));
