const $ = (sel, root=document) => root.querySelector(sel);
const $$ = (sel, root=document) => Array.from(root.querySelectorAll(sel));
const store = {
  get(k, fallback){ try { return JSON.parse(localStorage.getItem(k)) ?? fallback } catch { return fallback } },
  set(k,v){ localStorage.setItem(k, JSON.stringify(v)) }
};
const APP_KEY = 'rzreader.v2';
const DEFAULT_SETTINGS = {theme:'dark', font:'serif', fontSize:19, lineHeight:1.75, width:780, paragraphGap:.9};
const state = {
  arcs: [], arc: null, chapters: [], volumes: [], gallery: [], extrasVolumes: [], current: 0, activeGalleryVolume: 'all',
  settings: {...DEFAULT_SETTINGS, ...store.get(`${APP_KEY}.settings`, {})},
  progress: {}, bookmarks: store.get(`${APP_KEY}.bookmarks`, []), notes: {}
};
function escapeHTML(s=''){return String(s).replace(/[&<>'"]/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[c]))}
function clamp(n,min,max){return Math.max(min,Math.min(max,n))}
function slugify(s=''){return String(s).toLowerCase().replace(/ё/g,'е').replace(/[^a-zа-я0-9]+/g,'-').replace(/^-|-$/g,'')}
function joinURL(base='', path=''){
  if(/^https?:\/\//i.test(path) || path.startsWith('/')) return path;
  return `${String(base).replace(/\/$/,'')}/${String(path).replace(/^\//,'')}`;
}
async function fetchJSON(path, fallback){
  try{
    const r = await fetch(encodeURI(path), {cache:'no-cache'});
    if(!r.ok) throw new Error(`${r.status} ${path}`);
    return await r.json();
  }catch(err){
    if(arguments.length>1) return fallback;
    throw err;
  }
}

async function fetchText(path, fallback){
  try{
    const r = await fetch(encodeURI(path), {cache:'no-cache'});
    if(!r.ok) throw new Error(`${r.status} ${path}`);
    return await r.text();
  }catch(err){
    if(arguments.length>1) return fallback;
    throw err;
  }
}
function dirname(path=''){ return String(path).split('/').slice(0,-1).join('/'); }
function parseFrontmatter(raw=''){
  const match = String(raw).match(/^---\s*\n([\s\S]*?)\n---\s*\n?/);
  const meta = {};
  let body = String(raw);
  if(match){
    body = body.slice(match[0].length);
    match[1].split(/\r?\n/).forEach(line=>{
      const m = line.match(/^([A-Za-z0-9_-]+):\s*(.*)$/);
      if(!m) return;
      let val = m[2].trim();
      if((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1,-1);
      if(/^\d+$/.test(val)) val = Number(val);
      meta[m[1]] = val;
    });
  }
  return {meta, body};
}
function inlineMarkdown(text=''){
  let t = escapeHTML(text);
  t = t.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '<a href="$2" target="_blank" rel="noopener">$1</a>');
  t = t.replace(/\*\*(.+?)\*\*/g, '<strong>$1</strong>');
  t = t.replace(/(?<!\*)\*(?!\*)(.+?)(?<!\*)\*(?!\*)/g, '<em>$1</em>');
  t = t.replace(/`([^`]+)`/g, '<code>$1</code>');
  return t;
}
function markdownAssetURL(src='', ch={}){
  let raw = String(src).trim().replace(/\\/g,'/');
  if(!raw) return '';
  if(/^(https?:|data:|\/)/i.test(raw)) return raw;
  // Markdown-файлы оставлены байт-в-байт как в исходнике.
  // Старые ссылки ../images/... резолвим в общую папку арки, не меняя сам .md.
  if(raw.startsWith('../images/') && state.arc?.folder){
    return joinURL(state.arc.folder, raw.replace(/^\.\.\//,''));
  }
  return joinURL(ch._srcBase || ch._basePath || '', raw);
}
function markdownToHtml(md='', ch={}){
  const {body} = parseFrontmatter(md);
  const lines = body.split(/\r?\n/);
  const out = [];
  let para = [];
  let skippedTitle = false;
  const closePara = ()=>{
    if(!para.length) return;
    const joined = para.join(' ').replace(/\s+/g,' ').trim();
    para = [];
    if(!joined) return;
    const compact = joined.replace(/\s+/g,'');
    if(compact && [...compact].every(c=>'※＊*·・—-–━═='.includes(c))) out.push(`<div class="ornament" aria-hidden="true">${inlineMarkdown(joined)}</div>`);
    else out.push(`<p>${inlineMarkdown(joined)}</p>`);
  };
  for(const line of lines){
    if(!line.trim()){ closePara(); continue; }
    const img = line.match(/^\s*!\[([^\]]*)\]\(([^)]+)\)\s*$/);
    if(img){
      closePara();
      const alt = img[1] || '';
      const src = markdownAssetURL(img[2], ch);
      if(src) out.push(`<figure class="chapter-figure"><img loading="lazy" decoding="async" src="${escapeHTML(src)}" alt="${escapeHTML(alt)}"><figcaption>${escapeHTML(alt)}</figcaption></figure>`);
      continue;
    }
    if(line.startsWith('#')){
      closePara();
      const level = Math.min(4, Math.max(2, (line.match(/^#+/)?.[0].length || 1) + 1));
      const text = line.replace(/^#+\s*/, '').trim();
      if(!skippedTitle && text && (text === ch.title || text === ch.shortTitle)){ skippedTitle = true; continue; }
      out.push(`<h${level}>${inlineMarkdown(text)}</h${level}>`);
      continue;
    }
    if(line.trim().startsWith('>')){
      closePara();
      out.push(`<blockquote>${inlineMarkdown(line.trim().replace(/^>\s?/,''))}</blockquote>`);
      continue;
    }
    para.push(line);
  }
  closePara();
  return out.join('\n') || '<p class="empty">Глава пустая или не распознана.</p>';
}
function markdownToText(raw=''){
  const {body} = parseFrontmatter(raw);
  return body
    .replace(/!\[[^\]]*\]\([^)]+\)/g, ' ')
    .replace(/```[\s\S]*?```/g, ' ')
    .replace(/[#>*_`\[\]()]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}
async function loadChapterMarkdown(ch){
  if(!ch || ch._markdownLoaded || ch.html) return ch;
  const src = ch.src || ch.file;
  if(!src){ ch.html = ch.text ? `<p>${escapeHTML(ch.text)}</p>` : '<p class="empty">Нет текста главы.</p>'; return ch; }
  const url = /^(https?:|\/|content\/)/i.test(src) ? src : joinURL(ch._basePath || '', src);
  const raw = await fetchText(url, null);
  if(!raw){ ch.html = ch.text ? `<p>${escapeHTML(ch.text)}</p>` : `<p class="empty">Не удалось загрузить Markdown: ${escapeHTML(url)}</p>`; return ch; }
  ch._srcBase = dirname(url);
  const {meta} = parseFrontmatter(raw);
  ch.title = meta.title || ch.title;
  ch.number = meta.chapter_num || ch.number;
  ch.source = meta.source_original || ch.source;
  ch.status = meta.status || ch.status;
  ch.note = meta.translation_note || ch.note;
  ch.text = ch.text || markdownToText(raw);
  ch.words = ch.words || (ch.text.match(/[A-Za-zА-Яа-яЁё0-9]+/g)?.length || 0);
  ch.minutes = ch.minutes || Math.max(1, Math.round(ch.words / 210));
  ch.html = markdownToHtml(raw, ch);
  ch._markdownLoaded = true;
  return ch;
}
async function ensureSearchText(){
  const missing = state.chapters.filter(ch => !ch.text && (ch.src || ch.file));
  if(!missing.length) return;
  await Promise.all(missing.map(ch => loadChapterMarkdown(ch).catch(()=>null)));
}
async function discoverMarkdownChapters(volumeFolder, volume={}){
  const rows = [];
  const start = Number(volume.chapterStart || 1);
  const end = Number(volume.chapterEnd || (start + Number(volume.count || 80) - 1));
  const namesFor = n => [`chapters/chapter-${String(n).padStart(3,'0')}.md`, `chapters/${String(n).padStart(3,'0')}.md`, `chapter-${String(n).padStart(3,'0')}.md`, `${String(n).padStart(3,'0')}.md`];
  for(let n=start; n<=end; n++){
    let found = null, raw = null;
    for(const name of namesFor(n)){
      const url = joinURL(volumeFolder, name);
      raw = await fetchText(url, null);
      if(raw){ found = name; break; }
    }
    if(!raw) continue;
    const {meta} = parseFrontmatter(raw);
    const text = markdownToText(raw);
    const words = text.match(/[A-Za-zА-Яа-яЁё0-9]+/g)?.length || 0;
    rows.push({id:`ch-${String(meta.chapter_num || n).padStart(3,'0')}`, number:meta.chapter_num || n, title:meta.title || `Глава ${n}`, shortTitle:(meta.title || `Глава ${n}`).replace(/^.*?арка,\s*/i,''), slug:slugify(meta.title || `Глава ${n}`), src:found, text, words, minutes:Math.max(1,Math.round(words/210)), format:'markdown'});
  }
  return rows;
}

function progressKey(arcId=state.arc?.id){return `${APP_KEY}.progress.${arcId || 'default'}`}
function notesKey(arcId=state.arc?.id){return `${APP_KEY}.notes.${arcId || 'default'}`}
function lastKey(arcId=state.arc?.id){return `${APP_KEY}.last.${arcId || 'default'}`}
function currentChapter(){return state.chapters[state.current]}
function chapterProgress(ch){
  return clamp(Number(state.progress?.[ch?.id]?.percent || 0), 0, 1);
}
function chapterComplete(ch){ return chapterProgress(ch) >= .985; }
function formatSavedTime(ts){
  if(!ts) return 'ещё не сохранялось';
  try{
    return new Intl.DateTimeFormat('ru-RU', {day:'2-digit', month:'short', hour:'2-digit', minute:'2-digit'}).format(new Date(ts));
  }catch{return 'сохранено'}
}
function arcProgressStats(){
  const total = state.chapters.length;
  if(!total) return {total:0, started:0, completed:0, percent:0, last:null};
  const started = state.chapters.filter(ch => chapterProgress(ch) > .01).length;
  const completed = state.chapters.filter(chapterComplete).length;
  const sum = state.chapters.reduce((acc,ch)=>acc + chapterProgress(ch), 0);
  const percent = total ? sum / total : 0;
  const last = store.get(lastKey(), null) || (store.get(`${APP_KEY}.last`, null)?.arcId === state.arc?.id ? store.get(`${APP_KEY}.last`, null) : null);
  return {total, started, completed, percent, last};
}
function volumeProgressStats(volume){
  const items = state.chapters.filter(ch => String(ch.volumeId)===String(volume?.id) || Number(ch.volume)===Number(volume?.number));
  const total = items.length || volume?.count || 0;
  const completed = items.filter(chapterComplete).length;
  const sum = items.reduce((acc,ch)=>acc + chapterProgress(ch), 0);
  return {total, completed, percent: total ? sum / total : 0};
}
function storeLastReading(percent=getScrollPercent()){
  const ch = currentChapter();
  if(!ch || !state.arc) return null;
  const payload = {
    arcId: state.arc.id,
    arcTitle: arcLabel(),
    chapterId: ch.id,
    chapterNumber: ch.number,
    chapterTitle: ch.title,
    chapterDisplayTitle: chapterDisplayTitle(ch),
    volume: ch.volume || null,
    volumeTitle: ch.volumeTitle || '',
    index: state.current,
    percent: clamp(percent,0,1),
    scrollY: Math.round(scrollY || 0),
    updated: Date.now()
  };
  store.set(`${APP_KEY}.last`, payload);
  store.set(lastKey(), payload);
  return payload;
}
function updateResumeUI(){
  const card = $('#resumeCard');
  const side = $('#sideProgress');
  if(!state.arc || isExtrasMode()){
    if(card) card.hidden = true;
    if(side) side.hidden = true;
    return;
  }
  const stats = arcProgressStats();
  const last = stats.last;
  const pct = Math.round(stats.percent * 100);
  const title = $('#resumeTitle'), meta = $('#resumeMeta'), meter = $('#resumeMeter');
  const sideTitle = $('#sideProgressTitle'), sideMeta = $('#sideProgressMeta'), sideMeter = $('#sideProgressMeter');
  if(side){
    side.hidden = false;
    if(sideTitle) sideTitle.textContent = `${arcLabel()} · общий прогресс`;
    if(sideMeta) sideMeta.textContent = `${pct}% · ${stats.completed} из ${stats.total} глав завершено`;
    if(sideMeter) sideMeter.style.width = `${pct}%`;
  }
  if(!card) return;
  if(last){
    card.hidden = false;
    if(title) title.textContent = `${last.volumeTitle ? `${last.volumeTitle} · ` : ''}${last.chapterDisplayTitle || chapterDisplayTitle({number:last.chapterNumber, title:last.chapterTitle})}`;
    if(meta) meta.textContent = `Остановился на ${Math.round((last.percent || 0)*100)}% · сохранено ${formatSavedTime(last.updated)}`;
    if(meter) meter.style.width = `${Math.round((last.percent || 0)*100)}%`;
  }else if(stats.started){
    card.hidden = false;
    if(title) title.textContent = `Прогресс ${arcLabel()}: ${pct}%`;
    if(meta) meta.textContent = `${stats.started} ${declOfNum(stats.started, ['глава начата','главы начаты','глав начато'])}, ${stats.completed} ${declOfNum(stats.completed, ['завершена','завершены','завершено'])}.`;
    if(meter) meter.style.width = `${pct}%`;
  }else{
    card.hidden = true;
  }
}
function arcLabel(arc=state.arc){return arc?.shortTitle || arc?.title || 'Арка'}
function isExtrasMode(arc=state.arc){return arc?.mode === 'extras'}
function setMainView(view){
  const home=$('#homeHero'), reader=$('#reader'), extras=$('#extrasView');
  if(home) home.hidden = view !== 'home';
  if(reader) reader.hidden = view !== 'reader';
  if(extras) extras.hidden = view !== 'extras';
  updateQuickNav?.();
}
function imageWord(n){return declOfNum(n, ['изображение','изображения','изображений'])}

function chapterCoreTitle(ch={}, explicitNumber=null){
  const n = Number(explicitNumber ?? ch.number ?? 0);
  let t = String(ch.rawTitle || ch.title || ch.shortTitle || '').trim();
  if(!t) return '';
  t = t.replace(/^\s*(?:Арка\s*6|Шестая\s+арка)\s*(?:[—–-]|,)?\s*/iu, '');
  const chapterRe = n
    ? new RegExp(`^\\s*глава\\s*${n}\\s*(?:арки\\s*\\d+)?\\s*[.,:—–-]?\\s*`, 'iu')
    : /^\s*глава\s*\d+\s*(?:арки\s*\d+)?\s*[.,:—–-]?\s*/iu;
  t = t.replace(chapterRe, '');
  t = t.replace(/^\s*[,.:;—–-]+\s*/, '');
  for(let i=0; i<3; i++){
    const before = t;
    t = t.trim().replace(/^["'«»“”„『』「」]+/u, '').replace(/["'«»“”„『』「」]+$/u, '').trim();
    if(t === before) break;
  }
  return t;
}
function chapterDisplayTitle(ch={}){
  const n = ch.number || '';
  const core = chapterCoreTitle(ch, n);
  return core ? `Глава ${n} — ${core}` : `Глава ${n}`;
}
function chapterSearchBlob(ch={}){
  return `${ch.number || ''} ${ch.title || ''} ${ch.shortTitle || ''} ${chapterCoreTitle(ch)} ${chapterDisplayTitle(ch)} ${ch.volumeTitle || ''}`;
}
function buildVolumeSummaries(items=state.gallery){
  const groups = new Map();
  for(const item of items){
    const key = item.volume || 'Без тома';
    if(!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return Array.from(groups.entries()).map(([volume, arr])=>{
    arr.sort((a,b)=>(a.page||0)-(b.page||0));
    return {volume, title: Number(volume) ? `Том ${volume}` : String(volume), count: arr.length, cover: arr[0]?.src || '', items: arr};
  }).sort((a,b)=>(Number(a.volume)||999)-(Number(b.volume)||999));
}
function showToast(msg){const t=$('#toast'); t.textContent=msg; t.classList.add('show'); clearTimeout(showToast._t); showToast._t=setTimeout(()=>t.classList.remove('show'),1800)}

function installImageFallbacks(){
  document.addEventListener('error', e=>{
    const img = e.target;
    if(!(img instanceof HTMLImageElement)) return;
    const src = img.getAttribute('src') || '';
    if(/\.webp(?:$|\?)/i.test(src)){
      const fallback = src.replace(/\.webp($|\?)/i, '.png$1');
      if(fallback !== src){ img.src = fallback; }
    }
  }, true);
}
function applySettings(){
  const s = state.settings;
  document.documentElement.dataset.theme = s.theme;
  const fontMap = {system:'ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', serif:'ui-serif,Georgia,"Times New Roman",serif', sans:'Inter,ui-sans-serif,system-ui,-apple-system,BlinkMacSystemFont,"Segoe UI",sans-serif', mono:'ui-monospace,SFMono-Regular,Menlo,Consolas,monospace'};
  document.documentElement.style.setProperty('--reader-font', fontMap[s.font] || fontMap.serif);
  document.documentElement.style.setProperty('--font-size', `${s.fontSize}px`);
  document.documentElement.style.setProperty('--line-height', s.lineHeight);
  document.documentElement.style.setProperty('--reader-width', `${s.width}px`);
  document.documentElement.style.setProperty('--paragraph-gap', `${s.paragraphGap}em`);
  $('#themeSelect').value=s.theme; $('#fontSelect').value=s.font; $('#fontSize').value=s.fontSize; $('#lineHeight').value=s.lineHeight; $('#contentWidth').value=s.width; $('#paragraphGap').value=s.paragraphGap;
  $('#fontSizeOut').textContent = `${s.fontSize}px`; $('#lineHeightOut').textContent=s.lineHeight; $('#widthOut').textContent=`${s.width}px`; $('#paraOut').textContent=`${s.paragraphGap}em`;
}
function saveSettings(){store.set(`${APP_KEY}.settings`, state.settings); applySettings()}
function normalizeArc(arc, fallbackFolder=''){
  const folder = arc.folder || fallbackFolder || `content/arc-${arc.number || arc.id || ''}`;
  const id = arc.id || (arc.number ? `arc-${arc.number}` : slugify(arc.title || folder));
  const mode = arc.mode || arc.type || (arc.chapters === null || arc.chapters === false ? 'extras' : 'chapters');
  return {
    id,
    mode,
    order: arc.order ?? arc.number ?? (mode === 'extras' ? 99 : 999),
    number: arc.number ?? Number(String(id).match(/\d+/)?.[0] || 0),
    title: arc.title || `Арка ${arc.number || id}`,
    shortTitle: arc.shortTitle || (arc.number ? `Арка ${arc.number}` : arc.title || id),
    status: arc.status || 'Добавлена',
    description: arc.description || '',
    folder,
    chapters: mode === 'extras' ? (arc.chapters ?? null) : (arc.chapters || 'chapters.json'),
    volumes: mode === 'extras' ? null : (arc.volumes || null),
    gallery: arc.gallery || 'gallery.json',
    chapterCount: arc.chapterCount || 0,
    volumeCount: arc.volumeCount || 0,
    itemCount: arc.itemCount || 0,
    volumeRange: arc.volumeRange || '',
    cover: arc.cover || ''
  };
}
async function loadArcIndex(){
  const manifest = await fetchJSON('content/arcs.json', {defaultArc:'arc-6', arcs:[]});
  const map = new Map();
  for(const a of manifest.arcs || []){
    const arc = normalizeArc(a);
    map.set(arc.id, arc);
  }
  const probes = [];
  for(let n=1; n<=12; n++){
    probes.push(`content/arc-${n}/arc.json`, `content/${n} arc/arc.json`, `content/arc ${n}/arc.json`, `content/${n}-arc/arc.json`);
  }
  const results = await Promise.allSettled(probes.map(async p=>({path:p, data:await fetchJSON(p)})));
  for(const res of results){
    if(res.status !== 'fulfilled') continue;
    const folder = res.value.path.replace(/\/arc\.json$/,'');
    const arc = normalizeArc({...res.value.data, folder: res.value.data.folder || folder}, folder);
    if(!map.has(arc.id)) map.set(arc.id, arc);
  }
  state.arcs = Array.from(map.values()).sort((a,b)=>(a.order ?? a.number ?? 999)-(b.order ?? b.number ?? 999) || a.title.localeCompare(b.title, 'ru'));
  if(!state.arcs.length){
    // Legacy fallback for the first version of the reader.
    state.arcs = [normalizeArc({id:'arc-6', number:6, title:'Арка 6', shortTitle:'Арка 6', folder:'data', chapters:'chapters.json', gallery:'gallery.json'})];
  }
  const defaultArc = manifest.defaultArc || state.arcs[0].id;
  renderArcPicker(defaultArc);
  return defaultArc;
}
function renderArcPicker(defaultArc){
  const select = $('#arcSelect');
  if(select){
    select.innerHTML = state.arcs.map(a=>`<option value="${escapeHTML(a.id)}">${escapeHTML(a.shortTitle || a.title)}${a.status ? ` · ${escapeHTML(a.status)}` : ''}</option>`).join('');
    select.value = state.arcs.some(a=>a.id===defaultArc) ? defaultArc : state.arcs[0]?.id;
  }
  renderArcCards();
}
function renderArcCards(){
  const grid = $('#arcGrid');
  if(!grid) return;
  grid.innerHTML = state.arcs.map(a=>{
    const firstLine = isExtrasMode(a)
      ? [a.itemCount ? `${a.itemCount} ${imageWord(a.itemCount)}` : '', a.volumeRange || ''].filter(Boolean).join(' · ')
      : [a.chapterCount ? `${a.chapterCount} глав` : '', a.volumeCount ? `${a.volumeCount} ${declOfNum(a.volumeCount, ['том','тома','томов'])}` : '', a.volumeRange || ''].filter(Boolean).join(' · ');
    return `
      <button class="arc-card ${isExtrasMode(a) ? 'extras-card-button' : ''}" data-arc="${escapeHTML(a.id)}">
        <span class="arc-kicker">${escapeHTML(a.status || (isExtrasMode(a) ? 'Экстры' : 'Арка'))}</span>
        <strong>${escapeHTML(a.title)}</strong>
        <small>${escapeHTML(firstLine)}</small>
        <p>${escapeHTML(a.description || (isExtrasMode(a) ? 'Открыть дополнительные материалы по томам.' : 'Нажми, чтобы открыть эту арку.'))}</p>
      </button>
    `;
  }).join('');
  $$('.arc-card', grid).forEach(card=>card.addEventListener('click', async ()=>{
    await openArc(card.dataset.arc, {home:true, pushHash:true});
    showToast(`${arcLabel()} выбрана`);
  }));
}

function volumeForChapter(ch){
  if(!ch) return null;
  return state.volumes.find(v => String(v.id)===String(ch.volumeId) || Number(v.number)===Number(ch.volume));
}
function renderVolumeOverview(){
  const box = $('#volumeOverview');
  if(!box) return;
  if(isExtrasMode() || !state.volumes.length){ box.hidden = true; box.innerHTML = ''; return; }
  box.hidden = false;
  box.innerHTML = `
    <div class="volume-overview-head">
      <span class="arc-kicker">Тома арки</span>
      <strong>${escapeHTML(arcLabel())} разложена по томам</strong>
    </div>
    <div class="volume-overview-grid">
      ${state.volumes.map(v=>{
        const vp = volumeProgressStats(v);
        const pct = Math.round(vp.percent * 100);
        return `
        <button class="volume-chip-card" data-volume="${escapeHTML(v.id)}">
          ${v.cover ? `<img loading="lazy" src="${escapeHTML(v.cover)}" alt="${escapeHTML(v.title || `Том ${v.number}`)}">` : ''}
          <span>${escapeHTML(v.title || `Том ${v.number}`)}</span>
          <small>${escapeHTML(v.range || `${v.count || 0} ${declOfNum(v.count || 0, ['глава','главы','глав'])}`)}</small>
          <div class="meter"><span style="width:${pct}%"></span></div>
          <div class="volume-progress-line"><small>${pct}% прочитано</small><small>${vp.completed}/${vp.total}</small></div>
        </button>`;
      }).join('')}
    </div>`;
  $$('.volume-chip-card', box).forEach(card=>card.addEventListener('click',()=>{
    const vol = state.volumes.find(v => String(v.id)===String(card.dataset.volume));
    const first = state.chapters.find(c => String(c.volumeId)===String(vol?.id) || Number(c.volume)===Number(vol?.number));
    if(first){ openChapter(state.chapters.indexOf(first)); }
  }));
}

async function openArc(arcId, opts={}){
  const arc = state.arcs.find(a => a.id===arcId || String(a.number)===String(arcId)) || state.arcs[0];
  if(!arc) return;
  state.arc = arc; state.current = 0; state.activeGalleryVolume = 'all';
  const folder = arc.folder || `content/${arc.id}`;
  const galleryURL = joinURL(folder, arc.gallery || 'gallery.json');
  const wantsExtras = isExtrasMode(arc);
  const chaptersURL = wantsExtras ? null : joinURL(folder, arc.chapters || 'chapters.json');
  const volumesURL = wantsExtras ? null : joinURL(folder, arc.volumes || 'volumes.json');
  const [rawVolumes, rawChapters, gallery] = await Promise.all([
    wantsExtras ? Promise.resolve(null) : fetchJSON(volumesURL, null),
    wantsExtras ? Promise.resolve([]) : (arc.volumes ? Promise.resolve([]) : fetchJSON(chaptersURL, [])),
    fetchJSON(galleryURL, [])
  ]);
  let chapterRows = Array.isArray(rawChapters) ? rawChapters : [];
  state.volumes = [];
  if(!wantsExtras && Array.isArray(rawVolumes) && rawVolumes.length){
    const loadedVolumes = await Promise.all(rawVolumes.map(async (v)=>{
      const number = v.number || Number(String(v.id || '').match(/\d+/)?.[0] || 0);
      const id = v.id || `volume-${number || state.volumes.length+1}`;
      const volumeFolder = joinURL(folder, v.folder || id);
      const chapterPath = joinURL(folder, v.chapters || `${id}/chapters.json`);
      const data = await fetchJSON(chapterPath, null);
      let chaptersData = Array.isArray(data) ? data : [];
      if(!chaptersData.length && v.autoDiscover !== false){
        chaptersData = await discoverMarkdownChapters(volumeFolder, {...v, id, number});
      }
      chaptersData = chaptersData.map(ch => ({...ch, _basePath: volumeFolder}));
      return {
        ...v, id, number, title: v.title || `Том ${number}`, shortTitle: v.shortTitle || `Том ${number}`,
        count: chaptersData.length || v.count || 0,
        chapterStart: v.chapterStart ?? chaptersData[0]?.number,
        chapterEnd: v.chapterEnd ?? chaptersData.at(-1)?.number,
        chaptersData
      };
    }));
    state.volumes = loadedVolumes.map(({chaptersData, ...v})=>v);
    chapterRows = loadedVolumes.flatMap(v => v.chaptersData.map((ch, idx)=>({
      ...ch,
      volume: ch.volume ?? v.number,
      volumeId: ch.volumeId || v.id,
      volumeTitle: ch.volumeTitle || v.title || `Том ${v.number}`,
      volumeRange: ch.volumeRange || v.range || '',
      chapterInVolume: ch.chapterInVolume || idx + 1
    })));
  }
  state.gallery = Array.isArray(gallery) ? gallery : [];
  state.extrasVolumes = buildVolumeSummaries(state.gallery);
  state.chapters = wantsExtras ? [] : (Array.isArray(chapterRows) ? chapterRows : []).map((ch, i)=>({
    ...ch,
    id: ch.id || `ch-${String(i+1).padStart(3,'0')}`,
    number: ch.number || i+1,
    rawTitle: ch.rawTitle || ch.title || ch.shortTitle || `Глава ${i+1}`,
    shortTitle: ch.shortTitle || ch.title || `Глава ${i+1}`,
    title: ch.title || `Глава ${i+1}`,
    text: ch.text || '',
    html: ch.html || '',
    src: ch.src || ch.file || '',
    format: ch.format || (ch.src || ch.file ? 'markdown' : 'html'),
    _basePath: ch._basePath || folder,
    volume: ch.volume || volumeForChapter(ch)?.number || null,
    volumeId: ch.volumeId || volumeForChapter(ch)?.id || null,
    volumeTitle: ch.volumeTitle || volumeForChapter(ch)?.title || '',
    chapterInVolume: ch.chapterInVolume || null,
    arcId: arc.id
  }));
  state.progress = store.get(progressKey(arc.id), {});
  state.notes = store.get(notesKey(arc.id), {});
  if(!wantsExtras && arc.chapterCount !== state.chapters.length){ arc.chapterCount = state.chapters.length; renderArcCards(); }
  if(!wantsExtras && state.volumes.length && arc.volumeCount !== state.volumes.length){ arc.volumeCount = state.volumes.length; renderArcCards(); }
  if(wantsExtras && arc.itemCount !== state.gallery.length){ arc.itemCount = state.gallery.length; renderArcCards(); }
  const mainCount = wantsExtras
    ? `${state.gallery.length} ${imageWord(state.gallery.length)}`
    : `${state.chapters.length} ${declOfNum(state.chapters.length, ['глава','главы','глав'])}${state.volumes.length ? ` · ${state.volumes.length} ${declOfNum(state.volumes.length, ['том','тома','томов'])}` : ''}`;
  $('#chapterCount').textContent = `${arcLabel()} · ${mainCount}`;
  $('#activeArcTitle').textContent = arcLabel();
  $('#activeArcStatus').textContent = arc.status || '';
  $('#brandArcLabel').textContent = wantsExtras ? `${arcLabel()} · материалы` : `${arcLabel()} · читалка`;
  $('#homeArcTitle').textContent = arc.title;
  $('#homeArcDescription').textContent = arc.description || 'Выбери арку, затем начни чтение или продолжи с прошлого места.';
  $('#startBtn').textContent = wantsExtras ? 'Открыть экстры' : 'Начать выбранную арку';
  $('#heroResumeBtn').hidden = wantsExtras;
  if($('#arcSelect')) $('#arcSelect').value = arc.id;
  buildToc(); buildGalleryTabs(); renderBookmarks(); renderExtras(); renderVolumeOverview(); updateResumeUI();
  if(opts.pushHash) history.pushState(null,'',`#${arc.id}`);
  if(wantsExtras){
    setMainView('extras');
    document.title = `${arc.title} | Re:Zero Читалка`;
    updateProgressUI();
    return;
  }
  $('#heroResumeBtn').hidden = false;
  if(opts.home){
    setMainView('home'); updateProgressUI(); document.title = `${arc.title} | Re:Zero Читалка`;
  }
}
function declOfNum(n, words){
  n=Math.abs(n)%100; const n1=n%10;
  if(n>10 && n<20) return words[2];
  if(n1>1 && n1<5) return words[1];
  if(n1===1) return words[0];
  return words[2];
}
function buildToc(filter=''){
  const q = filter.trim().toLowerCase(); const toc=$('#toc');
  if(isExtrasMode()){
    const vols = state.extrasVolumes.filter(v => !q || `${v.title} ${v.volume}`.toLowerCase().includes(q));
    toc.innerHTML = `<a href="#${state.arc.id}" data-extra-vol="all"><span class="num">✦</span><span class="title">Все экстры</span><span class="mini-progress"><span style="width:100%"></span></span></a>` + vols.map(v=>`
      <a href="#${state.arc.id}/volume-${v.volume}" data-extra-vol="${escapeHTML(v.volume)}"><span class="num">${escapeHTML(v.volume)}</span><span class="title">${escapeHTML(v.title)} · ${v.count}</span><span class="mini-progress"><span style="width:100%"></span></span></a>
    `).join('') || '<p class="empty">Ничего не найдено.</p>';
    $$('[data-extra-vol]',toc).forEach(a=>a.addEventListener('click',e=>{
      e.preventDefault();
      history.pushState(null,'', a.getAttribute('href'));
      selectExtrasVolume(a.dataset.extraVol || 'all');
      setMainView('extras');
      if(innerWidth<760) $('#sidebar').classList.add('closed');
    }));
    markActiveToc();
    return;
  }
  const filtered = state.chapters.filter(ch => !q || chapterSearchBlob(ch).toLowerCase().includes(q));
  let lastVolume = null;
  toc.innerHTML = filtered.map((ch)=>{
    const i = state.chapters.indexOf(ch);
    const p = Math.round(((state.progress[ch.id]?.percent)||0)*100);
    const vol = volumeForChapter(ch);
    const volKey = ch.volumeId || ch.volume || '';
    const header = volKey && volKey !== lastVolume ? (()=>{
      lastVolume = volKey;
      const label = escapeHTML(vol?.title || ch.volumeTitle || `Том ${ch.volume}`);
      const range = escapeHTML(vol?.range || ch.volumeRange || '');
      return `<div class="toc-volume"><span>${label}</span>${range ? `<small>${range}</small>` : ''}</div>`;
    })() : '';
    return `${header}<a href="#${state.arc.id}/${ch.id}" data-index="${i}"><span class="num">${String(ch.number).padStart(2,'0')}</span><span class="title">${escapeHTML(chapterDisplayTitle(ch))}${ch.volume ? `<small>Том ${escapeHTML(ch.volume)}</small>` : ''}</span><span class="mini-progress"><span style="width:${p}%"></span></span></a>`;
  }).join('') || '<p class="empty">Ничего не найдено.</p>';
  $$('.toc a',toc).forEach(a=>a.addEventListener('click',()=>{ if(innerWidth<760) $('#sidebar').classList.add('closed') }));
  markActiveToc();
}
function markActiveToc(){ $$('.toc a').forEach(a=>{ const isExtra=a.dataset.extraVol!=null; a.classList.toggle('active', isExtra ? String(a.dataset.extraVol)===String(state.activeGalleryVolume) : Number(a.dataset.index)===state.current); }); }
function findArcBySlug(s){
  const raw = String(s || '').trim();
  return state.arcs.find(a => a.id===raw || String(a.number)===raw || slugify(a.title)===slugify(raw) || slugify(a.shortTitle)===slugify(raw));
}
function routeFromHash(){
  const hash = decodeURIComponent(location.hash.replace('#','')).trim();
  if(!hash) return null;
  if(!hash.includes('/')){
    const arcOnly = findArcBySlug(hash);
    if(arcOnly) return {arcId:arcOnly.id, chapter:null};
    return state.arc ? {arcId:state.arc.id, chapter:hash} : null;
  }
  const [arcPart, chapterPart] = hash.split('/');
  const arc = findArcBySlug(arcPart);
  if(!arc) return null;
  return {arcId:arc.id, chapter:chapterPart || null};
}
function chapterIndexFromRouteChapter(part){
  if(!part) return null;
  const i = state.chapters.findIndex(ch => ch.id===part || String(ch.number)===part || ch.slug===part);
  return i >= 0 ? i : null;
}
async function openChapter(index, opts={}){
  if(!state.chapters.length) return;
  state.current = clamp(index,0,state.chapters.length-1);
  const ch = currentChapter();
  setMainView('reader');
  $('#chapterContent').innerHTML = '<p class="empty">Загружаю Markdown-главу…</p>';
  await loadChapterMarkdown(ch);
  if(location.hash !== `#${state.arc.id}/${ch.id}` && !opts.silentHash) history.pushState(null,'',`#${state.arc.id}/${ch.id}`);
  const displayTitle = chapterDisplayTitle(ch);
  document.title = `${displayTitle} | ${arcLabel()} | Re:Zero`;
  const vol = volumeForChapter(ch);
  const volMeta = vol ? `${vol.title || `Том ${vol.number}`} · ` : '';
  const inVolMeta = vol && ch.chapterInVolume ? ` · в томе ${ch.chapterInVolume} из ${vol.count || '?'}` : '';
  $('#chapterMeta').textContent = `${arcLabel()} · ${volMeta}глава ${ch.number} из ${state.chapters.length}${inVolMeta}`;
  $('#readStats').textContent = `≈ ${ch.minutes || Math.max(1, Math.round((ch.words || 0)/220))} мин · ${(ch.words || 0).toLocaleString('ru-RU')} слов`;
  $('#chapterTitle').textContent = displayTitle;
  $('#chapterContent').innerHTML = ch.html;
  $('#prevChapter').disabled = state.current===0; $('#nextChapter').disabled = state.current===state.chapters.length-1;
  $('#chapterNote').value = state.notes[ch.id] || '';
  const rememberedPercent = state.progress[ch.id]?.percent || 0;
  storeLastReading(opts.percent ?? (opts.restore ? rememberedPercent : 0));
  markActiveToc(); attachImageHandlers(); updateProgressUI(); updateResumeUI();
  requestAnimationFrame(()=>{
    if(opts.percent != null) scrollToPercent(opts.percent);
    else if(opts.restore){ scrollToPercent(state.progress[ch.id]?.percent || 0); }
    else window.scrollTo({top:0, behavior:'instant'});
  });
}
function chapterScrollable(){ const doc = document.documentElement; return Math.max(1, doc.scrollHeight - innerHeight); }
function getScrollPercent(){ return clamp(scrollY / chapterScrollable(), 0, 1) }
function scrollToPercent(p){ window.scrollTo({top: chapterScrollable()*clamp(p,0,1), behavior:'instant'}); updateProgressUI() }
function updateProgressUI(){
  if($('#reader').hidden){ $('#topProgress').style.width='0%'; updateQuickNav(); return }
  const p = getScrollPercent();
  $('#topProgress').style.width = `${p*100}%`; $('#chapterMeter').style.width = `${p*100}%`; $('#chapterPercent').textContent = `${Math.round(p*100)}%`;
  const status = $('#saveStatus');
  const saved = currentChapter() ? state.progress[currentChapter().id]?.updated : null;
  if(status) status.textContent = saved ? `Сохранено локально: ${formatSavedTime(saved)}` : 'Автосохранение включено';
  updateQuickNav();
}

function isReaderOpen(){ return !!$('#reader') && !$('#reader').hidden && !!currentChapter(); }
function scrollToTopFast(){ window.scrollTo({top:0, behavior:'smooth'}); }
function updateQuickNav(){
  const readerOpen = isReaderOpen();
  const atFirst = !readerOpen || state.current <= 0;
  const atLast = !readerOpen || state.current >= state.chapters.length - 1;
  const prev = $('#mobilePrev'); const next = $('#mobileNext'); const top = $('#mobileTop'); const up = $('#scrollTopBtn');
  if(prev) prev.disabled = atFirst;
  if(next) next.disabled = atLast;
  if(top) top.disabled = !readerOpen && scrollY < 20;
  if(up) up.classList.toggle('show', scrollY > 360);
  document.body.classList.toggle('reader-active', readerOpen);
}
function saveProgress(){
  if($('#reader').hidden || !currentChapter() || !state.arc) return;
  const ch = currentChapter(); const p = getScrollPercent(); const now = Date.now();
  state.progress[ch.id] = {
    percent:p,
    updated:now,
    arcId:state.arc.id,
    chapterId:ch.id,
    chapterNumber:ch.number,
    title:ch.title,
    volume:ch.volume || null,
    volumeTitle:ch.volumeTitle || '',
    index:state.current,
    scrollY:Math.round(scrollY || 0)
  };
  store.set(progressKey(), state.progress);
  storeLastReading(p);
  const active = $(`.toc a[data-index="${state.current}"] .mini-progress span`); if(active) active.style.width = `${Math.round(p*100)}%`;
  updateResumeUI(); renderVolumeOverview(); updateProgressUI();
}
function debounce(fn, wait=160){let t; return (...args)=>{clearTimeout(t); t=setTimeout(()=>fn(...args),wait)}}
function openDrawer(id){$(id).hidden=false; const input=$(`${id} input`); if(input) setTimeout(()=>input.focus(),50)}
function closeDrawers(){ $$('.drawer').forEach(d=>d.hidden=true); }
async function searchChapters(query){
  const q = query.trim().toLowerCase(); const box=$('#searchResults');
  if(isExtrasMode() || !state.chapters.length){ box.innerHTML = '<p class="empty">В разделе «Экстры» нет текстовых глав — открой галерею или выбери том.</p>'; return; }
  if(q.length < 2){ box.innerHTML = `<p class="empty">Введите минимум 2 символа. Поиск сейчас идёт по выбранной арке: ${escapeHTML(arcLabel())}.</p>`; return; }
  await ensureSearchText();
  const results=[];
  for(const ch of state.chapters){
    const title = chapterSearchBlob(ch).toLowerCase(); const text = (ch.text || '').toLowerCase();
    let idx = text.indexOf(q); let titleHit = title.includes(q);
    if(idx>=0 || titleHit){
      if(idx<0) idx=0;
      const start=Math.max(0,idx-95), end=Math.min((ch.text || '').length,idx+q.length+145);
      let snip=escapeHTML((ch.text || '').slice(start,end));
      const re = new RegExp(`(${query.replace(/[.*+?^${}()|[\]\\]/g,'\\$&')})`, 'ig');
      snip=snip.replace(re,'<span class="mark">$1</span>');
      results.push({ch, snip, score:(titleHit?10:0)+(idx>=0?1:0)});
    }
  }
  results.sort((a,b)=>b.score-a.score || a.ch.number-b.ch.number);
  box.innerHTML = results.slice(0,35).map(r=>`<div class="result-card" data-id="${r.ch.id}"><strong>${escapeHTML(chapterDisplayTitle(r.ch))}</strong><small>${r.ch.volume ? `Том ${escapeHTML(r.ch.volume)} · ` : ''}Глава ${escapeHTML(r.ch.number)}</small><p>…${r.snip}…</p></div>`).join('') || '<p class="empty">Совпадений нет.</p>';
  $$('.result-card',box).forEach(el=>el.addEventListener('click',()=>{ const i=state.chapters.findIndex(c=>c.id===el.dataset.id); closeDrawers(); openChapter(i); }));
}
function addBookmark(){
  const ch=currentChapter(); if(!ch || !state.arc) return;
  const selected = String(getSelection()?.toString() || '').trim().replace(/\s+/g,' ').slice(0,240);
  const bm = {id:crypto.randomUUID?.() || String(Date.now()), arcId:state.arc.id, arcTitle:arcLabel(), chapterId:ch.id, chapterNumber:ch.number, volume:ch.volume || null, volumeTitle:ch.volumeTitle || '', title:chapterDisplayTitle(ch), rawTitle:ch.title, percent:getScrollPercent(), quote:selected, created:Date.now()};
  state.bookmarks.unshift(bm); store.set(`${APP_KEY}.bookmarks`, state.bookmarks); renderBookmarks(); showToast(selected?'Закладка с цитатой добавлена':'Закладка добавлена');
}
function renderBookmarks(){
  const box=$('#bookmarksList');
  const list = state.bookmarks;
  if(!list.length){ box.innerHTML='<p class="empty">Закладок пока нет. Нажми «★ Закладка» во время чтения.</p>'; return; }
  box.innerHTML=list.map(b=>`<div class="bookmark-card" data-id="${b.id}"><strong>${escapeHTML(b.title)}</strong><p>${escapeHTML(b.arcTitle || b.arcId || 'Арка')}${b.volume ? ` · Том ${escapeHTML(b.volume)}` : ''} · ${Math.round(b.percent*100)}% · ${new Date(b.created).toLocaleDateString('ru-RU')}</p>${b.quote?`<p>“${escapeHTML(b.quote)}”</p>`:''}<button class="ghost-btn danger" data-del="${b.id}">Удалить</button></div>`).join('');
  $$('.bookmark-card',box).forEach(card=>card.addEventListener('click',async e=>{
    if(e.target.matches('[data-del]')) return;
    const b=state.bookmarks.find(x=>x.id===card.dataset.id); if(!b) return;
    if(!state.arc || b.arcId !== state.arc.id) await openArc(b.arcId || state.arcs[0].id);
    const i=state.chapters.findIndex(c=>c.id===b.chapterId || c.number===b.chapterNumber);
    closeDrawers(); openChapter(i>=0?i:0,{percent:b.percent});
  }));
  $$('[data-del]',box).forEach(btn=>btn.addEventListener('click',e=>{ e.stopPropagation(); state.bookmarks=state.bookmarks.filter(b=>b.id!==btn.dataset.del); store.set(`${APP_KEY}.bookmarks`,state.bookmarks); renderBookmarks(); }));
}
function saveNote(){ const ch=currentChapter(); if(!ch || !state.arc) return; const val=$('#chapterNote').value; if(val) state.notes[ch.id]=val; else delete state.notes[ch.id]; store.set(notesKey(), state.notes); }
function renderExtras(){
  const view = $('#extrasView');
  if(!view) return;
  if(!isExtrasMode()) { view.hidden = true; return; }
  const total = state.gallery.length;
  const volumes = state.extrasVolumes;
  $('#extrasTitle').textContent = state.arc.title;
  $('#extrasDescription').textContent = state.arc.description || 'Дополнительные материалы по томам.';
  $('#extrasStats').innerHTML = `<span>${total} ${imageWord(total)}</span><span>${volumes.length} ${declOfNum(volumes.length, ['том','тома','томов'])}</span>${state.arc.volumeRange ? `<span>${escapeHTML(state.arc.volumeRange)}</span>` : ''}`;
  $('#extrasVolumeCards').innerHTML = volumes.map(v=>`
    <button class="extras-volume-card" data-vol="${escapeHTML(v.volume)}">
      ${v.cover ? `<img loading="lazy" src="${escapeHTML(v.cover)}" alt="${escapeHTML(v.title)}">` : ''}
      <span class="arc-kicker">${escapeHTML(v.count)} ${imageWord(v.count)}</span>
      <strong>${escapeHTML(v.title)}</strong>
      <small>Открыть материалы этого тома</small>
    </button>
  `).join('') || '<p class="empty">Экстры пока не добавлены.</p>';
  $$('.extras-volume-card').forEach(card=>card.addEventListener('click',()=>{
    history.pushState(null,'',`#${state.arc.id}/volume-${card.dataset.vol}`);
    selectExtrasVolume(card.dataset.vol);
    $('#extrasBrowserAnchor')?.scrollIntoView({behavior:'smooth'});
  }));
  renderExtrasTabs();
  renderExtrasGrid();
}
function renderExtrasTabs(){
  const tabs = $('#extrasTabs');
  if(!tabs) return;
  tabs.innerHTML = `<button class="tab ${state.activeGalleryVolume==='all'?'active':''}" data-vol="all">Все</button>` + state.extrasVolumes.map(v=>`<button class="tab ${String(state.activeGalleryVolume)===String(v.volume)?'active':''}" data-vol="${escapeHTML(v.volume)}">${escapeHTML(v.title)}</button>`).join('');
  $$('.tab', tabs).forEach(t=>t.addEventListener('click',()=>{
    history.pushState(null,'', t.dataset.vol==='all' ? `#${state.arc.id}` : `#${state.arc.id}/volume-${t.dataset.vol}`);
    selectExtrasVolume(t.dataset.vol);
  }));
  markActiveToc();
}
function selectExtrasVolume(volume='all'){
  state.activeGalleryVolume = String(volume || 'all');
  renderExtrasTabs();
  renderExtrasGrid();
  buildGalleryTabs();
}
function renderExtrasGrid(){
  const grid = $('#extrasGrid');
  if(!grid) return;
  const vol = String(state.activeGalleryVolume || 'all');
  const items = state.gallery.filter(g => vol==='all' || String(g.volume)===vol);
  const title = vol==='all' ? 'Все экстры' : `Экстры — том ${vol}`;
  $('#extrasGalleryTitle').textContent = `${title} · ${items.length} ${imageWord(items.length)}`;
  grid.innerHTML = items.map(g=>`<div class="gallery-card" data-src="${escapeHTML(g.src)}"><img loading="lazy" src="${escapeHTML(g.src)}" alt="${escapeHTML(g.caption)}"><small>${escapeHTML(g.caption)}</small></div>`).join('') || '<p class="empty">В этом томе пока нет материалов.</p>';
  $$('.gallery-card', grid).forEach(card=>card.addEventListener('click',()=>openLightbox(card.dataset.src, card.querySelector('img').alt)));
  markActiveToc();
}
function buildGalleryTabs(){
  const vols=[...new Set(state.gallery.map(g=>g.volume).filter(Boolean))].sort((a,b)=>a-b);
  $('#galleryTabs').innerHTML = `<button class="tab ${state.activeGalleryVolume==='all'?'active':''}" data-vol="all">Все</button>` + vols.map(v=>`<button class="tab ${String(state.activeGalleryVolume)===String(v)?'active':''}" data-vol="${v}">Том ${v}</button>`).join('') + (!isExtrasMode() && state.gallery.some(g=>g.type==='extra') ? `<button class="tab ${state.activeGalleryVolume==='extra'?'active':''}" data-vol="extra">Extras</button>` : '');
  $$('.tab', $('#galleryTabs')).forEach(t=>t.addEventListener('click',()=>{ state.activeGalleryVolume=t.dataset.vol; $$('.tab', $('#galleryTabs')).forEach(x=>x.classList.toggle('active',x===t)); if(isExtrasMode()){ renderExtrasTabs(); renderExtrasGrid(); } renderGallery(); }));
  renderGallery();
}
function renderGallery(){
  const vol=state.activeGalleryVolume;
  let items = state.gallery.filter(g => vol==='all' || (vol==='extra'?g.type==='extra':String(g.volume)===String(vol)));
  $('#galleryGrid').innerHTML = items.map(g=>`<div class="gallery-card" data-src="${g.src}"><img loading="lazy" src="${g.src}" alt="${escapeHTML(g.caption)}"><small>${escapeHTML(g.caption)}</small></div>`).join('') || `<p class="empty">Для ${escapeHTML(arcLabel())} галерея пока не добавлена.</p>`;
  $$('.gallery-card').forEach(card=>card.addEventListener('click',()=>openLightbox(card.dataset.src, card.querySelector('img').alt)));
}
function openLightbox(src, alt=''){ const lb=$('#lightbox'); $('img',lb).src=src; $('img',lb).alt=alt; lb.hidden=false; }
function attachImageHandlers(){ $$('#chapterContent img').forEach(img=>img.addEventListener('click',()=>openLightbox(img.currentSrc||img.src,img.alt))); }
async function resume(preferCurrentArc=false){
  let last = preferCurrentArc ? store.get(lastKey(), null) : store.get(`${APP_KEY}.last`, null);
  if(!last && state.arc) last = store.get(lastKey(), null);
  let i=0;
  if(last?.arcId && (!state.arc || last.arcId !== state.arc.id)) await openArc(last.arcId);
  if(last) i = state.chapters.findIndex(c=>c.id===last.chapterId || c.id===last.id || c.number===last.index+1 || c.number===last.chapterNumber);
  if(i<0) i=0;
  await openChapter(i, {restore:true, percent:last?.percent});
}
async function init(){
  installImageFallbacks();
  applySettings();
  const defaultArc = await loadArcIndex();
  const route = routeFromHash();
  const initialArcId = route?.arcId || store.get(`${APP_KEY}.last`, null)?.arcId || defaultArc;
  await openArc(initialArcId, {home:true});
  if(route?.chapter){
    if(isExtrasMode()){
      const vol = String(route.chapter).match(/\d+/)?.[0] || 'all';
      selectExtrasVolume(vol); setMainView('extras');
    }else{
      const i = chapterIndexFromRouteChapter(route.chapter);
      if(i != null) await openChapter(i,{silentHash:true, restore:true}); else setMainView('home');
    }
  }else{
    setMainView(isExtrasMode() ? 'extras' : 'home');
  }
  $('#startBtn').addEventListener('click',()=>{ if(isExtrasMode()) setMainView('extras'); else openChapter(0); }); $('#heroResumeBtn').addEventListener('click',()=>resume(true)); $('#resumeBtn').addEventListener('click',()=>resume(false)); $('#resumeCardBtn')?.addEventListener('click',()=>resume(true));
  $('#prevChapter').addEventListener('click',()=>openChapter(state.current-1)); $('#nextChapter').addEventListener('click',()=>openChapter(state.current+1));
  $('#mobileToc')?.addEventListener('click',()=>$('#sidebar').classList.toggle('closed')); $('#mobilePrev')?.addEventListener('click',()=>openChapter(state.current-1)); $('#mobileNext')?.addEventListener('click',()=>openChapter(state.current+1));
  $('#mobileTop')?.addEventListener('click',scrollToTopFast); $('#scrollTopBtn')?.addEventListener('click',scrollToTopFast); $('#mobileSettings')?.addEventListener('click',()=>openDrawer('#settingsDrawer'));
  $('#addBookmark').addEventListener('click',addBookmark); $('#toggleNotes').addEventListener('click',()=>$('#chapterNote').focus());
  $('#chapterNote').addEventListener('input', debounce(saveNote,250));
  $('#toggleSidebar').addEventListener('click',()=>$('#sidebar').classList.toggle('closed')); $('#closeSidebar').addEventListener('click',()=>$('#sidebar').classList.add('closed'));
  $('#tocFilter').addEventListener('input',e=>buildToc(e.target.value));
  $('#arcSelect').addEventListener('change',async e=>{ await openArc(e.target.value,{home:true,pushHash:true}); });
  $('#openSearch').addEventListener('click',()=>openDrawer('#searchDrawer')); $('#openSettings').addEventListener('click',()=>openDrawer('#settingsDrawer')); $('#openBookmarks').addEventListener('click',()=>{renderBookmarks();openDrawer('#bookmarksDrawer')}); $('#openGallery').addEventListener('click',()=>openDrawer('#galleryDrawer')); $('#openExtrasGallery')?.addEventListener('click',()=>openDrawer('#galleryDrawer'));
  $$('[data-close]').forEach(b=>b.addEventListener('click',closeDrawers)); $$('.drawer').forEach(d=>d.addEventListener('click',e=>{if(e.target===d)closeDrawers()}));
  $('#globalSearch').addEventListener('input', debounce(e=>searchChapters(e.target.value),130));
  $('#clearBookmarks').addEventListener('click',()=>{ if(confirm('Удалить все закладки?')){ state.bookmarks=[]; store.set(`${APP_KEY}.bookmarks`,[]); renderBookmarks(); }});
  $('#themeSelect').addEventListener('change',e=>{state.settings.theme=e.target.value;saveSettings()}); $('#fontSelect').addEventListener('change',e=>{state.settings.font=e.target.value;saveSettings()});
  $('#fontSize').addEventListener('input',e=>{state.settings.fontSize=+e.target.value;saveSettings()}); $('#lineHeight').addEventListener('input',e=>{state.settings.lineHeight=+e.target.value;saveSettings()}); $('#contentWidth').addEventListener('input',e=>{state.settings.width=+e.target.value;saveSettings()}); $('#paragraphGap').addEventListener('input',e=>{state.settings.paragraphGap=+e.target.value;saveSettings()});
  $('#resetSettings').addEventListener('click',()=>{state.settings={...DEFAULT_SETTINGS};saveSettings()});
  $('#lightbox').addEventListener('click',e=>{ if(e.target.id==='lightbox' || e.target.tagName==='BUTTON') $('#lightbox').hidden=true; });
  addEventListener('scroll',()=>{ updateProgressUI(); clearTimeout(window._rzScroll); window._rzScroll=setTimeout(saveProgress,180); }, {passive:true});
  addEventListener('beforeunload',saveProgress);
  addEventListener('pagehide',saveProgress);
  document.addEventListener('visibilitychange',()=>{ if(document.visibilityState==='hidden') saveProgress(); });
  addEventListener('hashchange',async ()=>{ const r=routeFromHash(); if(!r) return; if(!state.arc || r.arcId!==state.arc.id) await openArc(r.arcId,{home:!r.chapter}); if(isExtrasMode()){ const vol = r.chapter ? (String(r.chapter).match(/\d+/)?.[0] || 'all') : 'all'; selectExtrasVolume(vol); setMainView('extras'); updateProgressUI(); return; } if(!r.chapter){ setMainView('home'); updateProgressUI(); return; } const i=chapterIndexFromRouteChapter(r.chapter); if(i!=null && i!==state.current) await openChapter(i,{silentHash:true, restore:true}); });
  addEventListener('keydown',e=>{
    if(e.target.matches('input, textarea, select')) return;
    if(e.key==='Escape'){ closeDrawers(); $('#lightbox').hidden=true; }
    if(e.key==='/'){ e.preventDefault(); openDrawer('#searchDrawer'); }
    if(e.key.toLowerCase()==='t') $('#sidebar').classList.toggle('closed');
    if(e.key.toLowerCase()==='s') openDrawer('#settingsDrawer');
    if(e.key.toLowerCase()==='b') { renderBookmarks(); openDrawer('#bookmarksDrawer'); }
    if(e.key==='ArrowLeft' && !$('#reader').hidden) openChapter(state.current-1);
    if(e.key==='ArrowRight' && !$('#reader').hidden) openChapter(state.current+1);
  });
  updateQuickNav(); updateResumeUI();
  if('serviceWorker' in navigator){ navigator.serviceWorker.register('sw.js').catch(()=>{}); }
}
init().catch(err=>{ console.error(err); document.body.innerHTML='<main class="shell"><div class="hero-card"><h1>Не удалось загрузить читалку</h1><p>Проверь, что файлы content/arcs.json и папки content/arc-*/ на месте.</p></div></main>'; });
