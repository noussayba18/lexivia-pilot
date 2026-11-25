import test from 'node:test';
import assert from 'node:assert/strict';
import {loadOrganizerDashboard} from '../src/pages/organizerDashboardData.js';
import fs from 'node:fs/promises';
import postcss from 'postcss';
const response=(status,body)=>({status,ok:status>=200&&status<300,json:async()=>body});
const load=(monitoring,competition=response(200,{id:'sample'}))=>loadOrganizerDashboard(async url=>url.endsWith('/monitoring')?monitoring:competition,'/api','sample');
test('a valid organizer can open the management dashboard',async()=>{
 assert.equal((await load(response(200,{is_organizer:true,participants_count:0}))).competition.id,'sample');
});
test('server failures and incomplete responses cannot masquerade as access denial',async()=>{
 for(const result of [response(500,{detail:'failure'}),response(200,{detail:'unexpected'}),response(200,null),{status:200,ok:true,json:async()=>{throw Error('invalid JSON');}}]) {
  await assert.rejects(load(result),error=>error.kind==='error');
 }
});
test('session, missing competition and access denial retain distinct outcomes',async()=>{
 for(const [status,kind]of [[401,'session'],[403,'access'],[404,'missing']])await assert.rejects(load(response(status,{})),error=>error.kind===kind);
 await assert.rejects(load(response(200,{is_organizer:false})),error=>error.kind==='access');
});
test('network errors and cancellation propagate without inventing a role',async()=>{
 for(const name of ['TypeError','AbortError'])await assert.rejects(loadOrganizerDashboard(async()=>{const error=Error('network');error.name=name;throw error;},'/api','sample'),error=>error.name===name);
});
test('organizer notifications use application UI and its CSS cannot restyle other pages',async()=>{
 const source=await fs.readFile(new URL('../src/pages/OrganizerDashboard.jsx',import.meta.url),'utf8');
 assert.doesNotMatch(source,/\b(?:alert|confirm)\s*\(/);
 const css=postcss.parse(await fs.readFile(new URL('../src/styles/OrganizerDashboard.css',import.meta.url),'utf8'));
 css.walkRules(rule=>{
  if(rule.parent.type==='atrule'&&/keyframes/.test(rule.parent.name))return;
  assert.ok(rule.selectors.every(selector=>selector.includes('.organizer-refresh')||selector.includes('.organizer-workspace')),rule.selector);
 });
});
