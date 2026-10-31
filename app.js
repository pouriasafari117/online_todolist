import {setBranch,VAULT_PATH,TASK_PATH,GithubError,encryptToken,decryptToken,validateToken,readFile,writeFile,validateTasks} from './core.js';
const $=id=>document.getElementById(id);
let token=null, vault=null, tasks=[], taskSha=null, filter='all', editId=null, revision=0, savedRevision=0, saving=false, conflict=false, timer=null;
const fa=n=>new Intl.NumberFormat('fa-IR').format(n);
function show(id, visible=true){$(id).classList.toggle('hidden',!visible)}
function msg(id,text){$(id).textContent=text;show(id,!!text)}
function busy(form,value){form.querySelectorAll('button[type=submit]').forEach(b=>b.disabled=value)}
function authMode(mode){show('auth-branch',mode==='branch');show('auth-loading',mode==='loading');show('auth-login',mode==='login');show('auth-setup',mode==='setup');msg('auth-message','')}
function sync(state,text){$('sync-bar').className=`sync-bar ${state}`;$('sync-text').textContent=text;show('retry',state==='error'&&!conflict);show('reload',conflict);show('export',conflict)}
function explain(error){return error?.message || 'مشکلی پیش آمد؛ دوباره تلاش کن.'}
let branchReady=false;
function selectBranch(name){setBranch(name);branchReady=true;$('branch-indicator').textContent='شاخهٔ دفتر: '+name;}
$('branch-form').onsubmit=e=>{e.preventDefault();try{selectBranch($('branch-name').value.trim());start()}catch(error){msg('auth-message',explain(error))}};
async function start(){
  if(!branchReady){
    if(typeof window.ROOZANEH_BRANCH==='string' && window.ROOZANEH_BRANCH){try{selectBranch(window.ROOZANEH_BRANCH)}catch(error){authMode('branch');msg('auth-message',explain(error));return}}
    else {authMode('branch');return}
  }
  if(!window.isSecureContext || !crypto.subtle){authMode('loading');msg('auth-message','برای رمزگذاری به HTTPS یا محیط امن مرورگر نیاز است.');return}
  try{vault=await readFile(VAULT_PATH);authMode(vault?'login':'setup')}
  catch(error){authMode('loading');msg('auth-message',explain(error)+' صفحه را دوباره بارگذاری کن.');}
}
async function enter(t){
  await validateToken(t);
  const remote=await readFile(TASK_PATH,t);
  const data=remote?validateTasks(remote.data):{schemaVersion:1,tasks:[]};
  token=t;tasks=data.tasks;taskSha=remote?.sha??null;revision=0;savedRevision=0;conflict=false;
  show('auth-view',false);show('app-view');show('settings-open');show('lock');
  $('today').textContent=new Intl.DateTimeFormat('fa-IR',{weekday:'long',day:'numeric',month:'long'}).format(new Date());
  sync('','همگام با GitHub');render();
}
$('login-form').addEventListener('submit',async e=>{e.preventDefault();const f=e.currentTarget;busy(f,true);msg('auth-message','');try{const t=await decryptToken(vault.data,$('login-password').value);await enter(t);f.reset()}catch(error){msg('auth-message',explain(error))}finally{busy(f,false)}});
$('show-recovery').onclick=()=>{authMode('setup');show('cancel-recovery');};
$('cancel-recovery').onclick=()=>{authMode('login');show('cancel-recovery',false)};
$('setup-form').addEventListener('submit',async e=>{
  e.preventDefault();const f=e.currentTarget;busy(f,true);msg('auth-message','');
  try{
    const t=$('token').value.trim(), password=$('setup-password').value;
    if(password!==$('setup-confirm').value) throw Error('گذرواژه‌ها یکسان نیستند.');
    await validateToken(t);
    const current=await readFile(VAULT_PATH,t);
    if(current && !vault) throw Error('یک قفل از قبل وجود دارد. صفحه را تازه کن تا ناخواسته بازنویسی نشود.');
    if(current && !confirm('قفل موجود جایگزین شود؟ گذرواژهٔ قبلی دیگر برای نسخهٔ جدید کار نمی‌کند. در صورت افشای توکن قبلی، آن را در GitHub لغو کن.')) return;
    if(!current && vault) throw Error('فایل قفل تغییر کرده است. صفحه را تازه کن.');
    if(current && vault && current.sha!==vault.sha) throw Error('قفل روی دستگاه دیگری تغییر کرده است. صفحه را تازه کن.');
    const encoded=await encryptToken(t,password);
    const sha=await writeFile(VAULT_PATH,encoded,current?.sha,t,current?'Replace encrypted vault':'Create encrypted vault');
    vault={data:encoded,sha};f.reset();await enter(t);
  }catch(error){msg('auth-message',explain(error))}finally{busy(f,false)}
});
function render(){
  const list=$('task-list');list.replaceChildren();
  const search=$('search').value.trim().toLocaleLowerCase('fa');
  const visible=tasks.filter(t=>(filter==='all'||(filter==='done'?t.completed:!t.completed)) && (t.title+' '+t.description).toLocaleLowerCase('fa').includes(search));
  for(const t of visible){
    const row=document.createElement('div');row.className='task'+(t.completed?' completed':'');
    const check=document.createElement('input');check.type='checkbox';check.className='task-check';check.checked=t.completed;check.setAttribute('aria-label',`تغییر وضعیت ${t.title}`);check.onchange=()=>{t.completed=check.checked;t.updatedAt=new Date().toISOString();changed()};
    const content=document.createElement('div');content.className='task-content';const title=document.createElement('div');title.className='task-title';title.textContent=t.title;content.append(title);
    const meta=document.createElement('div');meta.className='task-meta';meta.textContent=[t.description,t.dueDate?'سررسید: '+t.dueDate:'',t.priority==='high'?'اولویت زیاد':t.priority==='low'?'اولویت کم':''].filter(Boolean).join(' · ');if(meta.textContent)content.append(meta);
    const edit=document.createElement('button');edit.className='task-action';edit.type='button';edit.textContent='✎';edit.setAttribute('aria-label',`ویرایش ${t.title}`);edit.onclick=()=>openEdit(t);
    const del=document.createElement('button');del.className='task-action';del.type='button';del.textContent='×';del.setAttribute('aria-label',`حذف ${t.title}`);del.onclick=()=>{if(confirm('این کار حذف شود؟')){tasks=tasks.filter(x=>x.id!==t.id);changed()}};
    row.append(check,content,edit,del);list.append(row);
  }
  show('empty',visible.length===0);const done=tasks.filter(t=>t.completed).length, total=tasks.length, percentage=total?Math.round(done/total*100):0;
  $('total').textContent=fa(total);$('done').textContent=fa(done);$('remaining').textContent=fa(total-done);$('percent').textContent=fa(percentage)+'٪';$('progress-ring').style.setProperty('--progress',percentage+'%');$('count-label').textContent=fa(total-done)+' کار باقی‌مانده';
}
function changed(){revision++;render();if(conflict){sync('error','تعارض همگام‌سازی؛ نسخهٔ محلی را دریافت کن یا نسخهٔ GitHub را بارگذاری کن.');return}sync('pending','تغییرات در انتظار همگام‌سازی...');clearTimeout(timer);timer=setTimeout(save,800)}
async function save(){
  clearTimeout(timer);if(saving||!token||conflict||revision===savedRevision)return;
  saving=true;const currentRevision=revision;const snapshot=structuredClone({schemaVersion:1,tasks});const baseSha=taskSha;
  sync('pending','در حال ذخیره در GitHub...');
  try{taskSha=await writeFile(TASK_PATH,snapshot,baseSha,token,'Update personal tasks');savedRevision=currentRevision;sync('',revision===savedRevision?'همگام با GitHub':'تغییرات در انتظار همگام‌سازی...')}
  catch(error){
    // On any ambiguous write, read before retry; never overwrite an unexpected remote version.
    try{const remote=await readFile(TASK_PATH,token);if(remote && JSON.stringify(validateTasks(remote.data))===JSON.stringify(snapshot)){taskSha=remote.sha;savedRevision=currentRevision;sync('','همگام با GitHub')}else if((remote?.sha??null)!==baseSha){conflict=true;sync('error','نسخهٔ GitHub تغییر کرده است؛ برای جلوگیری از بازنویسی، همگام‌سازی متوقف شد.')}else{sync('error',explain(error)+' تغییرات هنوز ذخیره نشده‌اند.')}}
    catch{sync('error',explain(error)+' وضعیت ذخیره نامشخص است؛ پیش از تلاش مجدد بررسی می‌شود.')}
  }finally{saving=false;if(!conflict && revision!==savedRevision && !$('sync-bar').classList.contains('error'))timer=setTimeout(save,800)}
}
$('retry').onclick=save;
$('reload').onclick=async()=>{if(!confirm('تغییرات ذخیره‌نشدهٔ این دستگاه کنار گذاشته و نسخهٔ GitHub دریافت شود؟'))return;try{const remote=await readFile(TASK_PATH,token);tasks=remote?validateTasks(remote.data).tasks:[];taskSha=remote?.sha??null;revision=0;savedRevision=0;conflict=false;render();sync('','همگام با GitHub')}catch(e){sync('error',explain(e))}};
$('export').onclick=()=>{const blob=new Blob([JSON.stringify({schemaVersion:1,tasks},null,2)],{type:'application/json'});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download='roozaneh-local-tasks.json';a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)};
$('add-form').onsubmit=e=>{e.preventDefault();const title=$('new-title').value.trim();if(!title)return;const now=new Date().toISOString();tasks.unshift({id:crypto.randomUUID(),title,description:'',completed:false,priority:'normal',dueDate:null,createdAt:now,updatedAt:now});e.currentTarget.reset();changed()};
document.querySelectorAll('.filter').forEach(button=>button.onclick=()=>{filter=button.dataset.filter;document.querySelectorAll('.filter').forEach(b=>b.classList.toggle('active',b===button));render()});$('search').oninput=render;
function openEdit(t){editId=t.id;$('edit-title').value=t.title;$('edit-description').value=t.description;$('edit-due').value=t.dueDate||'';$('edit-priority').value=t.priority;$('edit-dialog').showModal()}
$('edit-form').onsubmit=e=>{e.preventDefault();const t=tasks.find(x=>x.id===editId),title=$('edit-title').value.trim();if(!t||!title)return;t.title=title;t.description=$('edit-description').value.trim();t.dueDate=$('edit-due').value||null;t.priority=$('edit-priority').value;t.updatedAt=new Date().toISOString();$('edit-dialog').close();changed()};
document.querySelectorAll('.close-dialog').forEach(b=>b.onclick=()=>b.closest('dialog').close());$('settings-open').onclick=()=>{$('password-form').reset();msg('settings-message','');$('settings-dialog').showModal()};
$('password-form').onsubmit=async e=>{e.preventDefault();const f=e.currentTarget;busy(f,true);msg('settings-message','');try{if($('new-password').value!==$('new-confirm').value)throw Error('گذرواژه‌های جدید یکسان نیستند.');const current=await readFile(VAULT_PATH,token);if(!current)throw Error('فایل قفل پیدا نشد.');const oldToken=await decryptToken(current.data,$('old-password').value);if(oldToken!==token)throw Error('توکن قفل تغییر کرده است؛ دوباره وارد شو.');const data=await encryptToken(token,$('new-password').value);const sha=await writeFile(VAULT_PATH,data,current.sha,token,'Change vault passphrase');vault={data,sha};f.reset();msg('settings-message','گذرواژه تغییر کرد. دستگاه‌های دیگر برای باز کردن قفل به گذرواژهٔ جدید نیاز دارند.')}catch(error){msg('settings-message',explain(error))}finally{busy(f,false)}};
$('lock').onclick=()=>{if(saving){sync('pending','صبر کن تا ذخیرهٔ جاری تمام شود.');return}if(revision!==savedRevision&&!confirm('تغییرات ذخیره‌نشده از بین می‌روند. قفل شود؟'))return;clearTimeout(timer);token=null;tasks=[];show('app-view',false);show('settings-open',false);show('lock',false);show('auth-view');start()};
window.addEventListener('beforeunload',e=>{if(revision!==savedRevision||saving){e.preventDefault();e.returnValue=''}});
start();
