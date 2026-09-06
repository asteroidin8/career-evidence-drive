const fs=require('fs'),vm=require('vm'),assert=require('assert/strict'),crypto=require('crypto').webcrypto;
const dir=require('path').join(__dirname,'../');
const sources=['sync.js','app.js','drive-sync.js'].map(f=>fs.readFileSync(dir+f,'utf8')).join('\n');
const KEY='career-evidence-v1';
function server(){return {files:[],posts:0,fail:false,comments:new Map()}}
function device(s,store=new Map()){
 const nodes=new Map();const element=()=>({value:'',style:{},children:[],classList:{toggle(){},add(){},remove(){}},addEventListener(t,f){this[t]=f},reset(){},replaceChildren(){this.children=[]},append(...x){this.children.push(...x)}});
 const node=k=>{if(!nodes.has(k))nodes.set(k,element());return nodes.get(k)};
 const ctx={console,Headers,Blob,URL,Date,TextEncoder,crypto,document:{visibilityState:'visible',querySelector:node,querySelectorAll:()=>[],addEventListener(){},createElement:element},navigator:{},localStorage:{getItem:k=>store.get(k)||null,setItem:(k,v)=>store.set(k,v)},alert(){},confirm:()=>true,setTimeout:()=>1,clearTimeout(){},setInterval:()=>1,clearInterval(){},addEventListener(){}};
 ctx.window=ctx;
 ctx.fetch=async(url,o={})=>{
  if(s.fail)throw Error('offline');
  const u=new URL(url);let body;
  if(o.method==='POST'){
    assert(url.includes('uploadType=multipart'),'Only immutable record uploads allowed');
    const raw=await o.body.text(),parts=raw.split('\r\n\r\n');
    const meta=JSON.parse(parts[1].split('\r\n--')[0]);body={id:'f'+(s.files.length+1),name:meta.name};
    const payload=JSON.parse(parts[2].split('\r\n--')[0]);s.files.push({...body,mimeType:'application/json',body:payload});s.posts++;
  }else if(u.searchParams.has('q')){
    const q=u.searchParams.get('q');body=q.includes('mimeType=')?{files:[{id:'folder',name:'Career Evidence'}]}:{files:s.files.map(({body,...x})=>x)};
  }else if(u.pathname.endsWith('/comments'))body={comments:s.comments.get(u.pathname.split('/').at(-2))||[]};
  else if(u.searchParams.get('alt')==='media')body=s.files.find(f=>f.id===u.pathname.split('/').at(-1)).body;
  else body={id:'folder'};
  return {ok:true,status:200,headers:new Headers({'content-type':'application/json'}),json:async()=>structuredClone(body)};
 };
 vm.createContext(ctx);vm.runInContext(sources,ctx);vm.runInContext("driveToken='test';tokenExpiresAt=Date.now()+3600000;setCfg({folderId:'folder'})",ctx);
 return {ctx,node,store,run:s=>vm.runInContext(s,ctx),sync:()=>vm.runInContext('scheduleSync()',ctx),records:()=>JSON.parse(store.get(KEY)||'[]')};
}
const record={id:'one',date:'2026-09-06',process:'테스트',situation:'원문',action:'행동',result:'결과',types:[],skills:[]};
const put=(d,r)=>d.store.set(KEY,JSON.stringify(r));
(async()=>{
 const s=server(),a=device(s);put(a,[record]);assert.equal((await a.sync()).ok,true);assert.equal(s.posts,1);
 const b=device(s);await b.sync();assert.equal(b.records()[0].situation,'원문');assert.equal(s.posts,1,'no repeat upload');
 put(a,[{...a.records()[0],result:'수정된 결과'}]);await a.sync();await b.sync();assert.equal(b.records()[0].result,'수정된 결과');assert.equal(s.files.length,2,'old revision retained');
 put(a,[{...a.records()[0],result:'A 편집'}]);put(b,[{...b.records()[0],result:'B 편집'}]);await a.sync();await b.sync();assert(b.records()[0].syncConflict);assert.equal(b.records()[0].result,'B 편집');assert.equal(s.posts,3,'conflict not overwritten');
 const conflicted=b.records()[0];put(b,[{...conflicted,syncResolution:conflicted.syncConflict.map(r=>r.key),syncHeads:conflicted.syncConflict.map(r=>r.key),syncConflict:null,syncBase:null}]);await b.sync();assert.equal(s.posts,4);await a.sync();assert.equal(a.records()[0].result,'B 편집');assert(!a.records()[0].syncConflict);
 const last=s.files.at(-1),r=last.body.record;
 s.comments.set(last.id,[{id:'review',modifiedTime:'2026-09-06T15:00:00Z',content:'CAREER_EVIDENCE_AI_REVIEW\n'+JSON.stringify({entryId:last.body.id,reviewedOriginal:r,feedback:'피드백',revision:{situation:'정리',action:'정리',result:'정리',followUp:''},recommendedSkills:['문제 해결'],recommendedValue:'높음',status:'reviewed'})}]);
 await a.sync();assert.equal(a.records()[0].aiFeedback,'피드백');await b.sync();assert.equal(b.records()[0].aiFeedback,'피드백');
 const before=s.posts;await a.sync();assert.equal(s.posts,before,'review not repeated');
 const c=device(s);await c.sync();assert.equal(c.records().length,1);assert.equal(c.records()[0].aiFeedback,'피드백');
 s.fail=true;put(c,[{...c.records()[0],situation:'오프라인'}]);assert.equal((await c.sync()).ok,false);assert.equal(c.records()[0].situation,'오프라인');s.fail=false;
 const legacy=server();legacy.files.push({id:'backup',name:'career-evidence-backup.json',body:[record]});const l=device(legacy);await l.sync();assert.equal(l.records().length,1);assert.equal(legacy.posts,1);await l.sync();assert.equal(legacy.posts,1);
 const bad=server();bad.files.push({id:'bad',name:'bad.json',body:{unexpected:true}});const d=device(bad);put(d,[record]);assert.equal((await d.sync()).ok,false);assert.equal(bad.posts,0);assert.equal(d.records().length,1);
 const parser=device(server());assert.equal(parser.run('EvidenceSync.parseJson([]).length'),0);
 const raw='교환 기록\n2026-09-06 · 문제 해결\n**상황** 상황 **행동** 행동 **결과** 결과\n상황 판단교육/지원문제 해결';
 parser.ctx.raw=raw;assert.equal(parser.run('EvidenceSync.parseJson({raw_original:raw})[0].record.result'),'결과');
 // Direct editing of Drive JSON is downloaded; it cannot erase the device copy.
 const edited=structuredClone(s.files.at(-1));edited.body.record.aiFeedback='Drive에서 수정';s.files[s.files.length-1]=edited;await b.sync();assert.equal(b.records()[0].aiFeedback,'Drive에서 수정');
 // Legacy raw backup matches a previously manually restored record without duplicating it on later syncs.
 const old=server();old.files.push({id:'raw',name:'original.json',body:{raw_original:raw}});const oldDevice=device(old);
 put(oldDevice,[{...record,id:'manual',process:'교환 기록',situation:'상황',action:'행동',result:'결과'}]);await oldDevice.sync();
 const first=oldDevice.records()[0];assert(first.syncConflict);put(oldDevice,[{...first,syncResolution:first.syncConflict.map(r=>r.key),syncHeads:first.syncConflict.map(r=>r.key),syncConflict:null,syncBase:null}]);await oldDevice.sync();await oldDevice.sync();assert.equal(oldDevice.records().length,1);
 const h=device(server());assert.equal(h.run("EvidenceSync.heads([{key:'a',parents:[]},{key:'b',parents:['a']},{key:'c',parents:['a']}]).length"),2);
 assert.throws(()=>h.run("EvidenceSync.heads([{key:'a',parents:['b']},{key:'b',parents:['a']}])"));
 h.run("let pages=0;driveFetch=async u=>{pages++;return pages===1?{files:[{id:'a'}],nextPageToken:'next'}:{files:[{id:'b'}]}}");assert.equal((await h.run("listDriveFiles('test')")).length,2);
 const mdDevice=device(server());mdDevice.ctx.sample=record;assert.equal(mdDevice.run('EvidenceSync.parseMarkdown(toMarkdown(sample)).record.situation'),'원문');
 console.log('PASS: two devices, remote-only restore, local/remote edits, conflict preservation/resolution, immutable history, comments and AI propagation, idempotency, offline, invalid backups, legacy JSON/raw/Markdown imports and pagination.');
})().catch(e=>{console.error(e);process.exitCode=1});

