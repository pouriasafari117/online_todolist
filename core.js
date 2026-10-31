export const OWNER = 'pouriasafari117';
export const REPO = 'online_todolist';
export let BRANCH = null;
export function setBranch(branch) {
  if (typeof branch !== 'string' || !branch.trim() || branch.length > 255 || /[\x00-\x20\x7f]/.test(branch)) throw new Error('نام شاخه معتبر نیست.');
  BRANCH = branch;
}
function requireBranch() { if (!BRANCH) throw new Error('شاخهٔ ذخیره‌سازی مشخص نشده است.'); }
export const VAULT_PATH = 'data/vault.json';
export const TASK_PATH = 'data/tasks.json';
const encoder = new TextEncoder();
const decoder = new TextDecoder('utf-8', {fatal:true});
const ITERATIONS = 600000;
const aad = encoder.encode('roozaneh-vault-v1|PBKDF2-SHA256|AES-256-GCM');
const to64 = bytes => btoa(Array.from(bytes, b => String.fromCharCode(b)).join(''));
const from64 = value => Uint8Array.from(atob(value), c => c.charCodeAt(0));

async function keyFor(password, salt, iterations) {
  const base = await crypto.subtle.importKey('raw', encoder.encode(password), 'PBKDF2', false, ['deriveKey']);
  return crypto.subtle.deriveKey({name:'PBKDF2', hash:'SHA-256', salt, iterations}, base, {name:'AES-GCM', length:256}, false, ['encrypt','decrypt']);
}
export async function encryptToken(token, password) {
  if (password.length < 12) throw new Error('گذرواژه باید حداقل ۱۲ نویسه باشد.');
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const iv = crypto.getRandomValues(new Uint8Array(12));
  const key = await keyFor(password, salt, ITERATIONS);
  const ciphertext = await crypto.subtle.encrypt({name:'AES-GCM', iv, additionalData:aad, tagLength:128}, key, encoder.encode(JSON.stringify({token})));
  return {version:1, kdf:'PBKDF2-SHA256', iterations:ITERATIONS, cipher:'AES-256-GCM', salt:to64(salt), iv:to64(iv), ciphertext:to64(new Uint8Array(ciphertext))};
}
export async function decryptToken(vault, password) {
  try {
    if (!vault || vault.version !== 1 || vault.kdf !== 'PBKDF2-SHA256' || vault.cipher !== 'AES-256-GCM' || !Number.isInteger(vault.iterations) || vault.iterations < 600000 || vault.iterations > 2000000 || typeof vault.salt !== 'string' || typeof vault.iv !== 'string' || typeof vault.ciphertext !== 'string' || vault.ciphertext.length > 20000) throw Error();
    const salt=from64(vault.salt), iv=from64(vault.iv), data=from64(vault.ciphertext);
    if (salt.length !== 16 || iv.length !== 12 || data.length < 17) throw Error();
    const key=await keyFor(password,salt,vault.iterations);
    const plain=await crypto.subtle.decrypt({name:'AES-GCM',iv,additionalData:aad,tagLength:128}, key, data);
    const result=JSON.parse(decoder.decode(plain));
    if (typeof result.token !== 'string' || !result.token.startsWith('github_pat_') || result.token.length > 1024) throw Error();
    return result.token;
  } catch { throw new Error('گذرواژه نادرست است یا فایل قفل آسیب دیده است.'); }
}
export class GithubError extends Error { constructor(status, message) { super(message); this.status=status; } }
const url = path => `https://api.github.com/repos/${OWNER}/${REPO}/${path}`;
async function request(path, {token, method='GET', body}={}) {
  const headers={'Accept':'application/vnd.github+json','X-GitHub-Api-Version':'2022-11-28'};
  if(token) headers.Authorization=`Bearer ${token}`;
  if(body) headers['Content-Type']='application/json';
  let response;
  try { response=await fetch(path,{method,headers,body:body?JSON.stringify(body):undefined,cache:'no-store',redirect:'error'}); }
  catch { throw new GithubError(0,'ارتباط با GitHub برقرار نشد. اتصال اینترنت را بررسی کن.'); }
  if(!response.ok) {
    const messages={401:'توکن معتبر نیست یا منقضی شده است.',403:'دسترسی کافی نیست یا محدودیت درخواست GitHub فعال شده است.',404:'مخزن، شاخه یا فایل پیدا نشد.',409:'نسخهٔ فایل در GitHub تغییر کرده است.',422:'GitHub تغییر را نپذیرفت؛ ممکن است فایل هم‌زمان تغییر کرده باشد.'};
    throw new GithubError(response.status,messages[response.status] || `خطای GitHub (${response.status}).`);
  }
  return response.json();
}
export async function validateToken(token) {
  if (!token.startsWith('github_pat_')) throw new Error('فقط توکن fine-grained پذیرفته می‌شود.');
  const user=await request('https://api.github.com/user',{token});
  if(user.login.toLowerCase()!==OWNER.toLowerCase()) throw new Error('این توکن متعلق به حساب مالک این دفتر نیست.');
  const repo=await request(url(''),{token});
  if (!repo.permissions?.push) throw new Error('توکن دسترسی نوشتن به این مخزن ندارد. انتخاب مخزن و مجوز Contents را بررسی کن.');
  return user;
}
export async function readFile(path, token) {
  requireBranch();
  try {
    const data=await request(url(`contents/${path}?ref=${encodeURIComponent(BRANCH)}`),{token});
    if (data.type !== 'file' || data.encoding !== 'base64' || typeof data.content !== 'string' || !data.sha) throw new Error('قالب فایل GitHub پشتیبانی نمی‌شود.');
    const bytes=from64(data.content.replace(/\s/g,''));
    return {data:JSON.parse(decoder.decode(bytes)),sha:data.sha};
  } catch (error) {
    if (error instanceof GithubError && error.status===404) {
      // A missing file is only safe to treat as absent after verifying the branch is readable.
      await request(url(`branches/${encodeURIComponent(BRANCH)}`),{token});
      return null;
    }
    if (error instanceof SyntaxError || error instanceof TypeError) throw new Error('فایل دفتر خراب است؛ برای محافظت از داده‌ها بازنویسی نمی‌شود.');
    throw error;
  }
}
export async function writeFile(path, value, sha, token, message) {
  requireBranch();
  const bytes=encoder.encode(JSON.stringify(value,null,2)+'\n');
  if(bytes.length>750000) throw new Error('حجم دفتر بیش از حد مجاز برنامه است.');
  const body={message,content:to64(bytes),branch:BRANCH};
  if(sha) body.sha=sha;
  const result=await request(url(`contents/${path}`),{token,method:'PUT',body});
  if(!result.content?.sha) throw new Error('پاسخ ذخیره نامعتبر بود. لطفاً وضعیت فایل را بررسی کن.');
  return result.content.sha;
}
export function validateTasks(data) {
  if (!data || data.schemaVersion !== 1 || !Array.isArray(data.tasks) || data.tasks.length>5000) throw new Error('نسخه یا ساختار دفتر قابل خواندن نیست؛ فایل بازنویسی نمی‌شود.');
  const ids=new Set();
  for(const t of data.tasks) {
    if(!t || typeof t.id!=='string' || !t.id || ids.has(t.id) || typeof t.title!=='string' || !t.title.trim() || t.title.length>200 || typeof t.description!=='string' || t.description.length>2000 || typeof t.completed!=='boolean' || !['low','normal','high'].includes(t.priority) || !(t.dueDate===null || (typeof t.dueDate==='string' && /^\d{4}-\d{2}-\d{2}$/.test(t.dueDate))) || typeof t.createdAt!=='string' || typeof t.updatedAt!=='string') throw new Error('دادهٔ یکی از کارها نامعتبر است؛ فایل بازنویسی نمی‌شود.');
    ids.add(t.id);
  }
  return data;
}
