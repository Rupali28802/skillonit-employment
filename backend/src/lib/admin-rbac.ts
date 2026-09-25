import { z } from 'zod';
import type { User } from './domain.js';
import type { Repository } from './store.js';
import { ApiError, audit, id } from './security.js';
import { revokeSessions } from './auth-lifecycle.js';

export const adminPermissions = [
  'users.read','users.update','users.disable','users.enable','employers.read','employers.verify','employers.reject',
  'jobs.read','jobs.moderate','jobs.publish','applications.read','fraud.read','fraud.review','fraud.resolve',
  'payments.read','payments.refund','subscriptions.read','subscriptions.manage','plans.read','plans.update','entitlements.manage','notifications.read','notifications.manage','system.read',
  'configuration.read','configuration.update','admin.users.manage','admin.roles.manage','admin.permissions.manage',
  'audit.read','privacy.read','privacy.process','sources.read','sources.update','analytics.read',
] as const;
export type AdminPermission = typeof adminPermissions[number];
export type AdminRoleId = 'super_admin'|'admin'|'moderator'|'support'|'operations'|'finance'|'analyst';
type Assignment = { id:string; userId:string; roleId:AdminRoleId; createdAt:string; updatedAt:string; updatedBy:string };
type RoleEvent = { id:string; actorId:string; userId:string; roleId:AdminRoleId; reason:string; createdAt:string; result:'success' };

const all = [...adminPermissions];
export const builtInAdminRoles: { id:AdminRoleId; name:string; description:string; permissions:AdminPermission[] }[] = [
  { id:'super_admin', name:'Super Admin', description:'Full platform administration, including role assignments.', permissions:all },
  { id:'admin', name:'Admin', description:'Platform operations without super-administrator delegation.', permissions:all.filter(p=>!p.startsWith('admin.')) },
  { id:'moderator', name:'Moderator', description:'Employer, job, application and fraud moderation.', permissions:['employers.read','employers.verify','employers.reject','jobs.read','jobs.moderate','jobs.publish','applications.read','fraud.read','fraud.review','fraud.resolve','sources.read'] },
  { id:'support', name:'Support', description:'Read-only user and application support with privacy workflows.', permissions:['users.read','applications.read','notifications.read','privacy.read','privacy.process','audit.read'] },
  { id:'operations', name:'Operations', description:'Job sources, queues and operational configuration.', permissions:['jobs.read','applications.read','sources.read','sources.update','system.read','configuration.read','notifications.read'] },
  { id:'finance', name:'Finance', description:'Plans, payments, subscriptions and finance operations.', permissions:['payments.read','payments.refund','subscriptions.read','subscriptions.manage','plans.read','plans.update','entitlements.manage','analytics.read','audit.read'] },
  { id:'analyst', name:'Analyst', description:'Read-only platform analytics and operational visibility.', permissions:['analytics.read','system.read','users.read','employers.read','jobs.read','applications.read','sources.read'] },
];
const roleSchema = z.enum(['super_admin','admin','moderator','support','operations','finance','analyst']);

export async function resolveAdminAccess(r:Repository, actor:User) {
  const current=await r.get<User>('users',actor.id);
  if(!current||current.disabled||current.role!=='admin') throw new ApiError(403,'FORBIDDEN','Administrator access required.');
  const assignment=await r.get<Assignment>('adminAssignments',actor.id);
  let roleId:AdminRoleId=assignment?.roleId??'admin';
  if(!assignment){
    const active=(await r.find<User>('users',{role:'admin'},100)).filter(user=>!user.disabled);
    if(active.length===1&&active[0]?.id===actor.id) roleId='super_admin';
  }
  const role=builtInAdminRoles.find(item=>item.id===roleId)!;
  return { userId:actor.id, roleId, roleName:role.name, permissions:role.permissions };
}

export async function requireAdminPermission(r:Repository,actor:User,permission:AdminPermission){
  const access=await resolveAdminAccess(r,actor);
  if(!access.permissions.includes(permission)) throw new ApiError(403,'ADMIN_PERMISSION_REQUIRED','Your administrator role does not permit this operation.');
  return access;
}

export async function listAdminRoles(r:Repository,actor:User){
  await requireAdminPermission(r,actor,'admin.roles.manage');
  const assignments=await r.find<Assignment>('adminAssignments',{},1000);
  const activeAdmins=(await r.find<User>('users',{role:'admin'},1000)).filter(user=>!user.disabled);
  const events=(await r.find<RoleEvent>('adminRoleEvents',{},1000)).sort((a,b)=>b.createdAt.localeCompare(a.createdAt));
  const members=activeAdmins.map(user=>({id:user.id,name:user.name,email:user.email,roleId:assignments.find(item=>item.userId===user.id)?.roleId??(activeAdmins.length===1?'super_admin':'admin')}));
  return {
    roles:builtInAdminRoles.map(role=>{const roleEvents=events.filter(event=>event.roleId===role.id);return {...role,memberCount:members.filter(member=>member.roleId===role.id).length,status:'active',protected:true,editable:false,createdAt:null,updatedAt:roleEvents[0]?.createdAt??null};}),
    permissions:adminPermissions,
    members,
    history:events.slice(0,100).map(event=>({id:event.id,createdAt:event.createdAt,actorId:event.actorId,targetUserId:event.userId,roleId:event.roleId,action:'admin.role_assigned',reason:event.reason,result:event.result})),
    assignableRoleIds:builtInAdminRoles.map(role=>role.id),
  };
}

export async function assignAdminRole(r:Repository,actor:User,userId:string,input:unknown){
  await requireAdminPermission(r,actor,'admin.users.manage');
  const {roleId,reason}=z.object({roleId:roleSchema,reason:z.string().trim().min(3).max(500)}).strict().parse(input);
  if(actor.id===userId) throw new ApiError(409,'SELF_ROLE_CHANGE_FORBIDDEN','Administrators cannot change their own administrative role.');
  const target=await r.get<User>('users',userId);
  if(!target||target.disabled||target.role!=='admin') throw new ApiError(404,'ADMIN_NOT_FOUND','Active administrator not found.');
  const now=new Date().toISOString();
  await r.put('adminAssignments',{id:userId,userId,roleId,createdAt:(await r.get<Assignment>('adminAssignments',userId))?.createdAt??now,updatedAt:now,updatedBy:actor.id});
  await r.put('adminRoleEvents',{id:id(),actorId:actor.id,userId,roleId,reason,createdAt:now,result:'success'});
  await revokeSessions(r,userId);
  await audit(r,actor.id,'admin.role_assigned',userId);
  return {userId,roleId,sessionsRevoked:true,reasonRecorded:true};
}
