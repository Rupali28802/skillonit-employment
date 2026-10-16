import test from 'node:test';
import assert from 'node:assert/strict';
import { suggestRolesFromSkills } from '../src/lib/role-suggestions.ts';

test('confirmed frontend skills produce grounded related role suggestions', () => {
  assert.deepEqual(suggestRolesFromSkills(['HTML', 'CSS', 'JavaScript', 'React.js']), [
    'React Developer', 'Frontend Developer', 'JavaScript Developer', 'Web Developer',
  ]);
});

test('role suggestions do not infer unrelated work from unknown skills', () => {
  assert.deepEqual(suggestRolesFromSkills(['Unknown Private Tool']), []);
  assert.ok(!suggestRolesFromSkills(['React']).includes('Backend Developer'));
});
