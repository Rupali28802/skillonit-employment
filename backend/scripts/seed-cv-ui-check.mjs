import { hashPassword } from '../dist/lib/security.js';
import { transaction, closeStore } from '../dist/lib/store.js';
const id = 'cv-ui-check';
const email = 'cv-ui-check@example.invalid';
const password = 'CvUiCheck-Temporary-2026!';
await transaction(r => r.put('users', { id, email, name: 'CV UI Check', passwordHash: hashPassword(password), role: 'student', plan: 'basic', verified: true, disabled: false, createdAt: new Date().toISOString(), profile: { name: '', headline: '', skills: [], experience: null, education: '', country: '', city: '', confirmed: false }, profileRevision: 0, preferences: { roles: [], relatedRoles: [], countries: [], modes: [], exclusions: [], automation: false, dailyCap: 0 } }));
await closeStore();
console.log(JSON.stringify({ email, password }));
