import test from 'node:test';
import assert from 'node:assert/strict';
import {BRANCH,encryptToken,decryptToken,validateTasks,readFile,writeFile,validateToken,GithubError} from '../core.js';
const token='github_pat_example';
const password='long unique password';
test('vault roundtrip, incorrect password, tamper and fresh random values',async()=>{
 const a=await encryptToken(token,password), b=await encryptToken(token,password);
 assert.equal(await decryptToken(a,password),token);assert.notEqual(a.salt,b.salt);assert.notEqual(a.iv,b.iv);
 await assert.rejects(decryptToken(a,'wrong password'));
 const bytes=Uint8Array.from(atob(a.ciphertext),x=>x.charCodeAt(0));bytes[0]^=1;
 await assert.rejects(decryptToken({...a,ciphertext:btoa(String.fromCharCode(...bytes))},password));
 await assert.rejects(decryptToken({...a,iterations:999999999},password));
 await assert.rejects(encryptToken(token,'short'));
});
test('validates schema and rejects corrupt or duplicate tasks',()=>{
 const task={id:'1',title:'نان',description:'',completed:false,priority:'normal',dueDate:null,createdAt:'x',updatedAt:'x'};
 assert.equal(validateTasks({schemaVersion:1,tasks:[task]}).tasks.length,1);
 assert.throws(()=>validateTasks({schemaVersion:2,tasks:[]}));assert.throws(()=>validateTasks({schemaVersion:1,tasks:[task,task]}));
 assert.throws(()=>validateTasks({schemaVersion:1,tasks:[{...task,completed:'false'}]}));
});
test('missing file is accepted only after branch verification',async()=>{
 const old=globalThis.fetch;let calls=0;
 try {globalThis.fetch=async()=>{calls++;return calls===1?new Response('{}',{status:404}):Response.json({name:BRANCH})};assert.equal(await readFile('data/tasks.json'),null);assert.equal(calls,2);
 globalThis.fetch=async()=>new Response('{}',{status:404});await assert.rejects(readFile('data/tasks.json'),GithubError);
 }finally{globalThis.fetch=old}
});
test('write sends SHA and selected branch and unicode contents',async()=>{
 const old=globalThis.fetch;try {globalThis.fetch=async(url,options)=>{const body=JSON.parse(options.body);assert.equal(body.sha,'old');assert.equal(body.branch,BRANCH);assert.equal(JSON.parse(new TextDecoder().decode(Uint8Array.from(atob(body.content),c=>c.charCodeAt(0)))).title,'نان');assert.equal(options.headers.Authorization,`Bearer ${token}`);return Response.json({content:{sha:'new'}})};assert.equal(await writeFile('data/tasks.json',{title:'نان'},'old',token,'save'),'new') }finally{globalThis.fetch=old}
});
test('validates owner and write access, rejects classic tokens',async()=>{
 const old=globalThis.fetch;let calls=0;try{globalThis.fetch=async()=>Response.json(++calls===1?{login:'pouriasafari117'}:{permissions:{push:true}});await validateToken(token);await assert.rejects(validateToken('ghp_example'));}finally{globalThis.fetch=old}
});

test('repository validation uses GitHub repository endpoint without trailing slash',async()=>{
 const old=globalThis.fetch; const seen=[];
 try {globalThis.fetch=async(url)=>{seen.push(url);return Response.json(seen.length===1?{login:'pouriasafari117'}:{permissions:{push:true}})};
 await validateToken(token);assert.equal(seen[1],'https://api.github.com/repos/pouriasafari117/online_todolist');
 } finally {globalThis.fetch=old}
});
test('network errors do not reveal request credentials',async()=>{
 const old=globalThis.fetch;try{globalThis.fetch=async()=>{throw new Error(`failed ${token}`)};await assert.rejects(validateToken(token),error=>error instanceof GithubError && error.status===0 && !error.message.includes(token));}finally{globalThis.fetch=old}
});

test('reads and writes target main regardless of deployment branch',async()=>{
 const old=globalThis.fetch;try {assert.equal(BRANCH,'main');globalThis.fetch=async(url,options)=>{if(options.method==='PUT'){assert.equal(JSON.parse(options.body).branch,'main');return Response.json({content:{sha:'ok'}})}assert.match(url,/ref=main/);return Response.json({type:'file',encoding:'base64',sha:'v',content:btoa('{"schemaVersion":1,"tasks":[]}')})};await readFile('data/tasks.json');await writeFile('data/tasks.json',{},null,token,'save');}finally{globalThis.fetch=old}
});
