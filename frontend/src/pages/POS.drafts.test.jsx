// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import POS from './POS.jsx';
import { api } from '../api/client.js';
vi.mock('../context/AuthContext.jsx',()=>({useAuth:()=>({has:(...roles)=>roles.includes('admin')})}));
vi.mock('../api/client.js',()=>({api:{get:vi.fn(),put:vi.fn(),post:vi.fn(),delete:vi.fn()}}));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let root,container,client;
const state={cart:[{product:'p1',name:'Laptop',model:'T14',sku:'L1',stock:20,quantity:3,unitPrice:150,discount:'',serials:[],tracksSerials:false}],customer:'c1',notes:'Resume saved sale',paymentAmount:0,payKey:'stable-payment',discount:0,taxRate:0};
async function mount(){
 api.get.mockImplementation(async path=>({data:path==='/sale-drafts'?[{_id:'saved-draft',revision:2,state,updatedAt:new Date().toISOString()}]:path==='/products/pos'?{rows:[],total:0}:path==='/customers/c1'?{_id:'c1',name:'Buyer'}:[]}));
 api.put.mockImplementation(async(_,{state,revision})=>({data:{_id:'saved-draft',revision:revision+1,state}}));api.post.mockResolvedValue({data:{_id:'inv1',number:'INV1'}});
 client=new QueryClient({defaultOptions:{queries:{retry:false}}});container=document.createElement('div');document.body.append(container);root=createRoot(container);
 await act(async()=>root.render(<QueryClientProvider client={client}><MemoryRouter future={{v7_startTransition:true,v7_relativeSplatPath:true}}><POS/></MemoryRouter></QueryClientProvider>));
 await act(async()=>new Promise(r=>setTimeout(r,10)));
}
afterEach(async()=>{await act(async()=>root?.unmount());container?.remove();client?.clear();vi.clearAllMocks();});
it('restores cart/customer details and finalizes using the acknowledged draft revision',async()=>{
 await mount();expect(container.textContent).toContain('Draft Sales');expect(container.textContent).toContain('Laptop');expect(container.querySelector('textarea').value).toBe('Resume saved sale');
 await act(async()=>[...container.querySelectorAll('button')].find(b=>b.textContent.startsWith('Save Invoice ·')).click());
 expect(api.post).toHaveBeenCalledWith('/invoices',expect.objectContaining({draftId:'saved-draft',draftVersion:3,idempotencyKey:'stable-payment',items:[expect.objectContaining({product:'p1',quantity:3,unitPrice:150})]}));
});
it('does not submit an invoice if the latest draft could not be persisted',async()=>{
 await mount();await act(async()=>{const el=container.querySelector('textarea');Object.getOwnPropertyDescriptor(window.HTMLTextAreaElement.prototype,'value').set.call(el,'Changed');el.dispatchEvent(new Event('input',{bubbles:true}));});
 api.put.mockRejectedValue(new Error('Offline'));
 await act(async()=>[...container.querySelectorAll('button')].find(b=>b.textContent.startsWith('Save Invoice ·')).click());expect(api.post).not.toHaveBeenCalled();expect(container.textContent).toContain('Draft not saved');
});
