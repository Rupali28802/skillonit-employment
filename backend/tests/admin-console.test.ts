import test from 'node:test';
import assert from 'node:assert/strict';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { Job, User } from '../src/lib/domain.ts';

const blank = { name: '', headline: '', skills: [], experience: null, education: '', country: '', city: '', confirmed: false };
const preferences = { roles: [], relatedRoles: [], countries: [], modes: [], exclusions: [], automation: false, dailyCap: 5 };
const makeUser = (id: string, role: User['role']): User => ({ id, email: `${id}@example.test`, name: id, passwordHash: 'secret-hash', role, plan: 'basic', verified: true, createdAt: '2026-01-01T00:00:00.000Z', profile: blank, preferences });

test('admin console securely manages and oversees existing backend resources', async () => {
  const replica = await MongoMemoryReplSet.create({ replSet: { count: 1 } });
  process.env.MONGODB_URI = replica.getUri(); process.env.MONGODB_DATABASE = 'admin_console_test'; process.env.DEMO_MODE = 'true';
  const store = await import('../src/lib/store.ts');
  const adminConsole = await import('../src/lib/admin-console.ts');
  const employerPortal = await import('../src/lib/employer-portal.ts');
  const billingAdmin = await import('../src/lib/billing-admin.ts');
  const admin = makeUser('admin-one', 'admin'), secondAdmin = makeUser('admin-two', 'admin'), student = makeUser('student-one', 'student'), employerUser = makeUser('employer-user', 'employer'), onboardingEmployer = makeUser('onboarding-employer', 'employer');
  const now = new Date('2026-01-10T00:00:00.000Z');
  const job: Job = {
    id: 'job-one', title: 'Backend Engineer', company: 'Example', domain: 'example.test', country: 'India', state: 'Maharashtra', city: 'Pune', category: 'Technology', skills: ['TypeScript'], mode: 'Remote', type: 'Full-time', salaryMin: 1, salaryMax: 2, currency: 'INR', experienceMin: 1, experienceMax: 3,
    description: 'Build secure backend systems.', requirements: 'TypeScript experience.', method: 'direct', status: 'review', trust: 'pending', employerId: 'employer-one', source: 'employer', discoveredAt: now.toISOString(), expiresAt: '2026-12-01T00:00:00.000Z',
    lifecycle: { schemaVersion: 1, state: 'publishing', revision: 0, changedAt: now.toISOString(), reasonCode: 'SUBMITTED' },
  };
  try {
    await store.bootstrapIndexes();
    await store.transaction(async r => {
      for (const user of [admin, secondAdmin, student, employerUser, onboardingEmployer]) await r.put('users', user);
      await r.put('adminAssignments', { id: admin.id, userId: admin.id, roleId: 'super_admin', createdAt: now.toISOString(), updatedAt: now.toISOString(), updatedBy: admin.id });
      await r.put('sessions', { id: 'session-one', userId: student.id, expiresAt: '2027-01-01T00:00:00.000Z' });
      await r.put('employers', { id: 'employer-one', ownerId: employerUser.id, name: 'Example', domain: 'example.test', country: 'India', description: '', status: 'pending', revision: 0, createdAt: now.toISOString(), updatedAt: now.toISOString() });
      await r.put('employerVerifications', { id: 'employer-one', employerId: 'employer-one', status: 'pending', revision: 0, evidence: [{ id: 'ev-1', type: 'domain', reference: 'example.test', submittedAt: now.toISOString() }], history: [], createdAt: now.toISOString(), updatedAt: now.toISOString() });
      await r.put('entityRiskAssessments', { id: 'employer:employer-one', entityType: 'employer', entityId: 'employer-one', riskLevel: 'low' });
      await r.put('jobs', job);
      await r.put('jobSources', { id: 'source-one', provider: 'employer', enabled: false, status: 'disabled' });
      await r.put('fraudReports', { id: 'report-one', entityType: 'job', entityId: job.id, status: 'pending', detail: 'Review requested.' });
      await r.put('applications', { id: 'application-one', userId: student.id, jobId: job.id, employerId: 'employer-one', method: 'direct', status: 'QUEUED', priority: 10, createdAt: now.toISOString(), scheduledAt: now.toISOString(), jobVerifiedAt: now.toISOString(), attempts: 0, maxAttempts: 3, providerMessageId: 'private-provider-id', delivery: { destination: 'private@example.test' }, snapshot: { confidential: true }, job: { title: job.title, country: job.country, city: job.city }, events: [] });
      await r.put('payments', { id: 'payment-one', userId: student.id, status: 'captured', amount: 99900, currency: 'INR', providerPaymentId: 'private-payment-id', providerOrderId: 'private-order-id', signature: 'private-signature' });
      await r.put('studentSubscriptions', { id: student.id, userId: student.id, planCode: 'pro', status: 'active', currentPeriodStart: now.toISOString(), currentPeriodEnd: '2026-02-10T00:00:00.000Z', autoRenew: false, cancelAtPeriodEnd: false, revision: 1, source: 'razorpay', providerPaymentId: 'private-payment-id', planSnapshot: { code:'pro',name:'Pro',price:999,currency:'INR',dailyCap:25,delayMinutes:60,identity:true,autoApply:true,cvs:3 }, createdAt: now.toISOString(), updatedAt: now.toISOString(), activatedAt: now.toISOString() });
      await r.put('systemConfig', { id: 'fraud-policy', revision: 3, value: { secretLikeData: 'must-not-be-returned' } });
    });

    const users = await adminConsole.listAdminUsers(admin, new URLSearchParams({ role: 'student' }));
    assert.equal(users.items.length, 1); assert.equal('passwordHash' in (users.items[0] as object), false);
    const disabled = await adminConsole.setAdminUserState(admin, student.id, { disabled: true, reason: 'Account security review.' });
    assert.equal(disabled.user.disabled, true); assert.equal(await store.read(r => r.count('sessions', { userId: student.id })), 0);
    await assert.rejects(adminConsole.setAdminUserState(admin, admin.id, { disabled: true, reason: 'Invalid self action.' }), { code: 'SELF_DISABLE_FORBIDDEN' });
    await store.transaction(r => r.put('sessions', { id: 'role-change-session', userId: student.id, expiresAt: '2027-01-01T00:00:00.000Z' }));
    const promoted = await adminConsole.setAdminUserRole(admin, student.id, { role: 'employer', reason: 'Employer account approved.' });
    assert.equal(promoted.user.role, 'employer');
    assert.equal(await store.read(r => r.count('sessions', { userId: student.id })), 0);
    const roleEvents = await store.read(r => r.find<{ reason: string; fromRole: string; toRole: string }>('userRoleEvents', { userId: student.id }, 10));
    assert.equal(roleEvents[0]?.reason, 'Employer account approved.');
    assert.equal(roleEvents[0]?.fromRole, 'student'); assert.equal(roleEvents[0]?.toRole, 'employer');
    await assert.rejects(adminConsole.setAdminUserRole(admin, admin.id, { role: 'student', reason: 'Invalid self change.' }), { code: 'SELF_ROLE_CHANGE_FORBIDDEN' });

    const employer = await adminConsole.adminEmployer(admin, 'employer-one');
    assert.equal(employer.verification?.status, 'pending'); assert.equal((employer.risk as { riskLevel: string }).riskLevel, 'low');
    const verified = await adminConsole.verifyAdminEmployer(admin, 'employer-one', { status: 'verified', note: 'Domain evidence reviewed.' });
    assert.equal(verified.status, 'verified');
    const employerRows = await adminConsole.listAdminEmployers(admin, new URLSearchParams());
    assert.ok(employerRows.items.length >= 2);
    const employerRow = employerRows.items.find(row => (row as Record<string, unknown>).ownerUserId === employerUser.id) as Record<string, unknown>;
    assert.equal(employerRow.ownerUserId, employerUser.id); assert.equal(employerRow.email, employerUser.email); assert.equal(employerRow.role, 'employer');
    assert.equal(employerRow.verificationStatus, 'verified'); assert.equal(employerRow.verificationEvidenceCount, 1);
    const onboardingRow = employerRows.items.find(row => (row as Record<string, unknown>).ownerUserId === onboardingEmployer.id) as Record<string, unknown>;
    assert.equal(onboardingRow.status, 'onboarding_required'); assert.equal(onboardingRow.hasEmployerProfile, false);
    await adminConsole.setAdminUserRole(admin, employerUser.id, { role: 'student', reason: 'Employer owner role review.' });
    const refreshedEmployer = (await adminConsole.listAdminEmployers(admin, new URLSearchParams())).items.find(row => (row as Record<string, unknown>).ownerUserId === employerUser.id) as Record<string, unknown>;
    assert.equal(refreshedEmployer.role, 'student');
    await assert.rejects(employerPortal.getEmployerProfile(employerUser.id), { code: 'FORBIDDEN' });

    const moderated = await adminConsole.moderateAdminJob(admin, job.id, { action: 'close', reason: 'Employer closed this opportunity.' });
    assert.equal(moderated.status, 'closed'); assert.equal(moderated.lifecycle?.state, 'closed');
    const reviewed = await adminConsole.reviewAdminFraud(admin, 'report-one', { status: 'resolved', note: 'Evidence reviewed and retained.' });
    assert.equal(reviewed.status, 'resolved');
    await assert.rejects(adminConsole.reviewAdminFraud(admin, 'report-one', { status: 'rejected', note: 'Second decision is forbidden.' }), { code: 'FRAUD_REPORT_FINAL' });

    const applications = await adminConsole.listAdminApplications(admin, new URLSearchParams());
    const application = applications.items[0] as Record<string, unknown>;
    assert.equal('snapshot' in application, false); assert.equal('delivery' in application, false); assert.equal('providerMessageId' in application, false);
    const payments = await adminConsole.listAdminPayments(admin, new URLSearchParams());
    const payment = payments.items[0] as Record<string, unknown>;
    assert.equal('providerPaymentId' in payment, false); assert.equal('providerOrderId' in payment, false); assert.equal('signature' in payment, false);
    const financePayments = await billingAdmin.adminPayments(admin, new URLSearchParams());
    assert.equal(financePayments.items[0]?.email, student.email);
    assert.equal(financePayments.items[0]?.razorpayPaymentId, 'private-payment-id');
    const paymentDetail = await billingAdmin.adminPaymentDetail(admin, 'payment-one');
    assert.equal(paymentDetail.refundableAmount, 99900);
    assert.equal('signature' in paymentDetail.payment, false);
    const subscriptions = await billingAdmin.adminSubscriptions(admin, new URLSearchParams({ plan: 'pro' }));
    assert.equal(subscriptions.items[0]?.email, student.email);
    assert.equal(subscriptions.items[0]?.status, 'active');
    assert.equal(subscriptions.total, 1);
    const pagedSubscriptions = await billingAdmin.adminSubscriptions(admin, new URLSearchParams({ page: '1', limit: '1', query: student.email }));
    assert.equal(pagedSubscriptions.items.length, 1);
    assert.equal(pagedSubscriptions.page, 1);
    const subscriptionDetail = await billingAdmin.adminSubscriptionDetail(admin, student.id);
    assert.equal(subscriptionDetail.user?.email, student.email);
    assert.equal(subscriptionDetail.subscription.plan, 'pro');
    assert.equal(JSON.stringify(subscriptionDetail).includes('private-payment-id'), false);

    const configuration = await adminConsole.adminConfiguration(admin);
    assert.equal(configuration.items.find(item => item.id === 'fraud-policy')?.revision, 3);
    assert.equal(JSON.stringify(configuration).includes('must-not-be-returned'), false);
    const auditRows = await adminConsole.listAdminAudit(admin, new URLSearchParams());
    assert.ok(auditRows.items.length >= 4);
    await assert.rejects(adminConsole.adminOverview(student), { code: 'FORBIDDEN' });

    const roles = await adminConsole.adminConsoleRoute(admin, ['admin', 'console', 'roles'], 'GET', new URLSearchParams(), async () => ({})) as { roles: { id: string; protected:boolean; editable:boolean; memberCount:number }[]; members:{id:string;roleId:string}[]; assignableRoleIds:string[] };
    assert.ok(roles.roles.some(role => role.id === 'super_admin'));
    assert.equal(roles.roles.find(role=>role.id==='super_admin')?.protected,true);
    assert.equal(roles.roles.find(role=>role.id==='super_admin')?.editable,false);
    assert.equal(roles.roles.find(role=>role.id==='super_admin')?.memberCount,1);
    assert.equal(roles.members.find(member=>member.id===admin.id)?.roleId,'super_admin');
    assert.ok(roles.assignableRoleIds.includes('moderator'));
    await adminConsole.adminConsoleRoute(admin, ['admin', 'console', 'roles', secondAdmin.id, 'assignment'], 'PUT', new URLSearchParams(), async () => ({ roleId: 'finance', reason: 'Finance operations assignment.' }));
    const adminRoleEvents = await store.read(r => r.find<{ reason: string }>('adminRoleEvents', { userId: secondAdmin.id }, 10));
    assert.equal(adminRoleEvents[0]?.reason, 'Finance operations assignment.');
    await assert.rejects(adminConsole.listAdminUsers(secondAdmin, new URLSearchParams()), { code: 'ADMIN_PERMISSION_REQUIRED' });
    assert.equal((await billingAdmin.adminSubscriptionDetail(secondAdmin, student.id)).subscription.plan, 'pro');
    await assert.rejects(adminConsole.setAdminUserRole(secondAdmin, student.id, { role: 'admin', reason: 'Unauthorized escalation attempt.' }), { code: 'ADMIN_PERMISSION_REQUIRED' });
    await assert.rejects(adminConsole.deleteAdminUser(secondAdmin, student.id), { code: 'ADMIN_PERMISSION_REQUIRED' });
    await assert.rejects(adminConsole.setAdminUserRole(secondAdmin, employerUser.id, { role: 'admin', reason: 'Unauthorized employer escalation.' }), { code: 'ADMIN_PERMISSION_REQUIRED' });
    await assert.rejects(adminConsole.deleteAdminUser(secondAdmin, employerUser.id), { code: 'ADMIN_PERMISSION_REQUIRED' });
    await assert.rejects(adminConsole.deleteAdminUser(admin, admin.id), { code: 'SELF_DELETE_FORBIDDEN' });
    const deletedEmployer = await adminConsole.deleteAdminUser(admin, employerUser.id);
    assert.equal(deletedEmployer.deleted, true);
    const remainingEmployers = await adminConsole.listAdminEmployers(admin, new URLSearchParams());
    assert.equal(remainingEmployers.items.some(row => (row as Record<string, unknown>).ownerUserId === employerUser.id), false);
    assert.equal(remainingEmployers.items.some(row => (row as Record<string, unknown>).ownerUserId === onboardingEmployer.id), true);
    const deleted = await adminConsole.deleteAdminUser(admin, student.id);
    assert.equal(deleted.deleted, true);
    assert.equal(await store.read(r => r.get('users', student.id)), null);
    assert.equal((await adminConsole.listAdminPayments(secondAdmin, new URLSearchParams())).items.length, 1);
    await assert.rejects(adminConsole.adminConsoleRoute(admin, ['admin', 'console', 'roles', admin.id, 'assignment'], 'PUT', new URLSearchParams(), async () => ({ roleId: 'analyst', reason: 'Self escalation test.' })), { code: 'SELF_ROLE_CHANGE_FORBIDDEN' });
  } finally {
    await store.closeStore(); await replica.stop();
    delete process.env.MONGODB_URI; delete process.env.MONGODB_DATABASE;
  }
});
