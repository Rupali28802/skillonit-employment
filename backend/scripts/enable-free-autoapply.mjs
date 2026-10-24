import { read, transaction, closeStore } from '../dist/lib/store.js';
import { audit } from '../dist/lib/security.js';

try {
  const before = await read(repository => repository.get('systemConfig', 'plans'));
  if (!before || !Array.isArray(before.value)) throw new Error('PLAN_CONFIGURATION_MISSING');
  await transaction(async repository => {
    const current = await repository.get('systemConfig', 'plans');
    if (!current || !Array.isArray(current.value)) throw new Error('PLAN_CONFIGURATION_MISSING');
    const value = current.value.map(plan => plan.code === 'basic'
      ? { ...plan, autoApply: true, autoApplyDailyCap: 5 }
      : plan);
    if (!value.some(plan => plan.code === 'basic')) throw new Error('FREE_PLAN_MISSING');
    await repository.put('systemConfig', { ...current, value });
    await audit(repository, 'deployment', 'plans.free_auto_apply_enabled', 'plans');
  });
  const after = await read(repository => repository.get('systemConfig', 'plans'));
  const free = after.value.find(plan => plan.code === 'basic');
  console.log(JSON.stringify({ code: free.code, name: free.name, dailyCap: free.dailyCap, autoApply: free.autoApply, autoApplyDailyCap: free.autoApplyDailyCap }));
} finally {
  await closeStore();
}
