// @vitest-environment happy-dom
import React, { act } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, expect, it, vi } from 'vitest';
import toast from 'react-hot-toast';
import Products from './Products.jsx';
import { api } from '../api/client.js';
const auth = vi.hoisted(()=>({role:'admin'}));
vi.mock('../context/AuthContext.jsx',()=>({useAuth:()=>({has:(...roles)=>roles.includes(auth.role)})}));
vi.mock('../api/client.js',()=>({api:{get:vi.fn(),post:vi.fn()}}));
vi.mock('react-hot-toast',()=>({default:{success:vi.fn(),error:vi.fn()}}));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
let root,container,client;
async function mount(tracked=false){
 api.get.mockImplementation(async path=>({data:path==='/products/models'?[]:{items:[{_id:'p1',name:'Laptop',model:'T14',sku:'L1',stock:3,tracksSerials:tracked,serials:[{serial:'SN1',status:'in_stock'}]}],total:1}}));
 api.post.mockResolvedValue({data:{}});
 client=new QueryClient({defaultOptions:{queries:{retry:false}}});container=document.createElement('div');document.body.append(container);root=createRoot(container);
 await act(async()=>{root.render(<QueryClientProvider client={client}><MemoryRouter future={{v7_startTransition:true,v7_relativeSplatPath:true}}><Products/></MemoryRouter></QueryClientProvider>);});
 await act(async()=>{await new Promise(r=>setTimeout(r,30));});
}
async function click(text){await act(async()=>[...container.querySelectorAll('button')].find(b=>b.textContent===text).click());}
async function change(id,value){await act(async()=>{const el=container.querySelector(id);Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype,'value').set.call(el,value);el.dispatchEvent(new Event('input',{bubbles:true}));});}
afterEach(async()=>{if(root)await act(async()=>root.unmount());container?.remove();client?.clear();vi.clearAllMocks();auth.role='admin';});
it.each(['stock','sales'])('hides Delete Stock for %s',async role=>{auth.role=role;await mount();expect(container.textContent).not.toContain('Delete Stock');});
it('confirms product/available/removal quantity, requires reason, posts and invalidates stock',async()=>{
 await mount();await click('Delete Stock');expect(container.textContent).toContain('T14');expect(container.textContent).toContain('Available: 3');
 const confirm=()=>[...container.querySelectorAll('button')].find(b=>b.textContent==='Confirm stock removal');
 await change('#remove-stock-qty','4');await change('#remove-stock-reason','Damaged');expect(confirm().disabled).toBe(true);
 await change('#remove-stock-qty','2');await change('#remove-stock-reason','');expect(confirm().disabled).toBe(true);
 await change('#remove-stock-reason','Damaged');client.setQueryData(['products-pos','cached'],{});await click('Confirm stock removal');
 expect(api.post).toHaveBeenCalledWith('/products/p1/remove-stock',expect.objectContaining({quantity:2,reason:'Damaged',serials:[]}));expect(client.getQueryState(['products-pos','cached']).isInvalidated).toBe(true);
});
it('requires selected serials for tracked units and supports cancellation',async()=>{
 await mount(true);await click('Delete Stock');await change('#remove-stock-qty','1');await change('#remove-stock-reason','Damaged');
 expect([...container.querySelectorAll('button')].find(b=>b.textContent==='Confirm stock removal').disabled).toBe(true);
 await act(async()=>container.querySelector('fieldset input').click());await click('Cancel');expect(api.post).not.toHaveBeenCalled();
});

it('submits only selected serials and guards same-tick double clicks',async()=>{
 await mount(true);await click('Delete Stock');await change('#remove-stock-qty','1');await change('#remove-stock-reason','Damaged');
 await act(async()=>container.querySelector('fieldset input').click());
 await act(async()=>{const b=[...container.querySelectorAll('button')].find(b=>b.textContent==='Confirm stock removal');b.click();b.click();});
 expect(api.post).toHaveBeenCalledTimes(1);expect(api.post).toHaveBeenCalledWith('/products/p1/remove-stock',expect.objectContaining({quantity:1,reason:'Damaged',serials:['SN1']}));expect(toast.success).toHaveBeenCalled();
});
it('shows rejection and keeps confirmation visible without retrying automatically',async()=>{
 await mount();await click('Delete Stock');await change('#remove-stock-qty','1');await change('#remove-stock-reason','Damaged');
 api.post.mockRejectedValueOnce({response:{data:{message:'Insufficient available stock'}}});
 await click('Confirm stock removal');expect(toast.error).toHaveBeenCalledWith('Insufficient available stock');expect(api.post).toHaveBeenCalledTimes(1);expect(container.querySelector('#remove-stock-reason')).toBeTruthy();
});

it('keeps multiple selections across searches, reviews quantities/reason, and submits once',async()=>{
 await mount();
 const select=container.querySelector('[aria-label="Select Laptop L1 for removal"]');await act(async()=>select.click());
 await change('[aria-label="Search inventory"]','T14');expect(container.textContent).toContain('1 products selected');
 await click('Review selected stock');await change('[aria-label="Removal quantity L1"]','2');await change('#bulk-removal-reason','Broken display');
 await click('Review removal');expect(container.textContent).toContain('Total removal: 2 units');expect(container.textContent).toContain('Broken display');
 expect(api.post).not.toHaveBeenCalled();
 await act(async()=>{const b=[...container.querySelectorAll('button')].find(b=>b.textContent==='Confirm bulk removal');b.click();b.click();});
 expect(api.post).toHaveBeenCalledTimes(1);expect(api.post).toHaveBeenCalledWith('/products/remove-stock',expect.objectContaining({reason:'Broken display',items:[{product:'p1',quantity:2,serials:[]}],idempotencyKey:expect.any(String)}));
});
it('bulk serial quantities cannot be confirmed until exact available serials are chosen',async()=>{
 await mount(true);await act(async()=>container.querySelector('[aria-label="Select Laptop L1 for removal"]').click());await click('Review selected stock');await change('#bulk-removal-reason','Damaged');
 const review=()=>[...container.querySelectorAll('button')].find(b=>b.textContent==='Review removal');expect(review().disabled).toBe(true);
 await act(async()=>container.querySelector('[role="dialog"] fieldset input[type="checkbox"]').click());expect(review().disabled).toBe(false);
 await click('Review removal');expect(container.textContent).toContain('Selected serials: SN1');await click('Confirm bulk removal');expect(api.post.mock.calls[0][1].items[0].serials).toEqual(['SN1']);
});
