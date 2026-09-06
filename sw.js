const CACHE='career-evidence-drive-v2.2-warm-neutral';
const ASSETS=['./','./index.html','./app.js','./sync.js','./drive-sync.js','./manifest.json'];
const allowed=new Set(ASSETS.map(p=>new URL(p,self.registration.scope).href));
self.addEventListener('install',e=>{self.skipWaiting();e.waitUntil(caches.open(CACHE).then(c=>c.addAll(ASSETS)))});
self.addEventListener('activate',e=>e.waitUntil(Promise.all([clients.claim(),caches.keys().then(keys=>Promise.all(keys.filter(k=>k.startsWith('career-evidence-drive-')&&k!==CACHE).map(k=>caches.delete(k))))])));
self.addEventListener('fetch',e=>{
 if(e.request.method!=='GET'||!allowed.has(e.request.url)||e.request.headers.has('Authorization'))return;
 e.respondWith(fetch(e.request).then(r=>{if(r.ok){const copy=r.clone();e.waitUntil(caches.open(CACHE).then(c=>c.put(e.request,copy)))}return r}).catch(()=>caches.match(e.request)));
});
