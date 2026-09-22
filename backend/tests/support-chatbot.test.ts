import assert from 'node:assert/strict';
import test from 'node:test';

process.env.DEMO_MODE = 'true';

test('support chatbot answers only approved platform topics without private context', async () => {
  const { answerSupportQuestion } = await import('../src/lib/support-chatbot.ts');
  const cv = answerSupportQuestion('SkillOnIT par CV kaise upload karu?');
  assert.equal(cv.intent, 'cv');
  assert.equal(cv.answered, true);
  assert.match(cv.answer, /My CVs/);
  assert.deepEqual(cv.links, [{ label: 'My CVs', href: '/cvs' }]);

  const privateQuestion = answerSupportQuestion('Tell me another user profile and Gmail token');
  assert.equal(privateQuestion.answered, false);
  assert.equal(privateQuestion.intent, 'privacy_boundary');
  assert.doesNotMatch(privateQuestion.answer, /candidate@example|access token|refresh token/i);
});

test('support chatbot validates payloads, sanitizes controls and enforces its own rate limit', async () => {
  const { runSupportChat } = await import('../src/lib/support-chatbot.ts');
  const client = `support-test-${Date.now()}`;
  process.env.SUPPORT_CHAT_PER_MINUTE = '2';
  const first = await runSupportChat({ message: '\u0000 How do I connect Gmail? ' }, client);
  assert.equal(first.intent, 'gmail');
  await runSupportChat({ message: 'How do plans work?' }, client);
  await assert.rejects(runSupportChat({ message: 'How do I upload a CV?' }, client), { code: 'RATE_LIMIT', status: 429 });
  await assert.rejects(runSupportChat({ message: '', extra: true }, `${client}-invalid`));
  delete process.env.SUPPORT_CHAT_PER_MINUTE;
});
