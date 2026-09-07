const TYPES=['문제 해결','업무 숙련','생산성','협업','신규 크루 지원','책임 업무','개선 제안','안전','품질/오류','기타'];
const SKILLS=['상황 판단','문제 해결','책임감','커뮤니케이션','협업','업무 숙련도','생산성 관리','교육/지원','리더십 가능성','안전의식','품질관리','프로세스 이해'];
const VALUES=['낮음','보통','높음','핵심 후보'];
const KEY='career-evidence-v1';
const CFG_KEY='career-evidence-drive-config-v2';
const REVIEW_MARKER='CAREER_EVIDENCE_AI_REVIEW';
const DRIVE_SCOPE='https://www.googleapis.com/auth/drive.file';
let selectedTypes=[], selectedSkills=[], selectedValue='보통';
let driveToken=null, tokenClient=null, driveBusy=false;
const $=s=>document.querySelector(s);
const esc=s=>(s??'').toString().replace(/[&<>"']/g,m=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[m]));
const entries=()=>{try{return JSON.parse(localStorage.getItem(KEY)||'[]')}catch{return[]}};
const saveEntries=v=>localStorage.setItem(KEY,JSON.stringify(v));
const getCfg=()=>{try{return JSON.parse(localStorage.getItem(CFG_KEY)||'{}')}catch{return{}}};
let cfgMemory=null;
const setCfg=v=>{cfgMemory={...getCfg(),...cfgMemory,...v};try{localStorage.setItem(CFG_KEY,JSON.stringify(cfgMemory));return true}catch{return false}};
const today=()=>{const d=new Date();return new Date(d.getTime()-d.getTimezoneOffset()*60000).toISOString().slice(0,10)};
const nowIso=()=>new Date().toISOString();
const reviewLabel=s=>({raw:'미검토',reviewed:'검토완료',followup:'후속확인',final:'최종완료'}[s]||'미검토');
const sleep=ms=>new Promise(r=>setTimeout(r,ms));


function migrateV2(){
  const flag='career-evidence-drive-v2-migration'; if(localStorage.getItem(flag)) return;
  const list=entries().map(x=>({reviewStatus:x.reviewStatus||'raw',aiFeedback:x.aiFeedback||'',aiRevision:x.aiRevision||null,aiRecommendedSkills:x.aiRecommendedSkills||[],aiRecommendedValue:x.aiRecommendedValue||'',aiPortfolioNote:x.aiPortfolioNote||'',driveFileId:x.driveFileId||'',driveFileName:x.driveFileName||'',driveSyncedAt:x.driveSyncedAt||'',driveModifiedTime:x.driveModifiedTime||'',driveReviewCommentId:x.driveReviewCommentId||'',...x}));
  saveEntries(list); localStorage.setItem(flag,'1');
}

function renderChips(){
  $('#typeChips').innerHTML=TYPES.map(x=>`<button type="button" class="chip ${selectedTypes.includes(x)?'selected':''}" data-type="${esc(x)}">${esc(x)}</button>`).join('');
  $('#skillChips').innerHTML=SKILLS.map(x=>`<button type="button" class="chip ${selectedSkills.includes(x)?'selected':''}" data-skill="${esc(x)}">${esc(x)}</button>`).join('');
  $('#valueGrid').innerHTML=VALUES.map(x=>`<button type="button" class="value ${selectedValue===x?'selected':''}" data-value="${esc(x)}">${esc(x)}</button>`).join('');
}
document.addEventListener('click',e=>{
  const t=e.target.closest('[data-type]');if(t){const v=t.dataset.type;selectedTypes=selectedTypes.includes(v)?selectedTypes.filter(x=>x!==v):[...selectedTypes,v];renderChips();return;}
  const s=e.target.closest('[data-skill]');if(s){const v=s.dataset.skill;selectedSkills=selectedSkills.includes(v)?selectedSkills.filter(x=>x!==v):[...selectedSkills,v];renderChips();return;}
  const v=e.target.closest('[data-value]');if(v){selectedValue=v.dataset.value;renderChips();return;}
});

function resetForm(){
  $('#entryForm').reset();$('#date').value=today();$('#editId').value='';selectedTypes=[];selectedSkills=[];selectedValue='보통';$('#saveBtn').textContent='기록 저장';$('#saveStatus').textContent='';renderChips();
}

$('#entryForm').addEventListener('submit',async e=>{
  e.preventDefault();
  const id=$('#editId').value||crypto.randomUUID();
  const old=entries().find(x=>x.id===id)||{};
  const item={...old,id,date:$('#date').value,process:$('#process').value.trim(),types:selectedTypes,situation:$('#situation').value.trim(),action:$('#action').value.trim(),result:$('#result').value.trim(),followUp:$('#followUp').value.trim(),skills:selectedSkills,value:selectedValue,before:$('#before').value.trim(),after:$('#after').value.trim(),numbers:$('#numbers').value.trim(),reviewStatus:old.reviewStatus||'raw',updatedAt:nowIso()};
  if(old.situation!==item.situation||old.action!==item.action||old.result!==item.result||old.followUp!==item.followUp){
    if(old.id) item.reviewStatus='raw';
  }
  const list=entries();const i=list.findIndex(x=>x.id===id);if(i>=0)list[i]=item;else list.unshift(item);saveEntries(list);renderEntries();renderReview();
  const wasNew=!$('#editId').value;
  if(wasNew)resetForm();
  $('#saveStatus').textContent='이 기기에 저장했어요. 백업을 확인하고 있어요.';
  let statusText='로컬 저장 완료';
  if(authPending) await authPending;
  if(driveToken){
    try{const synced=await scheduleSync();statusText=synced.ok?(synced.conflicts?'이 기기에 저장했어요. 백업 탭에서 동시 수정 내용을 확인해 주세요.':'기록과 구글 드라이브 백업을 저장했어요.'):'이 기기에 저장했어요. 백업은 다시 시도해 주세요.';}
    catch(err){statusText=`로컬 저장 완료 · Drive 실패: ${friendlyError(err)}`;}
  }else{statusText='이 기기에 저장했어요. 백업 탭에서 구글 드라이브를 연결해 주세요.';}
  if(!wasNew&&$('#editId').value===id)$('#saveBtn').textContent='수정 저장';
  $('#saveStatus').textContent=statusText;
});

let visibleEntries=50,lastEntryFilter='';
function renderEntries(){
  const q=$('#search').value.trim().toLowerCase(),ft=$('#filterType').value;
  const list=entries().filter(x=>(!ft||x.types?.includes(ft))&&(!q||[x.process,x.situation,x.action,x.result,x.followUp,x.aiFeedback,x.aiRevision?.situation,x.aiRevision?.action,x.aiRevision?.result,...(x.skills||[])].join(' ').toLowerCase().includes(q)));
  const filter=q+'|'+ft;if(lastEntryFilter!==filter){visibleEntries=50;lastEntryFilter=filter}
  $('#entries').innerHTML=list.length?list.slice(0,visibleEntries).map(x=>`<article class="item"><div class="item-top"><div><div class="item-title">${esc(x.process||'공정 미기입')}</div><div class="meta">${esc(x.date)} · ${(x.types||[]).map(esc).join(', ')||'유형 없음'}</div></div><span class="tag ${x.reviewStatus==='reviewed'||x.reviewStatus==='followup'||x.reviewStatus==='final'?'info':''}">${reviewLabel(x.reviewStatus)}</span></div><div class="preview"><b>상황</b> ${esc(x.situation)}\n<b>행동</b> ${esc(x.action)}\n<b>결과</b> ${esc(x.result)}</div><div class="tagrow">${(x.skills||[]).slice(0,5).map(s=>`<span class="tag">${esc(s)}</span>`).join('')}${x.value==='핵심 후보'?'<span class="tag good">핵심 후보</span>':x.value==='높음'?'<span class="tag high">높음</span>':''}${x.driveFileId?'<span class="tag">Drive 백업</span>':''}</div><div class="actions"><button class="secondary" onclick="openItem('${x.id}')">보기</button><button class="secondary" onclick="editItem('${x.id}')">수정</button>${x.driveFileId?`<button class="info" onclick="pullOneReview('${x.id}')">AI 새로고침</button>`:''}<button class="danger" onclick="deleteItem('${x.id}')">삭제</button></div></article>`).join(''):'<div class="empty">아직 기록이 없습니다.</div>';
  if(list.length>visibleEntries){const more=document.createElement('button');more.className='secondary';more.textContent='기록 더 보기 ('+Math.min(visibleEntries,list.length)+' / '+list.length+')';more.onclick=()=>{visibleEntries+=50;renderEntries()};$('#entries').append(more)}
}

window.openItem=id=>{
  const x=entries().find(v=>v.id===id);if(!x)return;
  $('#modalTitle').textContent=`${x.date} · ${x.process||'기록'}`;
  const ai=x.aiFeedback||x.aiRevision?`<div class="divider"></div><div class="ai-box"><h3>AI 피드백</h3><p>${esc(x.aiFeedback||'피드백 없음')}</p><p><b>AI 추천 역량</b><br>${esc((x.aiRecommendedSkills||[]).join(', ')||'-')}</p><p><b>AI 추천 면접가치</b><br>${esc(x.aiRecommendedValue||'-')}</p><h3>AI 수정본</h3><p><b>상황</b><br>${esc(x.aiRevision?.situation||'-')}</p><p><b>행동</b><br>${esc(x.aiRevision?.action||'-')}</p><p><b>결과</b><br>${esc(x.aiRevision?.result||'-')}</p><p><b>후속 확인</b><br>${esc(x.aiRevision?.followUp||'-')}</p>${x.aiPortfolioNote?`<p><b>활용 메모</b><br>${esc(x.aiPortfolioNote)}</p>`:''}<div class="actions"><button class="secondary" onclick="applyAiSuggestion('${x.id}')">AI 추천 태그/가치 반영</button></div></div>`:'';
  $('#modalBody').innerHTML=`<p><b>검토 상태</b><br>${reviewLabel(x.reviewStatus)}</p><p><b>유형</b><br>${esc((x.types||[]).join(', ')||'-')}</p><p><b>상황</b><br>${esc(x.situation)}</p><p><b>내가 한 행동</b><br>${esc(x.action)}</p><p><b>결과</b><br>${esc(x.result)}</p>${x.followUp?`<p><b>후속 확인 / 다음 조치</b><br>${esc(x.followUp)}</p>`:''}<p><b>역량</b><br>${esc((x.skills||[]).join(', ')||'-')}</p><p><b>면접 가치</b><br>${esc(x.value)}</p>${x.before||x.after||x.numbers?`<div class="divider"></div><p><b>전</b><br>${esc(x.before||'-')}</p><p><b>후</b><br>${esc(x.after||'-')}</p><p><b>참고 숫자</b><br>${esc(x.numbers||'-')}</p>`:''}${ai}${x.driveFileId?`<div class="divider"></div><p class="small"><b>Drive File ID</b><br><span class="mono">${esc(x.driveFileId)}</span></p>`:''}`;
  $('#modal').classList.add('show');
};
window.editItem=id=>{const x=entries().find(v=>v.id===id);if(!x)return;$('#editId').value=x.id;$('#date').value=x.date;$('#process').value=x.process||'';$('#situation').value=x.situation;$('#action').value=x.action;$('#result').value=x.result;$('#followUp').value=x.followUp||'';$('#before').value=x.before||'';$('#after').value=x.after||'';$('#numbers').value=x.numbers||'';selectedTypes=x.types||[];selectedSkills=x.skills||[];selectedValue=x.value||'보통';$('#saveBtn').textContent='수정 저장';renderChips();switchView('addView');window.scrollTo({top:0,behavior:'smooth'})};
window.deleteItem=id=>{if(!confirm('로컬 기록을 삭제할까요? Drive에 이미 올라간 파일은 안전을 위해 자동 삭제하지 않습니다.'))return;saveEntries(entries().filter(x=>x.id!==id));renderEntries();renderReview()};
window.applyAiSuggestion=id=>{const list=entries(),i=list.findIndex(x=>x.id===id);if(i<0)return;const x=list[i];if(x.aiRecommendedSkills?.length)x.skills=[...new Set([...(x.skills||[]),...x.aiRecommendedSkills])];if(x.aiRecommendedValue)x.value=x.aiRecommendedValue;list[i]=x;saveEntries(list);renderEntries();renderReview();openItem(id);if(driveToken)scheduleSync()};
window.pullOneReview=()=>driveToken?scheduleSync():alert('먼저 구글 드라이브에 연결해 주세요.');

function renderReview(){
  const list=entries(),now=new Date(),ym=`${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}`,month=list.filter(x=>x.date?.startsWith(ym));
  $('#totalCount').textContent=list.length;$('#monthCount').textContent=month.length;$('#reviewedCount').textContent=list.filter(x=>['reviewed','followup','final'].includes(x.reviewStatus)).length;
  const counts=TYPES.map(t=>[t,month.filter(x=>x.types?.includes(t)).length]).filter(x=>x[1]>0).sort((a,b)=>b[1]-a[1]),max=Math.max(1,...counts.map(x=>x[1]));
  $('#typeStats').innerHTML=counts.length?counts.map(([t,c])=>`<div class="review-row"><div class="review-head"><span>${esc(t)}</span><span>${c}</span></div><div class="bar"><i style="width:${c/max*100}%"></i></div></div>`).join(''):'<div class="empty">선택한 기록 유형이 없습니다.</div>';
  const cfg=getCfg();$('#clientId').value=cfg.clientId||'';updateDriveUi();
}
function switchView(id){document.querySelectorAll('.view').forEach(v=>v.classList.toggle('active',v.id===id));document.querySelectorAll('nav button').forEach(b=>b.classList.toggle('active',b.dataset.view===id));if(id==='listView')renderEntries();if(id==='reviewView')renderReview()}
document.querySelectorAll('nav button').forEach(b=>b.addEventListener('click',()=>switchView(b.dataset.view)));
$('#search').addEventListener('input',renderEntries);$('#filterType').addEventListener('change',renderEntries);$('#filterType').innerHTML='<option value="">전체 유형</option>'+TYPES.map(x=>`<option>${esc(x)}</option>`).join('');
$('#closeModal').onclick=()=>$('#modal').classList.remove('show');$('#modal').addEventListener('click',e=>{if(e.target===$('#modal'))$('#modal').classList.remove('show')});

function download(name,text,type){const blob=new Blob([text],{type});const a=document.createElement('a');a.href=URL.createObjectURL(blob);a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(a.href),1000)}
$('#exportBtn').onclick=()=>download(`career-evidence-${today()}.json`,JSON.stringify(entries(),null,2),'application/json');
$('#csvBtn').onclick=()=>{const rows=[['날짜','공정','유형','상황','행동','결과','후속확인','역량','면접가치','검토상태','AI피드백','AI수정상황','AI수정행동','AI수정결과','참고숫자'],...entries().map(x=>[x.date,x.process,(x.types||[]).join('|'),x.situation,x.action,x.result,x.followUp||'',(x.skills||[]).join('|'),x.value,reviewLabel(x.reviewStatus),x.aiFeedback||'',x.aiRevision?.situation||'',x.aiRevision?.action||'',x.aiRevision?.result||'',x.numbers])];const csv='\uFEFF'+rows.map(r=>r.map(v=>'"'+String(v??'').replace(/"/g,'""')+'"').join(',')).join('\n');download(`career-evidence-${today()}.csv`,csv,'text/csv;charset=utf-8')};
$('#importBtn').onclick=()=>$('#importFile').click();$('#importFile').onchange=e=>{const f=e.target.files[0];if(!f)return;const r=new FileReader();r.onload=()=>{try{const data=JSON.parse(r.result);if(!Array.isArray(data))throw 0;if(confirm(`기존 기록을 ${data.length}개의 백업 기록으로 교체할까요?`)){saveEntries(data);renderEntries();renderReview();alert('복원했습니다.')}}catch{alert('올바른 백업 파일이 아닙니다.')}};r.readAsText(f)};

// ----- Google Drive -----
// Tokens stay in memory. Only the public client ID and reconnect preference persist.
let authPending=null, authGeneration=0, authTimer=null, expiryTimer=null;
let tokenExpiresAt=0, finishAuth=null, restoring=false;
function clearDriveAuth(){
  authGeneration++;clearTimeout(authTimer);clearTimeout(expiryTimer);
  driveToken=null;tokenExpiresAt=0;tokenClient=null;restoring=false;
  if(finishAuth)finishAuth(false);
  finishAuth=null;authPending=null;
}
function updateDriveUi(){
  const cfg={...getCfg(),...cfgMemory},connected=!!driveToken;
  $('#driveBadge').textContent=connected?'백업 연결됨':restoring?'연결 중':'기기에 저장 중';
  $('#driveBadge').classList.toggle('connected',connected);
  $('#connectDriveBtn').disabled=!!authPending;
  $('#connectDriveBtn').textContent=authPending?'연결 중...':cfg.reconnectEnabled?'구글 드라이브 다시 연결':'구글 드라이브 연결';
  $('#driveSetupNote').className=`notice ${connected?'good':'warn'}`;
  $('#driveSetupNote').textContent=connected?'Google Drive 세션이 연결되었습니다. 저장 시 로컬 + Drive에 함께 저장됩니다.':restoring?'이전 구글 드라이브 연결을 복구하고 있습니다.':cfg.reconnectEnabled?'자동 연결을 사용할 수 없거나 세션이 만료되었습니다. 구글 드라이브 다시 연결을 누르세요. 로컬 기록은 유지됩니다.':'구글 드라이브를 연결하면 기록을 자동으로 백업하고 새 내용을 가져옵니다. 처음이라면 아래 설정을 먼저 열어주세요.';
  $('#driveFolderInfo').textContent='연결·저장할 때 자동 백업합니다. 앱을 열어두면 1분마다 새 내용을 확인합니다.';
}
function requestDriveAuth(silent=false){
  if(authPending)return authPending;
  const cfg={...getCfg(),...cfgMemory};
  if(!cfg.clientId||!window.google?.accounts?.oauth2){
    $('#syncStatus').textContent=cfg.clientId?'Google 인증을 불러오지 못했습니다. 인터넷 연결을 확인하고 다시 연결하세요.':'먼저 OAuth Web Client ID를 저장하세요.';
    updateDriveUi();return Promise.resolve(false);
  }
  const generation=++authGeneration;
  restoring=silent;
  authPending=new Promise(resolve=>{finishAuth=resolve});
  const pending=authPending;
  const finish=ok=>{clearTimeout(authTimer);restoring=false;const resolve=finishAuth;finishAuth=null;authPending=null;updateDriveUi();resolve?.(ok)};
  const fail=()=>{if(generation!==authGeneration)return;authGeneration++;driveToken=null;finish(false);$('#syncStatus').textContent='연결을 완료하지 못했습니다. 구글 드라이브 다시 연결을 누르세요. 팝업 차단 또는 Google 로그인 상태를 확인하세요.'};
  authTimer=setTimeout(fail,silent?12000:60000);
  updateDriveUi();
  try{
    tokenClient=google.accounts.oauth2.initTokenClient({
      client_id:cfg.clientId,scope:DRIVE_SCOPE,include_granted_scopes:false,
      error_callback:fail,
      callback:resp=>{
        if(generation!==authGeneration)return;
        const seconds=Number(resp.expires_in);
        if(resp.error||!resp.access_token||!Number.isFinite(seconds)||seconds<=30||!google.accounts.oauth2.hasGrantedAllScopes(resp,DRIVE_SCOPE)){fail();return}
        driveToken=resp.access_token;tokenExpiresAt=Date.now()+(seconds-30)*1000;
        const persisted=setCfg({reconnectEnabled:true});
        clearTimeout(expiryTimer);
        expiryTimer=setTimeout(()=>{clearDriveAuth();updateDriveUi();$('#syncStatus').textContent='Google 세션이 만료되었습니다. 다시 연결하세요.'},tokenExpiresAt-Date.now());
        finish(true);
        $('#syncStatus').textContent=persisted?'구글 드라이브에 연결됐어요.': '연결 완료. 브라우저 저장소가 차단되어 다음 실행 시 설정이 유지되지 않을 수 있습니다.';
        if(typeof startAutoSync==='function')startAutoSync();
      }
    });
    tokenClient.requestAccessToken({prompt:silent?'none':cfg.reconnectEnabled?'':'consent'});
  }catch{fail()}
  return pending;
}
async function restoreDriveAuth(){
  const cfg=getCfg();
  if(!cfg.clientId||!cfg.reconnectEnabled)return;
  const generation=authGeneration;
  restoring=true;updateDriveUi();
  for(let i=0;i<40&&!window.google?.accounts?.oauth2;i++){
    await sleep(250);if(generation!==authGeneration)return;
  }
  if(generation!==authGeneration)return;
  restoring=false;await requestDriveAuth(true);
}
$('#saveClientIdBtn').onclick=()=>{
  const v=$('#clientId').value.trim();
  if(!v.endsWith('.apps.googleusercontent.com')){alert('올바른 OAuth Web Client ID 형식인지 확인하세요.');return}
  const changed=v!==getCfg().clientId;
  clearDriveAuth();
  const ok=setCfg(changed?{clientId:v,reconnectEnabled:false,folderId:'',backupFileId:''}:{clientId:v});
  updateDriveUi();alert(ok?'Client ID를 저장했습니다.':'브라우저 저장소가 차단되어 Client ID를 저장하지 못했습니다. 현재 페이지에서만 사용할 수 있습니다.');
};
$('#connectDriveBtn').onclick=()=>requestDriveAuth(false);
$('#disconnectDriveBtn').onclick=()=>{
  clearDriveAuth();setCfg({reconnectEnabled:false});updateDriveUi();
  $('#syncStatus').textContent='Drive 연결과 자동 재연결을 해제했습니다. 로컬 기록과 Drive 파일은 유지됩니다.';
};

async function driveFetch(url,opts={}){
  if(authPending) await authPending;
  if(!driveToken) throw new Error('DRIVE_NOT_CONNECTED');
  if(Date.now()>=tokenExpiresAt){clearDriveAuth();updateDriveUi();throw new Error('DRIVE_TOKEN_EXPIRED')}
  const requestToken=driveToken;
  const headers=new Headers(opts.headers||{});headers.set('Authorization',`Bearer ${driveToken}`);
  const res=await fetch(url,{...opts,headers});
  if(res.status===401){if(driveToken===requestToken){clearDriveAuth();updateDriveUi()}throw new Error('DRIVE_TOKEN_EXPIRED')}
  if(!res.ok){let detail='';try{detail=(await res.json())?.error?.message||''}catch{}throw new Error(`DRIVE_${res.status}:${detail}`)}
  const ct=res.headers.get('content-type')||'';return ct.includes('application/json')?res.json():res.text();
}
async function ensureDriveFolder(){
  const cfg=getCfg();
  if(cfg.folderId){
    try{await driveFetch(`https://www.googleapis.com/drive/v3/files/${encodeURIComponent(cfg.folderId)}?fields=id,name,trashed`);return cfg.folderId}catch(e){if(String(e.message).includes('404'))setCfg({folderId:''});else throw e}
  }
  const q=encodeURIComponent("name='Career Evidence' and mimeType='application/vnd.google-apps.folder' and trashed=false");
  const found=await driveFetch(`https://www.googleapis.com/drive/v3/files?q=${q}&fields=files(id,name)&pageSize=10`);
  let id=found.files?.[0]?.id;
  if(!id){const created=await driveFetch('https://www.googleapis.com/drive/v3/files?fields=id,name',{method:'POST',headers:{'Content-Type':'application/json'},body:JSON.stringify({name:'Career Evidence',mimeType:'application/vnd.google-apps.folder'})});id=created.id}
  setCfg({folderId:id});updateDriveUi();return id;
}
function safeName(s){return (s||'기록').replace(/[\\/:*?"<>|#%{}~]/g,' ').replace(/\s+/g,' ').trim().slice(0,70)||'기록'}
function yamlList(arr){return `[${(arr||[]).map(v=>JSON.stringify(v)).join(', ')}]`}
function toMarkdown(x){
  const ai=x.aiRevision||{};
  return `---\nid: ${x.id}\ndate: ${x.date}\nstage: crew\ncategory: ${yamlList(x.types)}\nskills: ${yamlList(x.skills)}\ninterview_value: ${JSON.stringify(x.value||'보통')}\nreview_status: ${x.reviewStatus||'raw'}\nupdated_at: ${x.updatedAt||''}\n---\n\n# ${x.process||'기록'}\n\n## 원본 기록\n\n### 상황\n${x.situation||'-'}\n\n### 행동\n${x.action||'-'}\n\n### 결과\n${x.result||'-'}\n\n### 후속 확인\n${x.followUp||'-'}\n\n## 숫자 / 객관적 근거\n- 전: ${x.before||'-'}\n- 후: ${x.after||'-'}\n- 참고 숫자: ${x.numbers||'-'}\n\n## AI 피드백\n${x.aiFeedback||'> 아직 검토 전'}\n\n### AI 추천 역량\n${(x.aiRecommendedSkills||[]).length?(x.aiRecommendedSkills||[]).map(v=>`- ${v}`).join('\n'):'- 아직 검토 전'}\n\n### AI 추천 면접가치\n${x.aiRecommendedValue||'-'}\n\n## AI 수정본\n\n### 상황\n${ai.situation||'> 아직 검토 전'}\n\n### 행동\n${ai.action||'> 아직 검토 전'}\n\n### 결과\n${ai.result||'> 아직 검토 전'}\n\n### 후속 확인\n${ai.followUp||'> 아직 검토 전'}\n\n## 최종 활용 메모\n${x.aiPortfolioNote||'-'}\n\n## 후속 기록\n-\n`;
}
function parseReviewComment(content,item){
  if(!content||!content.startsWith(REVIEW_MARKER))return null;let raw=content.slice(REVIEW_MARKER.length).trim();raw=raw.replace(/^```json\s*/i,'').replace(/```\s*$/,'').trim();try{const data=JSON.parse(raw);if(data.entryId&&data.entryId!==item.id)return null;return data}catch{return null}
}

const REVIEW_REQUEST="Drive의 Career Evidence 폴더에서 최신 career-evidence-record-v3 JSON의 미검토 기록을 검토해줘. 이전 버전은 parents 관계로 제외하고, 충돌된 기록은 건너뛰어줘. 원본은 수정하지 말고 해당 파일에 CAREER_EVIDENCE_AI_REVIEW 한 줄 다음 JSON으로 댓글을 남겨줘. entryId는 JSON의 id, reviewedOriginal은 record의 situation/action/result/followUp을 원문 그대로 복사한 객체, reviewedAt은 현재 ISO 시각, status는 reviewed 또는 followup, feedback은 피드백, revision은 situation/action/result/followUp 수정본 객체, recommendedSkills는 추천 역량 배열, recommendedValue는 낮음/보통/높음/핵심 후보, portfolioNote는 활용 메모. 동일 원문에 대한 기존 검토는 반복하지 말고, 확인된 사실만 사용해줘.";
$('#copyReviewRequestBtn').onclick=async()=>{try{await navigator.clipboard.writeText(REVIEW_REQUEST);alert('검토 요청문을 복사했습니다. 이 채팅에 붙여넣으면 됩니다.')}catch{download('chatgpt-review-request.txt',REVIEW_REQUEST,'text/plain')}};

function friendlyError(e){const m=String(e?.message||e);if(m.includes('DRIVE_NOT_CONNECTED'))return'Drive 미연결';if(m.includes('DRIVE_TOKEN_EXPIRED'))return'Google 세션 만료. 다시 연결하세요.';if(m.includes('403'))return'Drive 권한 또는 API 설정을 확인하세요.';if(m.includes('404'))return'Drive 파일을 찾을 수 없습니다.';return m.replace(/^DRIVE_\d+:/,'')}

migrateV2();$('#date').value=today();renderChips();renderEntries();renderReview();updateDriveUi();
// Start after the sync module has loaded.
window.addEventListener('load',restoreDriveAuth);
if('serviceWorker'in navigator)navigator.serviceWorker.register('./sw.js').catch(()=>{});
