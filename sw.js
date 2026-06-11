const CACHE='rz-reader-md-v12-navfix';
const CORE=['./','index.html','assets/styles.css','assets/app.js','content/arcs.json','content/arc-6/arc.json','content/arc-6/volumes.json','content/arc-6/volume-21/chapters.json','content/arc-6/volume-22/chapters.json','content/arc-6/volume-23/chapters.json','content/arc-6/volume-24/chapters.json','content/arc-6/volume-25/chapters.json','content/arc-6/gallery.json','content/ln-extras/arc.json','content/ln-extras/gallery.json','content/ln-extras/volumes.json','manifest.webmanifest'];
self.addEventListener('install',event=>{event.waitUntil(caches.open(CACHE).then(c=>c.addAll(CORE)).then(()=>self.skipWaiting()))});
self.addEventListener('activate',event=>{event.waitUntil(caches.keys().then(keys=>Promise.all(keys.filter(k=>k!==CACHE).map(k=>caches.delete(k)))).then(()=>self.clients.claim()))});
self.addEventListener('fetch',event=>{
  const req=event.request;
  if(req.method!=='GET') return;
  event.respondWith(caches.match(req).then(cached=>cached || fetch(req).then(res=>{
    const copy=res.clone();
    if(new URL(req.url).origin===location.origin){ caches.open(CACHE).then(c=>c.put(req,copy)).catch(()=>{}); }
    return res;
  }).catch(()=>caches.match('index.html'))));
});
