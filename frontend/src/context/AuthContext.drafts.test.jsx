// @vitest-environment happy-dom
import React, { act, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { AuthProvider, useAuth } from './AuthContext.jsx';
import { api } from '../api/client.js';
vi.mock('../api/client.js',()=>({api:{get:vi.fn(),post:vi.fn()}}));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let auth,root,container;
function Child(){auth=useAuth();return <p>{auth.user?.role}</p>;}
async function mount(){api.get.mockResolvedValue({data:{_id:'user',role:'admin'}});api.post.mockResolvedValue({data:{token:'isolated-token',user:{_id:'user',role:'admin'}}});container=document.createElement('div');document.body.append(container);root=createRoot(container);await act(async()=>root.render(<AuthProvider><Child/></AuthProvider>));await act(async()=>auth.login('test@example.test','test-only'));}
afterEach(async()=>{await act(async()=>root?.unmount());container?.remove();localStorage.clear();vi.clearAllMocks();});
it('waits for pending draft saves before clearing the session',async()=>{
 await mount();let resolve;const promise=new Promise(r=>resolve=r);const before=event=>event.detail.tasks.push(promise);window.addEventListener('erp:before-logout',before);
 try {let completion;await act(async()=>{completion=auth.logout();await Promise.resolve();});expect(localStorage.getItem('token')).toBe('isolated-token');await act(async()=>{resolve();expect(await completion).toBe(true);});expect(localStorage.getItem('token')).toBeNull();expect(auth.user).toBeNull();}
 finally {window.removeEventListener('erp:before-logout',before);}
});
it('keeps the session when the draft cannot be saved so the user can retry',async()=>{
 await mount();const before=event=>event.detail.tasks.push(Promise.reject(new Error('Offline')));window.addEventListener('erp:before-logout',before);
 try {await act(async()=>expect(await auth.logout()).toBe(false));expect(localStorage.getItem('token')).toBe('isolated-token');expect(auth.user.role).toBe('admin');}
 finally {window.removeEventListener('erp:before-logout',before);}
});
