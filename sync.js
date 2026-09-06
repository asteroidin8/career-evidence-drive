/* Immutable Drive revisions: existing remote files are never overwritten. */
const EvidenceSync=(()=>{
  const fields=['date','process','types','situation','action','result','followUp','skills','value','before','after','numbers','reviewStatus','aiFeedback','aiRevision','aiRecommendedSkills','aiRecommendedValue','aiPortfolioNote','aiReviewedAt','rawOriginal'];
  function clean(x){
    if(!x||typeof x!=='object'||Array.isArray(x))throw Error('기록 형식 오류');
    const out={};
    for(const k of fields){
      if(['types','skills','aiRecommendedSkills'].includes(k))out[k]=Array.isArray(x[k])?x[k].filter(v=>typeof v==='string'):[];
      else if(k==='aiRevision')out[k]=x[k]&&typeof x[k]==='object'?Object.fromEntries(['situation','action','result','followUp'].map(n=>[n,typeof x[k][n]==='string'?x[k][n]:''])):null;
      else out[k]=typeof x[k]==='string'?x[k]:'';
    }
    out.reviewStatus=['raw','reviewed','followup','final'].includes(out.reviewStatus)?out.reviewStatus:'raw';
    out.value=out.value||'보통';
    if(!/^\d{4}-\d{2}-\d{2}$/.test(out.date)||!out.process)throw Error('날짜 또는 제목이 없는 기록');
    return out;
  }
  const signature=x=>JSON.stringify(clean(x));
  async function hash(text){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(text)))).map(x=>x.toString(16).padStart(2,'0')).join('')}
  const decode=v=>{try{return JSON.parse(v)}catch{return v}};
  function parseMarkdown(text,name=''){
    let x={},parents=[],logicalId='';
    const envelope=text.match(/\n<!-- CAREER_EVIDENCE_SYNC_V1\n([\s\S]*?)\n-->\s*$/);
    if(envelope){const data=JSON.parse(envelope[1]);x=clean(data.record);logicalId=data.id;parents=Array.isArray(data.parents)?data.parents.filter(v=>typeof v==='string'):[];text=text.slice(0,envelope.index)}
    const fm=text.match(/^---\r?\n([\s\S]*?)\r?\n---/);
    if(fm){
      const meta=Object.fromEntries(fm[1].split(/\r?\n/).map(l=>{const i=l.indexOf(':');return [l.slice(0,i),decode(l.slice(i+1).trim())]}));
      logicalId=logicalId||meta.id;
      Object.assign(x,{date:meta.date,types:meta.category,skills:meta.skills,value:meta.interview_value,reviewStatus:meta.review_status});
      x.process=text.match(/^# (.+)$/m)?.[1];
      const section=(heading,next)=>{const start=text.indexOf(heading+'\n');if(start<0)throw Error('Markdown 구역 누락: '+heading);const from=start+heading.length+1;const end=next?text.indexOf(next,from):text.length;if(end<0)throw Error('Markdown 구역 종료 누락');return text.slice(from,end).trim()};
      const value=s=>['-','> 아직 검토 전','- 아직 검토 전'].includes(s)?'':s;
      const original=section('## 원본 기록','## 숫자 / 객관적 근거');
      function sub(block,label){const match=block.match(new RegExp('(?:^|\\n)### '+label+'\\n([\\s\\S]*?)(?=\\n### |$)'));if(!match)throw Error('Markdown 항목 누락: '+label);return value(match[1].trim())}
      for(const [k,label] of Object.entries({situation:'상황',action:'행동',result:'결과',followUp:'후속 확인'}))x[k]=sub(original,label);
      const nums=section('## 숫자 / 객관적 근거','## AI 피드백');
      for(const [k,label] of Object.entries({before:'전',after:'후',numbers:'참고 숫자'})){const m=nums.match(new RegExp('(?:^|\\n)- '+label+': ([\\s\\S]*?)(?=\\n- (?:전|후|참고 숫자): |$)'));x[k]=value(m?.[1]?.trim()||'')}
      x.aiFeedback=value(section('## AI 피드백','### AI 추천 역량'));
      x.aiRecommendedSkills=section('### AI 추천 역량','### AI 추천 면접가치').split('\n').filter(l=>l.startsWith('- ')&&l!=='- 아직 검토 전').map(l=>l.slice(2));
      x.aiRecommendedValue=value(section('### AI 추천 면접가치','## AI 수정본'));
      const ai=section('## AI 수정본','## 최종 활용 메모');
      x.aiRevision=Object.fromEntries(Object.entries({situation:'상황',action:'행동',result:'결과',followUp:'후속 확인'}).map(([k,label])=>[k,sub(ai,label)]));
      if(Object.values(x.aiRevision).every(v=>!v))x.aiRevision=null;
      x.aiPortfolioNote=value(section('## 최종 활용 메모','## 후속 기록'));
    }else{
      const m=text.match(/\*\*상황\*\*\s*([\s\S]*?)\s*\*\*행동\*\*\s*([\s\S]*?)\s*\*\*결과\*\*\s*([\s\S]*)/);
      if(!m)throw Error('지원하지 않는 Markdown 형식: '+name);
      const lines=text.split(/\r?\n/);x={date:text.match(/\d{4}-\d{2}-\d{2}/)?.[0],process:lines[0].replace(/^#+\s*/,''),types:['문제 해결'],situation:m[1],action:m[2],result:m[3].split('\n')[0],rawOriginal:text};
      x.skills=['상황 판단','교육/지원','문제 해결'].filter(k=>lines.at(-1).includes(k));
    }
    return {record:clean(x),logicalId:typeof logicalId==='string'?logicalId:'',parents};
  }
  function parseJson(value){
    if(typeof value==='string')value=JSON.parse(value);
    if(value?.format==='career-evidence-record-v3'){
      if(typeof value.id!=='string'||!Array.isArray(value.parents))throw Error('동기화 JSON 형식 오류');
      return [{record:clean(value.record),logicalId:value.id,parents:value.parents.filter(v=>typeof v==='string')}];
    }
    if(Array.isArray(value))return value.map(x=>({record:clean(x),logicalId:typeof x.syncId==='string'?x.syncId:typeof x.id==='string'?x.id:'',parents:[]}));
    if(value?.raw_original)return [parseMarkdown(value.raw_original,value.title)];
    throw Error('지원하지 않는 JSON 백업 형식');
  }
  // A missing baseline is deliberately treated as a conflict, never newest-wins.
  function decide(local,remote){
    const unique=[...new Map(remote.map(r=>[signature(r.record),r])).values()];
    if(!local)return unique.length===1?'import':'conflict';
    if(unique.length===1&&signature(local)===signature(unique[0].record))return 'equal';
    if(unique.length!==1)return 'conflict';
    const base=local.syncBase;
    if(!base)return 'conflict';
    if(signature(local)===base)return 'download';
    if(signature(unique[0].record)===base)return 'upload';
    return 'conflict';
  }
  function heads(candidates){
    const all=new Map(candidates.map(x=>[x.key,x]));
    const superseded=new Set(candidates.flatMap(x=>x.parents));
    const result=[...all.values()].filter(x=>!superseded.has(x.key));
    if(candidates.length&&!result.length)throw Error('순환된 동기화 기록');
    return result;
  }
  return {clean,signature,hash,parseMarkdown,parseJson,decide,heads};
})();
