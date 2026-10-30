import test from 'node:test';
import assert from 'node:assert/strict';
import { once } from 'node:events';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import type { User } from '../src/lib/domain.ts';

test('same account password login follows admin role changes and revoked sessions cannot retain employer access', async () => {
  const old = {...process.env};
  const replica = await MongoMemoryReplSet.create({replSet:{count:1}});
  delete process.env.DATABASE_URL;
  Object.assign(process.env,{MONGODB_URI:replica.getUri(),MONGODB_DATABASE:'role_login_isolated',DEMO_MODE:'true',APP_URL:'http://localhost:3102'});
  const store=await import('../src/lib/store.ts'), security=await import('../src/lib/security.ts');
  const {app}=await import('../src/app.ts');
  const server=app.listen(0,'127.0.0.1'); await once(server,'listening');
  const base=`http://127.0.0.1:${(server.address() as {port:number}).port}/api/v1/`;
  const password='IsolatedRoleFlow123!';
  const user=(id:string,role:User['role']):User=>({id,role,email:`${id}@example.test`,name:id,passwordHash:security.hashPassword(password),verified:true,plan:'basic',createdAt:new Date().toISOString(),profile:{name:id,headline:'Retained headline',skills:['TypeScript'],experience:1,education:'Degree',country:'India',city:'Pune',confirmed:true},preferences:{roles:[],relatedRoles:[],countries:[],modes:[],exclusions:[],automation:false,dailyCap:5}});
  async function call(path:string,cookie='',method='GET',body?:unknown,status=200) {
    const response=await fetch(base+path,{method,headers:{Origin:process.env.APP_URL!,'Content-Type':'application/json',Cookie:cookie},...(body===undefined?{}:{body:JSON.stringify(body)})});
    const result=await response.json(); assert.equal(response.status,status,`${method} ${path}: ${JSON.stringify(result.error)}`);
    return {data:result.data,error:result.error,cookie:response.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')};
  }
  const login=(id:string)=>call('auth/login','','POST',{email:`${id}@example.test`,password});
  try {
    await store.bootstrapIndexes();
    await store.transaction(async r=>{await r.put('users',user('candidate','student'));await r.put('users',user('admin','admin'));await r.put('adminAssignments',{id:'admin',userId:'admin',roleId:'super_admin',revision:0,assignedBy:'fixture',assignedAt:new Date().toISOString()});});
    const admin=await login('admin'), initial=await login('candidate');
    assert.equal(initial.data.user.role,'student'); assert.ok(initial.cookie);
    await call('employer/overview',initial.cookie,'GET',undefined,403);
    const wrongPortal=await call('auth/login','','POST',{email:'candidate@example.test',password,role:'employer'},403);
    assert.equal(wrongPortal.error.code,'ACCOUNT_ROLE_MISMATCH');
    assert.equal((await store.read(r=>r.get<User>('users','candidate')))?.role,'student');
    const registeredEmployer=await call('auth/register','','POST',{name:'New Employer',email:'employer-registration@example.test',password,role:'employer'},201);
    assert.equal(registeredEmployer.data.user.role,'employer');
    await call('employer/overview',registeredEmployer.cookie);
    const promoted=await call('admin/console/users/candidate/role',admin.cookie,'PUT',{role:'employer',reason:'Isolated role flow verification'});
    assert.equal(promoted.data.user.role,'employer');
    assert.notEqual(promoted.data.user.disabled,true);
    assert.equal(promoted.data.sessionsRevoked,true);
    await call('employer/overview',initial.cookie,'GET',undefined,401);
    const employer=await login('candidate');
    assert.equal(employer.data.user.id,initial.data.user.id);assert.equal(employer.data.user.role,'employer');
    assert.equal((await call('session',employer.cookie)).data.user.role,'employer');
    await call('employer/overview',employer.cookie);
    assert.equal((await call('employers',employer.cookie)).data,null);
    await call('admin/console/users',employer.cookie,'GET',undefined,403);
    await call('auth/logout',employer.cookie,'POST',{});
    await call('employer/overview',employer.cookie,'GET',undefined,401);
    const again=await login('candidate');assert.equal(again.data.user.role,'employer');
    await call('admin/console/users/candidate/role',admin.cookie,'PUT',{role:'student',reason:'Restore isolated candidate role'});
    await call('employer/overview',again.cookie,'GET',undefined,401);
    const candidate=await login('candidate');assert.equal(candidate.data.user.role,'student');
    await call('employer/overview',candidate.cookie,'GET',undefined,403);
    assert.equal((await store.read(r=>r.get<User>('users','candidate')))?.profile.headline,'Retained headline');
    assert.equal(await store.read(r=>r.count('users',{email:'candidate@example.test'})),1);
  } finally {
    server.closeAllConnections();await new Promise<void>(resolve=>server.close(()=>resolve()));await store.closeStore();await replica.stop();process.env=old;
  }
});
