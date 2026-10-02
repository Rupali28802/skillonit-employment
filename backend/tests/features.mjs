import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
const base = process.env.TEST_URL || "http://localhost:4000";
if (!["localhost", "127.0.0.1"].includes(new URL(base).hostname))
  throw Error("Local test servers only.");
function client() {
  let cookie = "";
  return async (path, method = "GET", body, status = 200) => {
    const response = await fetch(base + "/api/v1/" + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        Origin: process.env.TEST_ORIGIN || "http://localhost:3000",
        Cookie: cookie,
      },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    if (response.headers.get("set-cookie"))
      cookie = response.headers.get("set-cookie").split(";")[0];
    const result = await response.json();
    assert.equal(response.status, status, `${method} ${path}: ${result.error?.message}`);
    return result.data;
  };
}
const visitor = client(),
  candidate = client(),
  other = client(),
  admin = client();
assert.equal((await visitor("health")).mode, "demo");
await visitor("me/saved-searches", "GET", undefined, 401);
for (const c of [candidate, other]) {
  const result = await c(
    "auth/register",
    "POST",
    {
      name: "Feature test",
      email: `${randomUUID()}@example.test`,
      password: randomUUID(),
      role: "student",
    },
    201,
  );
  await c("auth/verify-email", "POST", {
    email: result.user.email,
    otp: result.demoVerificationOtp,
  });
  await c(
    "auth/verify-email",
    "POST",
    { email: result.user.email, otp: result.demoVerificationOtp },
    400,
  );
}
const profile = {
  name: "Feature test",
  headline: "Developer",
  skills: ["React", "CSS"],
  experience: 2,
  education: "Test degree",
  country: "India",
  city: "Bengaluru",
  confirmed: true,
};
await candidate("me/profile", "PUT", profile);
await candidate("me/preferences", "PUT", {
  roles: ["Developer"],
  relatedRoles: [],
  countries: [],
  modes: [],
  exclusions: [],
  automation: false,
  dailyCap: 1,
});
const concurrent = await Promise.allSettled([
  candidate("applications", "POST", { jobId: "sample-1", confirmed: true }, 201),
  candidate("applications", "POST", { jobId: "sample-3", confirmed: true }, 201),
]);
assert.equal(
  concurrent.filter((item) => item.status === "fulfilled").length,
  2,
  "Both attempts are durable; only one can reserve the final quota slot",
);
for (const item of concurrent)
  if (item.status === "rejected")
    assert.equal(
      item.reason.actual,
      409,
      "Quota races must return a clear eligibility error, not an internal failure",
    );
const applications = await candidate("applications");
assert.equal(applications.length, 2);
assert.equal(applications.filter(item => item.status === 'DIRECT_SUBMITTED').length, 1);
assert.equal(applications.filter(item => item.status === 'NEEDS_REVIEW' && item.reasons.some(reason => reason.code === 'DAILY_CAP_REACHED')).length, 1);
const usage = await candidate("me/usage");
assert.equal(usage.usage.count, 1);
const search = await candidate(
  "me/saved-searches",
  "POST",
  { name: "React roles", query: "React", country: "", mode: "", enabled: true },
  201,
);
await other(`me/saved-searches/${search.id}`, "DELETE", {}, 404);
assert.ok((await candidate("me/alerts/refresh", "POST", {})).created > 0);
assert.equal((await candidate("me/alerts/refresh", "POST", {})).created, 0);
const notifications = await candidate("me/notifications");
assert.ok(notifications.length);
await other("me/notifications", "PATCH", { id: notifications[0].id }, 404);
await candidate("me/notifications", "PATCH", { id: notifications[0].id });
await candidate(
  "me/notification-preferences",
  "PUT",
  { inApp: true, email: true, whatsapp: false },
  409,
);
const cvInput = {
  name: "Developer CV",
  targetRole: "Developer",
  summary: "Candidate-authored test summary with confirmed facts.",
  profile,
  confirmed: true,
};
await candidate("me/cv-versions", "POST", { ...cvInput, confirmed: false }, 400);
const cv = await candidate("me/cv-versions", "POST", cvInput, 201);
await other("me/cv-versions/" + cv.id, "GET", undefined, 404);
await other("me/cv-versions/" + cv.id, "DELETE", {}, 404);
await candidate("me/cv-versions", "POST", cvInput, 409);
await candidate("me/profile", "PUT", { ...profile, headline: "Changed later" });
assert.equal((await candidate("me/cv-versions/" + cv.id)).profile.headline, "Developer");
const template = {
  subject: "Application {{job_title}}",
  body: "Please consider my confirmed profile. Thank you {{name}}",
  signature: "{{name}}",
};
await candidate("me/templates", "PUT", { ...template, signature: "{{invented}}" }, 400);
await candidate("me/templates", "PUT", template);
await candidate("me/templates", "PUT", {
  ...template,
  subject: "Updated {{job_title}}",
});
assert.equal((await candidate("me/template-history")).length, 2);
assert.equal((await other("me/template-history")).length, 0);
const result = await candidate("assistant", "POST", { message: "React" });
assert.equal(result.mode, "keyword-search");
assert.ok(result.jobs.every((job) => !job.identityVisible));
await candidate("applications/missing/not-a-real-action", "POST", {}, 404);
await admin("auth/demo", "POST", { role: "admin" });
await candidate(
  "admin/configuration",
  "PUT",
  { email: "test@example.test", phone: "", announcement: "" },
  403,
);
const config = await admin("admin/configuration");
await admin("admin/configuration", "PUT", {
  email: config.email,
  phone: config.phone,
  announcement: config.announcement,
});
assert.equal((await visitor("public/configuration")).email, config.email);
const flags = await admin("admin/feature-flags");
await candidate("admin/feature-flags", "PUT", { assistant: false, savedSearchAlerts: false }, 403);
await admin("admin/feature-flags", "PUT", {
  assistant: false,
  savedSearchAlerts: false,
});
await candidate("assistant", "POST", { message: "React" }, 503);
await candidate("me/alerts/refresh", "POST", {}, 503);
await admin("admin/feature-flags", "PUT", flags);
await admin(
  "admin/source-policies",
  "POST",
  {
    name: "Synthetic policy",
    board: "example",
    policyEvidence: "Synthetic test only. Not approved for any external acquisition.",
    requestsPerMinute: 1,
    enabled: true,
    approved: false,
  },
  409,
);
await admin(
  "admin/source-policies",
  "POST",
  {
    name: "Synthetic policy",
    board: "https://127.0.0.1",
    policyEvidence: "Synthetic test only. Not approved for any external acquisition.",
    requestsPerMinute: 1,
    enabled: false,
    approved: false,
  },
  400,
);
await candidate("me/cv-versions/" + cv.id, "DELETE", {});
await candidate("me/saved-searches/" + search.id, "DELETE", {});
console.log(
  "PASS: saved search alerts/deduplication, notifications/ownership, confirmed CV snapshots/quotas, template history, private assistant results, admin authorization and invalid application actions.",
);
