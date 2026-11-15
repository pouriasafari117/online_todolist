import test from 'node:test';
import assert from 'node:assert/strict';
import {readFileSync} from 'node:fs';
const css=readFileSync(new URL('../themes.css',import.meta.url),'utf8');
const html=readFileSync(new URL('../index.html',import.meta.url),'utf8');
const palettes=['lavender','ocean','sunset','garden','peach','sky','night','midnight','forest','ember','aurora','plum'];
function hex(color){let s=color.replace('#','');if(s.length===3)s=[...s].map(x=>x+x).join('');assert.match(s,/^[a-f\d]{6}$/i);return [0,2,4].map(i=>parseInt(s.slice(i,i+2),16))}
function luminance(color){const [r,g,b]=color.map(n=>{const x=n/255;return x<=.04045?x/12.92:((x+.055)/1.055)**2.4});return .2126*r+.7152*g+.0722*b}
function contrast(a,b){const [low,high]=[luminance(a),luminance(b)].sort((x,y)=>x-y);return (high+.05)/(low+.05)}
function blend(surface,background){const m=surface.match(/^rgb\((\d+) (\d+) (\d+) \/ ([.\d]+)\)$/);assert.ok(m,`Invalid surface: ${surface}`);const [r,g,b,a]=m.slice(1).map(Number);return [r,g,b].map((n,i)=>n*a+background[i]*(1-a))}
test('each theme has a distinct translucent panel and accessible text colours',()=>{
 const surfaces=new Set();
 for(const name of palettes){
  const block=css.match(new RegExp(`body\\[data-palette="${name}"\\]\\{([^}]+)\\}`));assert.ok(block,`Missing theme ${name}`);
  const vars=Object.fromEntries([...block[1].matchAll(/--([\w-]+):\s*([^;]+);/g)].map(m=>[m[1],m[2].trim()]));
  assert.match(html,new RegExp(`data-palette="${name}"`));surfaces.add(vars.panel);
  for(const kind of ['panel','panel-alt'])for(let i=1;i<=4;i++){
   const background=blend(vars[kind],hex(vars[`tone-${i}`]));
   for(const text of ['ink','muted']) assert.ok(contrast(hex(vars[text]),background)>=4.5,`${name} ${kind} ${text} on tone ${i}`);
  }
  assert.ok(contrast(hex(vars['button-text']),hex(vars.button))>=4.5,`${name} button contrast`);
 }
 assert.equal(surfaces.size,palettes.length);
});
test('palette controls, labels and runtime palette list stay in sync',()=>{
 const app=readFileSync(new URL('../app.js',import.meta.url),'utf8');
 const swatches=css+readFileSync(new URL('../styles.css',import.meta.url),'utf8');
 const runtime=app.match(/const paletteNames=\[([^\]]+)\]/)[1].match(/'[^']+'/g).map(s=>s.slice(1,-1));
 assert.deepEqual(runtime,palettes);
 for(const name of palettes){
  assert.match(app,new RegExp(`\\b${name}:'[^']+'`));
  assert.match(html,new RegExp(`class="palette palette-${name}" data-palette="${name}"`));
  assert.match(swatches,new RegExp(`\\.palette-${name} span\\{`));
 }
});
