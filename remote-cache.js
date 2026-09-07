// Disposable cache only. Tokens and credentials never enter this database.
const RemoteCache=(()=>{
  let database;
  async function db(){
    if(!globalThis.indexedDB)return null;
    if(!database)database=new Promise((resolve,reject)=>{
      const r=indexedDB.open('career-evidence-remote-cache',1);
      r.onupgradeneeded=()=>r.result.createObjectStore('files');
      r.onsuccess=()=>resolve(r.result);r.onerror=()=>reject(r.error);
    }).catch(()=>null);
    return database;
  }
  async function operation(mode,key,value){
    const d=await db();if(!d)return;
    return new Promise((resolve,reject)=>{
      const tx=d.transaction('files',mode),s=tx.objectStore('files');
      const r=mode==='readonly'?s.get(key):s.put(value,key);
      tx.oncomplete=()=>resolve(r.result);tx.onerror=()=>reject(tx.error);tx.onabort=()=>reject(tx.error);
    }).catch(()=>undefined);
  }
  return {get:key=>operation('readonly',key),put:(key,value)=>operation('readwrite',key,value)};
})();
