// Stable JSON files, conditional writes and disposable per-account body caches.
let syncPromise=null, syncAgain=false, syncInterval=null;
const SYNC=EvidenceSync;
const MAX_SYNC_BYTES=2*1024*1024;
let remoteBodies=new Map(),remoteAccount='',remoteGeneration=-1;
const reviewChecks=new Map();
const forcedReviews=new Set();
function syncStatus(message){$('#syncStatus').textContent=message}
async function listDriveFiles(q){
  let pageToken='',out=[];
  do{
    const page=await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(q)}&fields=nextPageToken,files(id,name,mimeType,size,modifiedTime,version)&pageSize=1000${pageToken?'&pageToken='+encodeURIComponent(pageToken):''}`);
    out.push(...(page.files||[]));pageToken=page.nextPageToken||'';
  }while(pageToken);
  return out;
}
async function readSyncFiles(){
  if(remoteGeneration!==authGeneration){
    const account=await driveFetch('https://www.googleapis.com/drive/v3/about?fields=user(permissionId)');
    if(!account.user?.permissionId)throw Error('Drive 계정을 확인하지 못했습니다.');
    remoteAccount=getCfg().clientId+':'+account.user.permissionId;
    remoteGeneration=authGeneration;remoteBodies.clear();reviewChecks.clear();
  }
  const folders=await listDriveFiles("name='Career Evidence' and mimeType='application/vnd.google-apps.folder' and trashed=false");
  const ids=new Set(folders.map(f=>f.id));if(getCfg().folderId)ids.add(getCfg().folderId);
  const files=new Map();
  for(const id of ids){
    for(const f of await listDriveFiles(`'${id.replace(/'/g,"\\'")}' in parents and trashed=false`)){
      if(/\.(json|md)$/i.test(f.name))files.set(f.id,f);
    }
  }
  const candidates=[];
  for(const f of files.values()){
    if(Number(f.size||0)>MAX_SYNC_BYTES)throw Error(f.name+': 개별 기록이 2MB를 초과합니다.');
    const cacheKey=remoteAccount+':'+f.id,version=String(f.version||f.modifiedTime||'');
    const cached=remoteBodies.get(f.id)||await RemoteCache.get(cacheKey);
    const body=version&&cached?.version===version?cached.body:await driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(f.id)}?alt=media`);
    let parsed;
    try{parsed=/\.json$/i.test(f.name)?SYNC.parseJson(body):[SYNC.parseMarkdown(String(body),f.name)]}
    catch(e){throw Error(`${f.name}: ${e.message}. 파일을 확인한 뒤 다시 동기화하세요.`)}
    for(const p of parsed){
      p.logicalId=p.logicalId||'legacy-'+await SYNC.hash(p.record.date+'\n'+p.record.process);
      p.key=await SYNC.hash(JSON.stringify({id:p.logicalId,parents:[...p.parents].sort(),record:p.record}));
      candidates.push({...p,fileId:f.id,fileName:f.name,modifiedTime:f.modifiedTime,native:body?.format==='career-evidence-record-v3',legacyParents:body?.legacyParents||[],storageVersion:body?.storageVersion});
    }
    if(version){remoteBodies.set(f.id,{version,body});await RemoteCache.put(cacheKey,{version,body})}
  }
  for(const id of remoteBodies.keys())if(!files.has(id))remoteBodies.delete(id);
  return candidates;
}
function setLocal(id,change){
  const list=entries(),i=list.findIndex(x=>x.id===id);if(i<0)return;
  list[i]={...list[i],...change};saveEntries(list);return list[i];
}
function remoteSummary(r){return {key:r.key,record:r.record,fileId:r.fileId,fileName:r.fileName,logicalId:r.logicalId}}
async function reconcile(candidates){
  const groups=new Map(),locals=entries();
  const identity=new Map(),titles=new Map();
  for(const x of locals){for(const key of [x.id,x.syncId,x.driveFileId])if(key)identity.set(key,x);const title=x.date+'\n'+x.process;if(!titles.has(title))titles.set(title,x)}
  const update=(id,change)=>{const x=identity.get(id);if(x)Object.assign(x,change)};
  // Prefer explicit identity. Title matching only attaches old records and never overwrites without a baseline.
  for(const r of candidates){
    const title=titles.get(r.record.date+'\n'+r.record.process);
    const local=identity.get(r.logicalId)||identity.get(r.fileId)||((!title?.syncId||r.logicalId.startsWith('legacy-'))?title:null);
    const group=local?.syncId||local?.id||r.logicalId;
    if(!groups.has(group))groups.set(group,[]);groups.get(group).push(r);
  }
  let downloaded=0,conflicts=0;
  for(const [id,versions] of groups){
    const heads=SYNC.heads(versions);
    let local=identity.get(id);
    if(!local){
      // Local DOM identifiers never come from untrusted Drive data.
      local={...heads[0].record,id:crypto.randomUUID(),syncId:id};locals.push(local);identity.set(id,local);identity.set(local.id,local);downloaded++;
    }
    const remote=heads[0];
    if(local.syncResolution&&heads.every(r=>local.syncResolution.includes(r.key))){
      update(local.id,{syncId:remote.logicalId,syncConflict:null,syncNeedsUpload:true,syncNative:remote.native,driveFileId:remote.fileId,driveFileName:remote.fileName,syncLegacyParents:[...new Set(versions.flatMap(r=>[r.key,...r.parents]))]});continue;
    }
    const decision=SYNC.decide(local,heads);
    const refs=heads.map(remoteSummary);
    if(decision==='conflict'){
      update(local.id,{syncId:id,syncConflict:refs});conflicts++;continue;
    }
    if(decision==='download')downloaded++;
    update(local.id,{
      ...(decision==='download'?remote.record:{}),syncId:id,syncConflict:null,
      syncHeads:heads.map(r=>r.key),syncBase:decision==='upload'?local.syncBase:SYNC.signature(remote.record),
      driveFileId:remote.fileId,driveFileName:remote.fileName,syncNeedsUpload:!remote.native,
      syncNative:remote.native,syncLegacyParents:remote.storageVersion===4?remote.legacyParents:[...new Set(versions.flatMap(r=>[r.key,...r.parents]))]
    });
  }
  saveEntries(locals);
  return {downloaded,conflicts};
}
async function uploadRevision(item){
  const record=SYNC.clean(item),id=item.syncId||item.id;
  const legacyParents=[...new Set(item.syncLegacyParents||[])];
  const parents=[...new Set([...legacyParents,...(item.syncHeads||[])])].sort();
  const key=await SYNC.hash(JSON.stringify({id,parents,record}));
  const folder=await ensureDriveFolder();
  const payload={format:'career-evidence-record-v3',storageVersion:4,id,parents,legacyParents,record};
  const name=`${record.date}_${safeName(record.process)}_${(await SYNC.hash(id)).slice(0,12)}.json`;
  let file;
  if(item.syncNative&&item.driveFileId){
    // Read a stable snapshot, then require exactly that ETag at update time.
    const url='https://www.googleapis.com/drive/v2/files/'+encodeURIComponent(item.driveFileId);
    const before=await driveFetch(url+'?fields=id,etag');
    const latest=await driveFetch(url+'?alt=media');
    const after=await driveFetch(url+'?fields=id,etag');
    if(!before.etag||before.etag!==after.etag)throw Error('Drive 내용이 변경되었습니다. 다시 동기화하세요.');
    const parsed=SYNC.parseJson(latest)[0];
    const latestKey=await SYNC.hash(JSON.stringify({id:parsed.logicalId,parents:[...parsed.parents].sort(),record:parsed.record}));
    const expected=item.syncResolution||item.syncHeads||[];
    if(parsed.logicalId!==id||!expected.includes(latestKey))throw Error('다른 기기의 수정이 감지되었습니다. 다시 동기화하여 확인하세요.');
    file=await driveFetch('https://www.googleapis.com/upload/drive/v2/files/'+encodeURIComponent(item.driveFileId)+'?uploadType=media&newRevision=true&fields=id',{method:'PUT',headers:{'Content-Type':'application/json; charset=UTF-8','If-Match':after.etag},body:JSON.stringify(payload)});
    remoteBodies.delete(item.driveFileId);
  }else{
  const boundary='evidence_'+crypto.randomUUID();
  const body=new Blob([`--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify({name,parents:[folder],mimeType:'application/json'})}\r\n--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${JSON.stringify(payload,null,2)}\r\n--${boundary}--`]);
  file=await driveFetch('https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name',{method:'POST',headers:{'Content-Type':`multipart/related; boundary=${boundary}`},body});
  }
  setLocal(item.id,{syncId:id,syncHeads:[key],syncBase:SYNC.signature(record),driveFileId:file.id,driveFileName:item.syncNative?item.driveFileName:name,driveSyncedAt:nowIso(),syncConflict:null,syncResolution:null,syncNeedsUpload:false,syncNative:true,syncLegacyParents:legacyParents});
  if(entries().some(x=>x.id===item.id&&SYNC.signature(x)!==SYNC.signature(record)))syncAgain=true;
}
async function applyReviewComments(){
  let count=0;
  const pending=entries().filter(item=>forcedReviews.has(item.id)||!item.aiFeedback||item.reviewStatus==='raw').sort((a,b)=>(reviewChecks.get(a.id)||0)-(reviewChecks.get(b.id)||0));
  let checked=0;
  for(const item of pending){
    if(!item.driveFileId||item.syncConflict)continue;
    if(Date.now()-(reviewChecks.get(item.id)||0)<300000||checked>=20)continue;
    checked++;
    let pageToken='',comments=[];
    do{
      const data=await driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(item.driveFileId)}/comments?fields=nextPageToken,comments(id,content,createdTime,modifiedTime,deleted)&pageSize=100${pageToken?'&pageToken='+encodeURIComponent(pageToken):''}`);
      comments.push(...(data.comments||[]));pageToken=data.nextPageToken||'';
    }while(pageToken);
    reviewChecks.set(item.id,Date.now());
    forcedReviews.delete(item.id);
    const options=comments.filter(c=>!c.deleted).map(c=>({c,d:parseReviewComment(c.content,{id:item.syncId||item.id})})).filter(x=>x.d).sort((a,b)=>String(b.c.modifiedTime||b.c.createdTime).localeCompare(String(a.c.modifiedTime||a.c.createdTime)));
    const chosen=options[0];if(!chosen)continue;
    const {c,d}=chosen,stamp=c.id+':'+(c.modifiedTime||c.createdTime);
    if(item.driveReviewCommentId===stamp)continue;
    // Scheduled review includes the reviewed original; never apply stale feedback to new text.
    const current=entries().find(x=>x.id===item.id);if(!current)continue;
    const original=x=>JSON.stringify([x.situation||'',x.action||'',x.result||'',x.followUp||'']);
    if(!d.reviewedOriginal||original(current)!==original(d.reviewedOriginal))continue;
    if(d.entryId!==(item.syncId||item.id))continue;
    const review=SYNC.clean({...current,aiFeedback:d.feedback,aiRevision:d.revision,aiRecommendedSkills:d.recommendedSkills,aiRecommendedValue:d.recommendedValue,aiPortfolioNote:d.portfolioNote,aiReviewedAt:d.reviewedAt,reviewStatus:d.status||'reviewed'});
    setLocal(item.id,{...review,driveReviewCommentId:stamp});count++;
  }
  return count;
}
async function runSync(){
  const generation=authGeneration;
  syncStatus('Drive에서 기록과 검토본을 가져오는 중...');
  const remote=await readSyncFiles();
  if(generation!==authGeneration||!driveToken)throw Error('Drive 연결이 변경되었습니다. 다시 동기화하세요.');
  const summary=await reconcile(remote);
  const reviews=await applyReviewComments();let uploaded=0;
  for(const item of entries()){
    if(generation!==authGeneration||!driveToken)throw Error('Drive 연결이 변경되었습니다.');
    if(item.syncConflict)continue;
    if(item.syncNeedsUpload||!item.syncBase||SYNC.signature(item)!==item.syncBase){await uploadRevision(item);uploaded++}
  }
  renderEntries();renderReview();renderConflicts();
  const n=entries().filter(x=>x.syncConflict).length;
  syncStatus(`동기화 완료: 가져오기 ${summary.downloaded}건 · 백업 ${uploaded}건 · AI 검토 ${reviews}건${n?' · 충돌 '+n+'건 (아래에서 확인)':''}`);
  return {ok:true,conflicts:n};
}
function scheduleSync(){
  if(!driveToken)return Promise.resolve({ok:false});
  if(syncPromise){syncAgain=true;return syncPromise}
  syncPromise=(async()=>{
    let outcome;
    try{do{syncAgain=false;outcome=await runSync()}while(syncAgain&&driveToken);return outcome}
    catch(e){syncStatus('동기화 중단: '+friendlyError(e)+' · 로컬 기록은 보존됩니다.');return {ok:false}}
    finally{syncPromise=null;renderEntries();renderReview();renderConflicts()}
  })();return syncPromise;
}
function startAutoSync(){
  clearInterval(syncInterval);scheduleSync();
  syncInterval=setInterval(()=>{if(document.visibilityState==='visible'&&driveToken)scheduleSync()},60000);
}
function renderConflicts(){
  const host=$('#syncConflicts');if(!host)return;host.replaceChildren();
  for(const item of entries().filter(x=>x.syncConflict)){
    const panel=document.createElement('details'),title=document.createElement('summary');
    title.textContent=`동시 수정 확인: ${item.process}`;panel.append(title);
    const versions=[{record:SYNC.clean(item),label:'앱 내용'},...item.syncConflict.map((r,i)=>({record:r.record,label:`Drive 내용 ${i+1}`}))];
    versions.forEach(v=>{
      const pre=document.createElement('pre');pre.style.whiteSpace='pre-wrap';pre.textContent=v.label+'\n'+Object.entries({date:'날짜',process:'제목',situation:'상황',action:'내가 한 일',result:'결과',followUp:'다음에 확인할 일',aiFeedback:'피드백'}).map(([key,label])=>`${label}: ${v.record[key]||'없음'}`).join('\n\n');
      const button=document.createElement('button');button.className='secondary';button.textContent=v.label+'을 다음 버전으로 사용';
      button.onclick=()=>{
        const current=entries().find(x=>x.id===item.id);if(!current?.syncConflict)return;
        // Save both sides before the user selects a new head.
        localStorage.setItem('career-evidence-conflict-'+crypto.randomUUID(),JSON.stringify(current));
        setLocal(item.id,{...v.record,syncHeads:[...new Set([...(current.syncHeads||[]),...current.syncConflict.map(r=>r.key)])],syncBase:null,syncConflict:null,syncResolution:current.syncConflict.map(r=>r.key)});
        renderConflicts();scheduleSync();
      };panel.append(pre,button);
    });host.append(panel);
  }
}
async function importBackupFile(file){
  const text=await file.text();
  const parsed=/\.md$/i.test(file.name)?[SYNC.parseMarkdown(text,file.name)]:SYNC.parseJson(text);
  const remotes=[];
  for(const p of parsed){p.logicalId=p.logicalId||'legacy-'+await SYNC.hash(p.record.date+'\n'+p.record.process);p.key=await SYNC.hash(JSON.stringify({id:p.logicalId,parents:p.parents,record:p.record}));remotes.push({...p,fileId:'',fileName:file.name})}
  await reconcile(remotes);
  // Imported files must be uploaded once; they are not yet Drive revision files.
  for(const x of entries()){if(!x.driveFileId&&!x.syncConflict)setLocal(x.id,{syncBase:null})}
  renderEntries();renderReview();renderConflicts();if(driveToken)await scheduleSync();
  else syncStatus(`${parsed.length}건 백업을 합쳤습니다. Drive 연결 시 자동 백업됩니다.`);
}
$('#syncDriveBtn').textContent='지금 양방향 동기화';
$('#syncDriveBtn').onclick=()=>{reviewChecks.clear();return driveToken?scheduleSync():alert('먼저 Google Drive를 연결하세요.')};
$('#pullReviewsBtn').onclick=$('#syncDriveBtn').onclick;
window.pullOneReview=id=>{forcedReviews.add(id);reviewChecks.delete(id);return driveToken?scheduleSync():alert('먼저 구글 드라이브에 연결해 주세요.')};
$('#importFile').accept='.json,.md,application/json,text/markdown';
$('#importBtn').textContent='JSON / Markdown 백업 가져오기 (기존 기록 유지)';
$('#importFile').onchange=async e=>{const f=e.target.files[0];if(!f)return;try{await importBackupFile(f)}catch(err){syncStatus('가져오기 실패: '+err.message)}finally{e.target.value=''}};
window.addEventListener('online',()=>{if(driveToken)scheduleSync()});
document.addEventListener('visibilitychange',()=>{if(document.visibilityState==='visible'&&driveToken)scheduleSync()});
renderConflicts();
