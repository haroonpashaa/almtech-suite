// @vitest-environment happy-dom
import React, { act, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { afterEach, expect, it, vi } from 'vitest';
import { useSaleDraft } from './useSaleDraft.jsx';
import { api } from '../api/client.js';
vi.mock('../api/client.js',()=>({api:{get:vi.fn(),put:vi.fn(),delete:vi.fn()}}));
vi.mock('react-hot-toast',()=>({default:{error:vi.fn()}}));
globalThis.IS_REACT_ACT_ENVIRONMENT=true;
const original={cart:[{product:'p1',name:'Laptop',model:'T14',stock:20,quantity:3,unitPrice:150,lineTotal:450,serials:['A','B','C']}],customer:'c1',notes:'Saved notes',paymentAmount:50,payKey:'payment-1'};
let root,container,controller,setState,rows;
function Harness(){const[state,update]=useState({cart:[],customer:'',notes:''});setState=update;controller=useSaleDraft(state,s=>update(s||{cart:[],customer:'',notes:''}));return <p>{controller.status}:{state.notes}</p>;}
async function mount(){container=document.createElement('div');document.body.append(container);root=createRoot(container);await act(async()=>root.render(<Harness/>));}
async function unmount(){if(root){await act(async()=>root.unmount());root=null;}container?.remove();}
afterEach(async()=>{controller?.complete();await unmount();vi.useRealTimers();vi.restoreAllMocks();vi.clearAllMocks();});
function storage(initial=[]){rows=initial;api.get.mockImplementation(async()=>({data:rows}));api.put.mockImplementation(async(url,{state,revision})=>{const data={_id:url.split('/').pop(),state,revision:revision+1,updatedAt:new Date().toISOString()};rows=[data];return{data};});api.delete.mockImplementation(async()=>{rows=[];return{data:{ok:true}};});}
it('autosaves to the backend and restores all fields after an unmount/reload',async()=>{
 storage();await mount();await act(async()=>setState(original));await act(async()=>new Promise(r=>setTimeout(r,450)));
 expect(api.put).toHaveBeenCalled();expect(rows[0].state).toEqual(original);expect(container.textContent).toContain('Draft saved');
 await unmount();await mount();expect(container.textContent).toContain('Saved notes');expect(api.get).toHaveBeenCalledTimes(2);
});
it('flushes immediately on navigation and before logout rather than waiting for the debounce',async()=>{
 storage();await mount();await act(async()=>setState(original));
 const detail={tasks:[]};await act(async()=>{window.dispatchEvent(new CustomEvent('erp:before-logout',{detail}));await Promise.all(detail.tasks);});
 expect(rows[0].state).toEqual(original);expect(detail.tasks).toHaveLength(1);
 await act(async()=>setState({...original,notes:'Navigation edit'}));await unmount();expect(rows[0].state.notes).toBe('Navigation edit');
});
it('serializes autosaves with current revisions and retains the draft on a failed save',async()=>{
 storage();await mount();await act(async()=>setState(original));
 await act(async()=>Promise.all([controller.flush(),controller.flush()]));expect(api.put).toHaveBeenCalledTimes(1);
 await act(async()=>setState({...original,notes:'Changed'}));await act(async()=>controller.flush());expect(api.put.mock.calls[1][1].revision).toBe(1);
 api.put.mockRejectedValueOnce(new Error('Offline'));await act(async()=>setState({...original,notes:'Unsaved change'}));await act(async()=>{await expect(controller.flush()).rejects.toThrow('Offline');});expect(container.textContent).toContain('Draft not saved');expect(rows[0].state.notes).toBe('Changed');
});
it('discards an owned draft through the backend and prevents post-finalization autosaves',async()=>{
 storage([{_id:'existing',revision:2,state:original}]);vi.spyOn(window,'confirm').mockReturnValue(true);await mount();await act(async()=>controller.discard());expect(api.delete).toHaveBeenCalledWith('/sale-drafts/existing',{data:{revision:2}});expect(rows).toEqual([]);
 await act(async()=>setState(original));controller.complete();await unmount();expect(api.put).not.toHaveBeenCalled();
});

it('can recover the server revision after a conflict only with explicit confirmation',async()=>{
 storage([{_id:'existing',revision:1,state:original}]);vi.spyOn(window,'confirm').mockReturnValue(true);await mount();
 api.get.mockResolvedValueOnce({data:{_id:'existing',revision:3,status:'active',state:{...original,notes:'Other window edit'}}});
 await act(async()=>controller.reload());expect(container.textContent).toContain('Other window edit');
 await act(async()=>setState({...original,notes:'New edit'}));await act(async()=>controller.flush());expect(api.put.mock.calls[0][1].revision).toBe(3);
});

it('loads additional drafts without replacing current unsaved work',async()=>{
 storage(Array.from({length:50},(_,i)=>({_id:`draft-${i}`,revision:1,state:original})));await mount();expect(controller.hasMore).toBe(true);
 api.get.mockResolvedValueOnce({data:[{_id:'older-draft',revision:1,state:original}]});await act(async()=>controller.loadMore());
 expect(api.get).toHaveBeenLastCalledWith('/sale-drafts',{params:{page:2,limit:50}});expect(controller.drafts).toHaveLength(51);expect(controller.hasMore).toBe(false);expect(container.textContent).toContain('Saved notes');
});

it('persists clearing an existing draft instead of resurrecting its old cart on reload',async()=>{
 storage([{_id:'existing',revision:2,state:original}]);await mount();
 await act(async()=>setState({cart:[],customer:'',notes:''}));await act(async()=>controller.flush());
 expect(rows[0].state.cart).toEqual([]);expect(rows[0].revision).toBe(3);
 await unmount();await mount();expect(container.textContent).not.toContain('Saved notes');
});

function deferred() {
 let resolve, reject;
 const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
 return { promise, resolve, reject };
}
function savedDraft(id, revision, state = original) { return { _id: id, revision, state, status: 'active' }; }
it('reopens the active draft from a fresh persisted read after a delayed save', async () => {
 storage([savedDraft('existing', 2)]); await mount();
 const pending = deferred(); api.put.mockReturnValueOnce(pending.promise);
 await act(async () => setState({ ...original, notes: 'Latest edit' }));
 let switching;
 await act(async () => { switching = controller.switchDraft('existing'); await Promise.resolve(); });
 expect(api.get).toHaveBeenCalledTimes(1);
 const persisted = savedDraft('existing', 3, { ...original, notes: 'Latest edit' });
 api.get.mockResolvedValueOnce({ data: persisted });
 await act(async () => { pending.resolve({ data: persisted }); await switching; });
 expect(api.get).toHaveBeenLastCalledWith('/sale-drafts/existing');
 expect(container.textContent).toContain('Latest edit');
 await act(async () => setState({ ...original, notes: 'Following edit' }));
 await act(async () => controller.flush());
 expect(api.put.mock.calls[1][1].revision).toBe(3);
});
it('does not switch or discard local edits if the pending save fails', async () => {
 storage([savedDraft('existing', 2), savedDraft('other', 1, { ...original, notes: 'Other draft' })]); await mount();
 const pending = deferred(); api.put.mockReturnValueOnce(pending.promise);
 await act(async () => setState({ ...original, notes: 'Keep these unsaved edits' }));
 let switching;
 await act(async () => { switching = controller.switchDraft('other'); await Promise.resolve(); });
 await act(async () => { pending.reject(new Error('Offline')); await switching; });
 expect(api.get).toHaveBeenCalledTimes(1);
 expect(container.textContent).toContain('Keep these unsaved edits');
 expect(controller.status).toContain('Draft not saved');
});
it('marks edits unsaved immediately, and an older save response cannot acknowledge newer edits', async () => {
 storage([savedDraft('existing', 2)]); await mount();
 const older = deferred(), newer = deferred();
 api.put.mockReturnValueOnce(older.promise).mockReturnValueOnce(newer.promise);
 await act(async () => setState({ ...original, notes: 'First edit' }));
 expect(controller.status).toBe('Unsaved changes');
 let first, second;
 await act(async () => { first = controller.flush(); await Promise.resolve(); });
 expect(controller.status).toBe('Saving draft…');
 await act(async () => setState({ ...original, notes: 'Second edit' }));
 expect(controller.status).toBe('Unsaved changes');
 await act(async () => { second = controller.flush(); await Promise.resolve(); });
 expect(api.put).toHaveBeenCalledTimes(1); // newer saves must not overtake older ones
 await act(async () => { older.resolve({ data: savedDraft('existing', 3, { ...original, notes: 'First edit' }) }); await first; });
 expect(controller.status).toBe('Saving draft…');
 expect(api.put).toHaveBeenCalledTimes(2);
 expect(api.put.mock.calls[1][1].revision).toBe(3);
 await act(async () => { newer.resolve({ data: savedDraft('existing', 4, { ...original, notes: 'Second edit' }) }); await second; });
 expect(controller.status).toBe('Draft saved');
});
it('rejects rapid same-tick switching while a fresh read is outstanding', async () => {
 storage([savedDraft('existing', 2), savedDraft('other', 1, { ...original, notes: 'Other draft' }), savedDraft('third', 1, { ...original, notes: 'Third draft' })]); await mount();
 const read = deferred(); api.get.mockReturnValueOnce(read.promise);
 let first, ignored;
 await act(async () => { first = controller.switchDraft('other'); ignored = controller.switchDraft('third'); await Promise.resolve(); });
 expect(api.get).toHaveBeenCalledTimes(2);
 await act(async () => { read.resolve({ data: savedDraft('other', 5, { ...original, notes: 'Fresh other draft' }) }); await Promise.all([first, ignored]); });
 expect(container.textContent).toContain('Fresh other draft');
});

it('switching drains an edit made while the preceding save is still in flight', async () => {
 storage([savedDraft('existing', 2)]); await mount();
 const first = deferred(), second = deferred();
 api.put.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
 await act(async () => setState({ ...original, notes: 'First edit' }));
 let switching;
 await act(async () => { switching = controller.switchDraft('existing'); await Promise.resolve(); });
 await act(async () => setState({ ...original, notes: 'Newest edit during save' }));
 await act(async () => { first.resolve({ data: savedDraft('existing', 3, { ...original, notes: 'First edit' }) }); await Promise.resolve(); });
 expect(api.get).toHaveBeenCalledTimes(1); expect(api.put).toHaveBeenCalledTimes(2);
 expect(api.put.mock.calls[1][1]).toMatchObject({ revision: 3, state: { notes: 'Newest edit during save' } });
 const newest = savedDraft('existing', 4, { ...original, notes: 'Newest edit during save' });
 api.get.mockResolvedValueOnce({ data: newest });
 await act(async () => { second.resolve({ data: newest }); await switching; });
 expect(container.textContent).toContain('Newest edit during save');
});
it('a delayed draft read cannot overwrite an edit made while the read was outstanding', async () => {
 storage([savedDraft('existing', 2), savedDraft('other', 1)]); await mount();
 const read = deferred(); api.get.mockReturnValueOnce(read.promise);
 let switching;
 await act(async () => { switching = controller.switchDraft('other'); await Promise.resolve(); });
 await act(async () => setState({ ...original, notes: 'Keep the newer local work' }));
 await act(async () => { read.resolve({ data: savedDraft('other', 5) }); await switching; });
 expect(container.textContent).toContain('Keep the newer local work');
 expect(controller.status).toBe('Unsaved changes');
});
it('shows a failed latest save until retry, and marks a further edit unsaved immediately', async () => {
 storage([savedDraft('existing', 2)]); await mount();
 const pending = deferred(); api.put.mockReturnValueOnce(pending.promise);
 await act(async () => setState({ ...original, notes: 'Fail this edit' }));
 let save;
 await act(async () => { save = controller.flush().catch(() => {}); await Promise.resolve(); });
 await act(async () => { pending.reject(new Error('Offline')); await save; });
 expect(controller.status).toContain('Draft not saved: Offline');
 await act(async () => setState({ ...original, notes: 'Newer retry edit' }));
 expect(controller.status).toBe('Unsaved changes');
 await act(async () => controller.flush()); expect(controller.status).toBe('Draft saved');
});
it('prevents out-of-order acknowledgements by serializing writes even when a later response is ready first', async () => {
 storage([savedDraft('existing', 2)]); await mount();
 const first = deferred(), second = deferred(); api.put.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise);
 await act(async () => setState({ ...original, notes: 'First' }));
 let a, b;
 await act(async () => { a = controller.flush(); await Promise.resolve(); });
 await act(async () => setState({ ...original, notes: 'Latest' }));
 await act(async () => { b = controller.flush(); second.resolve({ data: savedDraft('existing', 4, { ...original, notes: 'Latest' }) }); await Promise.resolve(); });
 expect(api.put).toHaveBeenCalledTimes(1); expect(controller.status).toBe('Unsaved changes');
 await act(async () => { first.resolve({ data: savedDraft('existing', 3, { ...original, notes: 'First' }) }); await Promise.all([a, b]); });
 expect(api.put.mock.calls[1][1].revision).toBe(3); expect(controller.status).toBe('Draft saved'); expect(container.textContent).toContain('Latest');
});

it('reload cancels the debounce, saves revision 3 first, and rejects a delayed revision 2 response', async () => {
 storage([savedDraft('existing', 2)]); vi.spyOn(window, 'confirm').mockReturnValue(true); await mount();
 vi.useFakeTimers();
 const put = deferred(), read = deferred();
 api.put.mockReturnValueOnce(put.promise); api.get.mockReturnValueOnce(read.promise);
 await act(async () => setState({ ...original, notes: 'Latest edit before reload' }));
 let reloading;
 await act(async () => { reloading = controller.reload(); await Promise.resolve(); });
 expect(api.put).toHaveBeenCalledTimes(1);
 expect(api.get).toHaveBeenCalledTimes(1); // no GET until the save succeeds
 await act(async () => vi.advanceTimersByTimeAsync(450));
 expect(api.put).toHaveBeenCalledTimes(1);
 const persisted = savedDraft('existing', 3, { ...original, notes: 'Latest edit before reload' });
 await act(async () => { put.resolve({ data: persisted }); await Promise.resolve(); });
 expect(api.get).toHaveBeenCalledTimes(2);
 await act(async () => vi.advanceTimersByTimeAsync(450));
 expect(api.put).toHaveBeenCalledTimes(1); // no competing autosave while the read is outstanding
 await act(async () => { read.resolve({ data: savedDraft('existing', 2) }); await reloading; });
 expect(container.textContent).toContain('Latest edit before reload');
 expect(controller.status).toContain('Reload failed');
 await act(async () => setState({ ...original, notes: 'Follow-up edit' }));
 await act(async () => controller.flush());
 expect(api.put.mock.calls[1][1].revision).toBe(3);
 expect(controller.status).toBe('Draft saved');
 vi.useRealTimers();
});
it('reload waits for in-flight and queued saves before reading the confirmed latest revision', async () => {
 storage([savedDraft('existing', 2)]); vi.spyOn(window, 'confirm').mockReturnValue(true); await mount();
 const first = deferred(), second = deferred(), read = deferred();
 api.put.mockReturnValueOnce(first.promise).mockReturnValueOnce(second.promise); api.get.mockReturnValueOnce(read.promise);
 await act(async () => setState({ ...original, notes: 'First edit' }));
 let a, b, reloading;
 await act(async () => { a = controller.flush(); await Promise.resolve(); });
 await act(async () => setState({ ...original, notes: 'Latest queued edit' }));
 await act(async () => { b = controller.flush(); reloading = controller.reload(); await Promise.resolve(); });
 expect(api.get).toHaveBeenCalledTimes(1);
 await act(async () => { first.resolve({ data: savedDraft('existing', 3, { ...original, notes: 'First edit' }) }); await a; });
 expect(api.get).toHaveBeenCalledTimes(1);
 const persisted = savedDraft('existing', 4, { ...original, notes: 'Latest queued edit' });
 await act(async () => { second.resolve({ data: persisted }); await b; });
 expect(api.get).toHaveBeenCalledTimes(2);
 await act(async () => { read.resolve({ data: persisted }); await reloading; });
 expect(container.textContent).toContain('Latest queued edit');
 await act(async () => setState({ ...original, notes: 'Next edit' })); await act(async () => controller.flush());
 expect(api.put.mock.calls[2][1].revision).toBe(4);
});
it('a failed save cancels reload and preserves the unsaved edit instead of fetching stale content', async () => {
 storage([savedDraft('existing', 2)]); vi.spyOn(window, 'confirm').mockReturnValue(true); await mount();
 const put = deferred(); api.put.mockReturnValueOnce(put.promise);
 await act(async () => setState({ ...original, notes: 'Keep my unsaved edit' }));
 let reloading;
 await act(async () => { reloading = controller.reload(); await Promise.resolve(); });
 await act(async () => { put.reject(new Error('Offline')); await reloading; });
 expect(api.get).toHaveBeenCalledTimes(1); expect(container.textContent).toContain('Keep my unsaved edit');
 expect(controller.status).toContain('Draft not saved');
});
it('a failed reload read preserves the latest saved content and revision', async () => {
 storage([savedDraft('existing', 2)]); vi.spyOn(window, 'confirm').mockReturnValue(true); await mount();
 await act(async () => setState({ ...original, notes: 'Latest content' }));
 api.get.mockRejectedValueOnce(new Error('Read unavailable'));
 await act(async () => controller.reload());
 expect(container.textContent).toContain('Latest content'); expect(controller.status).toContain('Reload failed');
 await act(async () => setState({ ...original, notes: 'Following content' })); await act(async () => controller.flush());
 expect(api.put.mock.calls[1][1].revision).toBe(3);
});
it('reload cannot replace newer local edits or allow a manual save to race its delayed GET', async () => {
 storage([savedDraft('existing', 2)]); vi.spyOn(window, 'confirm').mockReturnValue(true); await mount();
 vi.useFakeTimers();
 const read = deferred(); api.get.mockReturnValueOnce(read.promise);
 let reloading, waitingSave;
 await act(async () => { reloading = controller.reload(); await Promise.resolve(); });
 await act(async () => setState({ ...original, notes: 'New edit during the read' }));
 await act(async () => { waitingSave = controller.flush(); await vi.advanceTimersByTimeAsync(450); });
 expect(api.put).not.toHaveBeenCalled();
 await act(async () => { read.resolve({ data: savedDraft('existing', 2) }); await reloading; await waitingSave; });
 expect(container.textContent).toContain('New edit during the read');
 expect(api.put.mock.calls[0][1]).toMatchObject({ revision: 2, state: { notes: 'New edit during the read' } });
 vi.useRealTimers();
});
