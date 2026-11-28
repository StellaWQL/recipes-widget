import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const code = await readFile(new URL('../../reader-room/library-sync.js', import.meta.url),'utf8');
const {createRepositoryLibrary} = await import(`data:text/javascript;base64,${Buffer.from(code).toString('base64')}`);
const id='a'.repeat(64), sha='b'.repeat(40);
const book={id,sha,filename:'书--123.epub',title:'书',contentUrl:'https://evil.invalid/steal'};
const rows=[];
const test=async(name,fn)=>{await fn(); rows.push(name);};
function client(responder) {
 const memory=new Map(); const storage={getItem:k=>memory.get(k),setItem:(k,v)=>memory.set(k,v),removeItem:k=>memory.delete(k)};
 const calls=[];
 return {api:createRepositoryLibrary({endpoint:'https://books.example/api/library/',storage,fetch:async(url,options)=>{calls.push([url,options]);return responder(url,options);}}),calls,memory};
}
const json=(data,status=200)=>new Response(JSON.stringify(data),{status,headers:{'content-type':'application/json'}});
const enabled={enabled:true,configured:true,maxBytes:26214400};
await test('status probing does not transmit bearer',async()=>{
 const {api,calls}=client(u=>json(u.endsWith('status')?enabled:{books:[book]}));
 await api.connect('private-upload-key'); await api.probe();
 assert.equal(calls[1][1].headers.Authorization,undefined);
});
await test('source URL from server cannot redirect bearer',async()=>{
 const {api,calls}=client(u=>u.endsWith('/content')?new Response(new Blob(['PK'])):json({books:[book]}));
 const items=await api.connect('private-upload-key');
 assert.equal(items[0].contentUrl,`https://books.example/api/library/books/${id}/content`);
 await api.content(id);
 assert.ok(calls.every(([u])=>new URL(u).origin==='https://books.example'));
 assert.ok(calls.every(([,o])=>o.redirect==='error'));
});
await test('401 removes stored upload key',async()=>{
 const {api,memory}=client(()=>json({error:{code:'AUTH_REQUIRED',message:'wrong key'}},401));
 await assert.rejects(()=>api.connect('bad-key'),e=>e.code==='AUTH_REQUIRED');
 assert.equal(api.authenticated,false); assert.equal(memory.size,0);
});
await test('ordinary static HTML is not mistaken for configured service',async()=>{
 const {api}=client(()=>new Response('<!doctype html>static site',{headers:{'content-type':'text/html'}}));
 await api.probe(); assert.equal(api.configured,false);
});
await test('server success without Git commit acknowledgement stays pending',async()=>{
 const {api}=client((u,o)=>json(o.method==='POST'?{synced:true,book,commit:null}:{books:[]}));
 await api.connect('key');
 await assert.rejects(()=>api.upload(new Blob(['PK']),'书.epub'),e=>e.code==='UNCONFIRMED_WRITE');
});
await test('verified duplicate is accepted without creating a fake commit',async()=>{
 const {api}=client((u,o)=>json(o.method==='POST'?{synced:true,book,alreadyPresent:true,commit:null}:{books:[]}));
 await api.connect('key'); const receipt=await api.upload(new Blob(['PK']),'书.epub');
 assert.equal(receipt.alreadyPresent,true); assert.equal(receipt.commitSha,null);
});
await test('real commit acknowledgement accepted and filename URLencoded',async()=>{
 const {api,calls}=client((u,o)=>json(o.method==='POST'?{synced:true,book,alreadyPresent:false,commit:{sha:'c'.repeat(40)}}:{books:[]}));
 await api.connect('key'); const receipt=await api.upload(new Blob(['PK']),'书 名.epub');
 assert.equal(receipt.commitSha,'c'.repeat(40));
 assert.equal(calls[1][1].headers['X-Book-Filename'],encodeURIComponent('书 名.epub'));
 assert.equal(calls[1][1].headers['Content-Type'],'application/epub+zip');
});
await test('oversized file rejected before transport',async()=>{
 const {api,calls}=client(u=>json(u.endsWith('status')?{...enabled,maxBytes:2}:{books:[]}));
 await api.probe(); await api.connect('key');
 await assert.rejects(()=>api.upload(new Blob(['123']),'book.epub'),e=>e.code==='TOO_LARGE');
 assert.equal(calls.length,2);
});
await test('network failure is retryable and never a receipt',async()=>{
 const {api}=client((u,o)=>{if(o.method==='POST')throw new TypeError('offline');return json({books:[]});});
 await api.connect('key');
 await assert.rejects(()=>api.upload(new Blob(['PK']),'book.epub'),e=>e.code==='NETWORK_ERROR'&&e.retryable);
});
await test('path-like repository ID rejected before sending bearer',async()=>{
 const {api,calls}=client(()=>json({books:[]}));
 await api.connect('key');
 await assert.rejects(()=>api.content('../status'),e=>e.code==='INVALID_BOOK'); assert.equal(calls.length,1);
});
await test('remote HTTP address cannot receive credentials',async()=>{
 assert.throws(()=>createRepositoryLibrary({endpoint:'http://remote.example/api/library/',storage:null}),e=>e.code==='INVALID_ENDPOINT');
});
await test('sessionStorage getter can be blocked without breaking the reader',async()=>{
 const previous=Object.getOwnPropertyDescriptor(globalThis,'sessionStorage');
 Object.defineProperty(globalThis,'sessionStorage',{configurable:true,get(){throw new DOMException('blocked','SecurityError');}});
 try {
  const api=createRepositoryLibrary({endpoint:'https://books.example/api/library/',fetch:async()=>json({books:[]})});
  await api.connect('key'); assert.equal(api.authenticated,true);
 } finally { previous?Object.defineProperty(globalThis,'sessionStorage',previous):delete globalThis.sessionStorage; }
});
await test('failed first connection does not claim authenticated or persist an unverified key',async()=>{
 const {api,memory}=client(()=>{throw new TypeError('offline');});
 await assert.rejects(()=>api.connect('key'),e=>e.code==='NETWORK_ERROR');
 assert.equal(api.authenticated,false); assert.equal(api.hasCredentials,false); assert.equal(memory.size,0);
});
await test('remembered session key is not trusted until catalogue authentication succeeds',async()=>{
 const stored=new Map([['raven.library.auth:https://books.example/api/library/','key']]);
 const storage={getItem:k=>stored.get(k),setItem:(k,v)=>stored.set(k,v),removeItem:k=>stored.delete(k)};
 const api=createRepositoryLibrary({endpoint:'https://books.example/api/library/',storage,fetch:async()=>json({books:[]})});
 assert.equal(api.hasCredentials,true); assert.equal(api.authenticated,false);
 await api.listBooks(); assert.equal(api.authenticated,true);
});
await test('a pasted GitHub token is rejected without network or storage writes',async()=>{
 const {api,calls,memory}=client(()=>json({books:[]}));
 await assert.rejects(()=>api.connect('github_pat_example'),e=>e.code==='WRONG_CREDENTIAL_TYPE');
 assert.equal(calls.length,0); assert.equal(memory.size,0);
});
console.log(JSON.stringify({passed:rows.length,checks:rows},null,2));
