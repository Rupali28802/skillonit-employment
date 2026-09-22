'use client';

import { useCallback, useEffect, useState, type SyntheticEvent } from 'react';

type Role = { id:string; name:string; description:string; status:string; memberCount:number; permissions:string[] };
type AdminUser = { id:string; name?:string; email?:string };

async function call(path:string,init?:RequestInit){
  const headers=new Headers(init?.headers); headers.set('content-type','application/json');
  const response=await fetch('/api/v1/'+path,{credentials:'include',cache:'no-store',...init,headers});
  const payload=await response.json().catch(()=>({}));
  if(!response.ok) throw new Error(payload.error?.message||'The administrator operation failed.');
  return payload.data;
}

export function AdminRolesPanel(){
  const [roles,setRoles]=useState<Role[]>([]),[admins,setAdmins]=useState<AdminUser[]>([]);
  const [userId,setUserId]=useState(''),[roleId,setRoleId]=useState(''),[reason,setReason]=useState('');
  const [loading,setLoading]=useState(true),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const load=useCallback(async()=>{
    setLoading(true); setMessage('');
    try{const [roleData,userData]=await Promise.all([call('admin/console/roles'),call('admin/console/users?role=admin&limit=100')]);setRoles(roleData.roles);setAdmins(userData.items);}
    catch(error){setMessage(error instanceof Error?error.message:'Role data is unavailable.');}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{queueMicrotask(()=>void load());},[load]);
  async function assign(event:SyntheticEvent<HTMLFormElement>){
    event.preventDefault(); if(!userId||!roleId||reason.trim().length<3)return;
    if(!window.confirm('Assign this administrator role and revoke the user’s existing sessions?'))return;
    setBusy(true); setMessage('');
    try{await call(`admin/console/roles/${encodeURIComponent(userId)}/assignment`,{method:'PUT',body:JSON.stringify({roleId,reason})});setReason('');await load();setMessage('Role assigned, sessions revoked, and the reason recorded in the audit history.');}
    catch(error){setMessage(error instanceof Error?error.message:'Role assignment failed.');}
    finally{setBusy(false);}
  }
  if(loading)return <output className="admin-state"><span className="admin-spinner"/>Loading backend-enforced roles…</output>;
  return <div className="stack">
    {message&&<output className="admin-state">{message}</output>}
    <section className="admin-card"><div className="admin-card-head"><div><p className="eyebrow">ACCESS CONTROL</p><h2>Roles and permissions</h2><p>Built-in roles are enforced by the backend. Application account types remain separate from administrative access.</p></div><button onClick={()=>void load()}>Refresh</button></div>
      <div className="admin-role-grid">{roles.map(role=><article key={role.id}><div className="admin-card-head"><div><h3>{role.name}</h3><p>{role.description}</p></div><span className="admin-badge is-good">{role.status}</span></div><strong>{role.memberCount} assigned</strong><div className="admin-permission-list">{role.permissions.map(permission=><code key={permission}>{permission}</code>)}</div></article>)}</div>
    </section>
    <section className="admin-card"><div className="admin-card-head"><div><p className="eyebrow">HIGH-RISK ACTION</p><h2>Assign an administrator role</h2><p>The target must already be an active admin. Self changes are blocked and existing sessions are revoked.</p></div></div>
      <form className="admin-filters" onSubmit={event=>void assign(event)}>
        <label>Administrator<select value={userId} onChange={event=>setUserId(event.target.value)} required><option value="">Select administrator</option>{admins.map(user=><option key={user.id} value={user.id}>{user.name||user.email||user.id}</option>)}</select></label>
        <label>Role<select value={roleId} onChange={event=>setRoleId(event.target.value)} required><option value="">Select role</option>{roles.map(role=><option key={role.id} value={role.id}>{role.name}</option>)}</select></label>
        <label>Reason<input value={reason} onChange={event=>setReason(event.target.value)} minLength={3} maxLength={500} required placeholder="Reason for this access change"/></label>
        <button className="primary" disabled={busy} type="submit">{busy?'Assigning…':'Assign role'}</button>
      </form>
    </section>
  </div>;
}
