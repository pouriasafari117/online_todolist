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

test('legacy tasks migrate without losing data or fabricating past history',async()=>{
 const {prepareBook}=await import('../core.js');const task={id:'1',title:'قدیمی',description:'',completed:true,priority:'normal',dueDate:null,createdAt:'old',updatedAt:'old'};
 const old={schemaVersion:1,tasks:[task],custom:'preserve'};const {book,changed}=prepareBook(old,'2026-11-01');
 assert.equal(changed,true);assert.equal(book.schemaVersion,2);assert.deepEqual(book.tasks,[task]);assert.equal(book.custom,'preserve');assert.deepEqual(book.history,[]);assert.equal(old.schemaVersion,1);
});
test('daily tasks reset for each Tehran day and preserve historical snapshots',async()=>{
 const {prepareBook}=await import('../core.js');const task={id:'ordinary',title:'کار عادی',description:'',completed:false,priority:'normal',dueDate:null,createdAt:'x',updatedAt:'x'};
 let book={schemaVersion:2,currentDay:'2026-11-01',tasks:[task],dailyTemplates:[{id:'template',title:'ورزش',startDate:'2026-11-02'}],history:[]};
 book=prepareBook(book,'2026-11-02').book;assert.equal(book.history.length,1);assert.equal(book.tasks.length,2);assert.equal(book.tasks[1].completed,false);book.tasks[1].completed=true;
 const result=prepareBook(book,'2026-11-04').book;assert.equal(result.history.length,3);assert.equal(result.history[1].tasks[1].completed,true);assert.equal(result.history[2].tasks[1].completed,false);assert.equal(result.tasks[1].completed,false);assert.notEqual(result.tasks[1].id,book.tasks[1].id);assert.equal(result.tasks[0].id,'ordinary');
 const repeat=prepareBook(result,'2026-11-04');assert.equal(repeat.changed,false);assert.deepEqual(repeat.book,result);
});
test('removed templates do not erase today or history, and clock rollback never discards data',async()=>{
 const {prepareBook}=await import('../core.js');const b={schemaVersion:2,currentDay:'2026-01-01',tasks:[],dailyTemplates:[{id:'a',title:'مطالعه',startDate:'2026-01-02'}],history:[]};
 const today=prepareBook(b,'2026-01-02').book;today.dailyTemplates=[];const next=prepareBook(today,'2026-01-03').book;
 assert.equal(next.tasks.length,0);assert.equal(next.history.at(-1).tasks[0].title,'مطالعه');assert.throws(()=>prepareBook(today,'2026-01-01'));assert.equal(today.tasks.length,1);
});
test('Tehran calendar defines rollover independently of the device timezone',async()=>{
 const {todayInTehran,nextDay}=await import('../core.js');assert.equal(todayInTehran(new Date('2026-01-01T20:29:59Z')),'2026-01-01');assert.equal(todayInTehran(new Date('2026-01-01T20:30:00Z')),'2026-01-02');assert.equal(nextDay('2024-02-28'),'2024-02-29');assert.throws(()=>nextDay('2026-02-30'));
});
