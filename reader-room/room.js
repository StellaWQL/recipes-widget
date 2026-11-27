import { config } from './config.js?v=import4';
import { loadCatalog, resolveCover, revokeCover } from './catalog.js';
import { createBookEngine } from './epub-engine.js?v=import4';
import { inspectEpubImport } from './epub-import.js?v=import4';
import { mountObjectMotion, READER_OBJECTS, LIBRARY_OBJECTS, IMPORT_OBJECTS } from './object-motion.js?v=import4';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const life = new AbortController();
// The layout mode follows viewport width, not the shape of the old book image.
const narrow = matchMedia('(max-width:900px)');
const shelfSmall = matchMedia('(max-width:700px)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const els = {
  library: $('#library-view'), grid: $('#library-grid'), empty: $('#library-empty'),
  reader: $('#reader-view'), shell: $('#book-shell'), viewer: $('#epub-viewer'),
  chapterDialog: $('#chapter-dialog'), chapters: $('#chapter-list'), chapterTitle: $('#chapter-title'),
  status: $('#room-status'), statusMessage: $('#status-message'),
  importFile: $('#import-file'), importRoom: $('#import-view'), importZone: $('#import-dropzone'),
  importMessage: $('#import-message'), importDetail: $('#import-detail'),
  titleLeft: $('#running-left'), titleRight: $('#running-right'),
  folioLeft: $('#folio-left'), folioRight: $('#folio-right'), fontSize: $('#font-size-value'),
  shelfPager: $('#shelf-pager'), shelfPage: $('#shelf-page'),
};
let books = [];
let current = null;
let engine;
let enginePromise;
let engineGeneration = 0;
let opening = 0;
let ready = false;
let busy = false;
let turnBusy = false;
let layoutBusy = false;
let layoutQueue = Promise.resolve();
let chapters = [];
let view = 'library';
let importing = 0;
let importBusy = false;
let dragDepth = 0;
let shelfPage = 0;
let shelfPageCount = 1;
let lastError = '';
const files = new Map();
const coverUrls = new Set();
const pendingCovers = new Set();
const sceneMotions = [];
let coverObserver;
let databasePromise;

function readStorage(key) {
  try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; }
}
const legacy = readStorage(config.legacyStorageKey);
const saved = readStorage(config.storageKey);
const state = {
  positions: saved.positions && typeof saved.positions === 'object' ? saved.positions : {},
  // Apply v4's smaller defaults once, then preserve user changes and all reading locations.
  typographyVersion: 4,
  fontSize: Math.max(16, Math.min(34, saved.typographyVersion >= 4 ? Number(saved.fontSize) || config.defaultFontSize : config.defaultFontSize)),
  scrollFontSize: Math.max(16, Math.min(30, saved.typographyVersion >= 4 ? Number(saved.scrollFontSize) || config.defaultScrollFontSize : config.defaultScrollFontSize)),
  imported: Array.isArray(saved.imported) ? saved.imported : [],
};
// Legacy local files remain in the original IndexedDB; references are migrated, not erased.
for (const entry of Array.isArray(legacy.recent) ? legacy.recent : []) {
  if (entry.kind === 'file' && entry.key && !state.imported.some(item => item.key === entry.key)) {
    state.imported.push({ ...entry, shortTitle: entry.title, filename: entry.fileName, imported: true });
  }
}

function persist() {
  try {
    state.positions = Object.fromEntries(Object.entries(state.positions)
      .sort((a, b) => (b[1]?.updatedAt || 0) - (a[1]?.updatedAt || 0)).slice(0, 160));
    // Temporary blob cover URLs are never written as durable image addresses.
    const imported = state.imported.map(({ coverUrl, blob, ...entry }) => entry);
    localStorage.setItem(config.storageKey, JSON.stringify({ ...state, imported }));
    return true;
  } catch { return false; /* A storage quota must not interrupt a reading session. */ }
}

function database() {
  if (!window.indexedDB) return Promise.resolve(null);
  if (!databasePromise) databasePromise = new Promise(resolve => {
    try {
      const request = indexedDB.open('raven-reader-files', 1);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('books')) request.result.createObjectStore('books');
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = request.onblocked = () => resolve(null);
    } catch { resolve(null); }
  });
  return databasePromise;
}
async function storedFile(key, file) {
  const db = await database();
  if (!db) return null;
  return new Promise(resolve => {
    try {
      const transaction = db.transaction('books', file ? 'readwrite' : 'readonly');
      const request = file ? transaction.objectStore('books').put(file, key) : transaction.objectStore('books').get(key);
      let result = null;
      request.onsuccess = () => { result = request.result || null; };
      transaction.oncomplete = () => resolve(result);
      transaction.onerror = transaction.onabort = () => resolve(null);
    } catch { resolve(null); }
  });
}

function status(text = '', retry = false) {
  els.statusMessage.textContent = text;
  els.status.hidden = !text;
  const button = $('[data-action="retry"]');
  if (button) button.hidden = !retry;
}

function activeFontSize() { return narrow.matches ? state.scrollFontSize : state.fontSize; }
function controls() {
  $$('[data-action="previous"]').forEach(button => {
    button.disabled = narrow.matches || busy || layoutBusy || !ready || !!engine?.currentLocation?.atStart;
  });
  $$('[data-action="next"]').forEach(button => {
    button.disabled = narrow.matches || busy || layoutBusy || !ready || !!engine?.currentLocation?.atEnd;
  });
  $$('[data-action="chapters"]').forEach(button => { button.disabled = busy || !ready; });
  els.fontSize.textContent = `${activeFontSize()}`;
  const smaller = $('[data-action="smaller"]');
  const larger = $('[data-action="larger"]');
  if (smaller) smaller.disabled = layoutBusy || activeFontSize() <= 16;
  if (larger) larger.disabled = layoutBusy || activeFontSize() >= (narrow.matches ? 30 : 34);
}

function closeDialogs() {
  if (els.chapterDialog.open) els.chapterDialog.close();
}
function setView(next) {
  closeDialogs();
  if (view === 'import' && next !== 'import') { importing += 1; importBusy = false; dragDepth = 0; }
  view = next;
  document.body.dataset.view = next;
  els.library.hidden = next !== 'library';
  els.reader.hidden = next !== 'reader';
  els.importRoom.hidden = next !== 'import';
  if (next === 'library') document.title = '书库 · THE RAVEN';
  if (next === 'import') document.title = '新书入藏 · THE RAVEN';
  for (const motion of sceneMotions) motion.setActive(null);
  requestAnimationFrame(() => { for (const motion of sceneMotions) motion.resize(); });
}
function writeRoute(entry, replace = false, roomView = '') {
  const url = new URL(location.href);
  url.hash = '';
  if (entry?.url) url.searchParams.set('book', entry.url);
  else if (entry?.kind === 'file') url.searchParams.set('local', entry.key);
  else { url.searchParams.delete('book'); url.searchParams.delete('local'); }
  if (entry?.url) url.searchParams.delete('local');
  if (entry?.kind === 'file') url.searchParams.delete('book');
  if (roomView === 'import') url.searchParams.set('view', 'import');
  else url.searchParams.delete('view');
  if (url.href !== location.href) history[replace ? 'replaceState' : 'pushState']({}, '', url);
}
function cancelOpening() {
  if (busy) {
    // Leaving during a fetch must not later reopen a hidden reader or report an old error.
    opening += 1; engineGeneration += 1;
    engine?.destroy(); engine = null; enginePromise = null;
    busy = false; ready = false;
  }
}
function showLibrary({ route = true } = {}) {
  cancelOpening();
  setView('library');
  status();
  if (route) writeRoute(null);
  renderBooks();
  controls();
}
function importMessage(text = '轻点纸函，放入一本 EPUB', detail = '也可以把书拖到这里', state = 'idle') {
  els.importMessage.textContent = text;
  els.importDetail.textContent = detail;
  els.importRoom.dataset.state = state;
  els.importZone.disabled = importBusy;
  els.importZone.setAttribute('aria-busy', String(importBusy));
}
function showImport({ route = true } = {}) {
  cancelOpening();
  importing += 1; importBusy = false; dragDepth = 0;
  setView('import'); status(); importMessage();
  if (route) writeRoute(null, false, 'import');
}

function title(entry) { return entry.shortTitle || entry.title || entry.filename?.replace(/\.epub$/i, '') || '未命名图书'; }
function columnCount() { return shelfSmall.matches ? 2 : 4; }
function allBooks() {
  const map = new Map();
  for (const entry of [...books, ...state.imported]) if (entry.key) map.set(entry.key, entry);
  return [...map.values()];
}
function renderBooks() {
  coverObserver?.disconnect();
  const matches = allBooks();
  els.grid.replaceChildren();
  els.empty.hidden = matches.length > 0;
  els.empty.textContent = '书架正等着第一本书。轻点收书纸函，放入 EPUB。';
  let row;
  const pageSize = columnCount() * 3;
  shelfPageCount = Math.max(1, Math.ceil(matches.length / pageSize));
  shelfPage = Math.max(0, Math.min(shelfPage, shelfPageCount - 1));
  els.shelfPager.hidden = shelfPageCount === 1;
  els.shelfPage.textContent = `${shelfPage + 1} / ${shelfPageCount}`;
  $('[data-action="shelf-previous"]').disabled = shelfPage === 0;
  $('[data-action="shelf-next"]').disabled = shelfPage >= shelfPageCount - 1;
  matches.slice(shelfPage * pageSize, (shelfPage + 1) * pageSize).forEach((entry, index) => {
    if (index % columnCount() === 0) {
      row = document.createElement('div'); row.className = 'shelf-row';
      els.grid.append(row);
    }
    const button = document.createElement('button');
    button.type = 'button'; button.className = 'cover-book'; button.dataset.key = entry.key;
    button.setAttribute('aria-label', `阅读《${title(entry)}》${entry.author ? `，${entry.author}` : ''}`);
    if (current?.key === entry.key) button.setAttribute('aria-current', 'true');
    const plate = document.createElement('span'); plate.className = 'cover-plate';
    if (entry.coverWidth && entry.coverHeight) plate.style.setProperty('--cover-ratio', `${entry.coverWidth} / ${entry.coverHeight}`);
    const image = document.createElement('img'); image.className = 'original-cover'; image.alt = title(entry);
    image.decoding = 'async'; image.loading = index < 8 ? 'eager' : 'lazy';
    const fallback = document.createElement('span'); fallback.className = 'cover-fallback'; fallback.textContent = title(entry);
    fallback.hidden = !!entry.coverUrl;
    image.hidden = !entry.coverUrl;
    if (entry.coverUrl) image.src = entry.coverUrl;
    image.addEventListener('load', () => {
      plate.style.setProperty('--cover-ratio', `${image.naturalWidth} / ${image.naturalHeight}`);
      image.hidden = false; fallback.hidden = true;
    }, { signal: life.signal });
    image.addEventListener('error', () => { image.hidden = true; fallback.hidden = false; }, { signal: life.signal });
    const grain = document.createElement('span'); grain.className = 'cover-grain'; grain.setAttribute('aria-hidden', 'true');
    plate.append(image, fallback, grain); button.append(plate); row.append(button);
    button.addEventListener('click', () => void openEntry(entry), { signal: life.signal });
    if (!entry.coverUrl) {
      if ('IntersectionObserver' in window) {
        if (!coverObserver) coverObserver = new IntersectionObserver(items => {
          for (const item of items) if (item.isIntersecting) {
            const found = allBooks().find(book => book.key === item.target.dataset.key);
            if (found) void loadCover(found, item.target);
            coverObserver.unobserve(item.target);
          }
        }, { rootMargin: '160px' });
        coverObserver.observe(button);
      } else void loadCover(entry, button);
    }
  });
}
async function loadCover(entry, button) {
  if (pendingCovers.has(entry.key)) return;
  pendingCovers.add(entry.key);
  try {
    let source = entry;
    if (entry.kind === 'file') {
      const blob = files.get(entry.key) || await storedFile(entry.key);
      if (!blob) return;
      source = { ...entry, blob };
    }
    const url = await resolveCover(source, { signal: life.signal });
    if (!url || life.signal.aborted) return;
    applyCover(entry, url);
  } catch { /* The original title remains usable when cover metadata is absent. */ }
  finally { pendingCovers.delete(entry.key); }
}
function applyCover(entry, url) {
  entry.coverUrl = url;
  if (url.startsWith('blob:')) coverUrls.add(url);
  // A catalogue refresh can replace both the entry and its DOM button.
  for (const item of [...books, ...state.imported]) if (item.key === entry.key) item.coverUrl = url;
  for (const button of $$('.cover-book')) {
    if (button.dataset.key !== entry.key) continue;
    const image = button.querySelector('img');
    if (image) image.src = url;
  }
}

function saveLocation(location) {
  if (busy || !current || !location?.start?.cfi) return;
  state.positions[current.key] = { cfi: location.start.cfi, updatedAt: Date.now() };
  persist();
  els.viewer.dataset.readingCfi = location.start.cfi;
  els.viewer.dataset.readingHref = location.start.href || '';
  const start = location.start?.displayed?.page;
  const end = location.end?.displayed?.page;
  els.folioLeft.textContent = start ? String(start) : '';
  els.folioRight.textContent = !narrow.matches && end && end !== start ? String(end) : '';
  if (start) els.folioLeft.setAttribute('aria-label', `本章第 ${start} 页`);
  if (end) els.folioRight.setAttribute('aria-label', `本章第 ${end} 页`);
  controls();
}
function remembered(entry) {
  if (state.positions[entry.key]?.cfi) return state.positions[entry.key].cfi;
  const candidates = [entry.key];
  for (const value of [entry.url, entry.localUrl]) if (value) {
    try { candidates.push(`url:${new URL(value, document.baseURI).href}`); } catch {}
  }
  for (const key of candidates) if (legacy.positions?.[key]?.cfi) return legacy.positions[key].cfi;
  return undefined;
}
function renderChapters(items = []) {
  chapters = items;
  els.chapters.replaceChildren();
  function list(entries) {
    const ul = document.createElement('ul');
    for (const entry of entries) {
      const li = document.createElement('li');
      const button = document.createElement('button'); button.type = 'button';
      button.textContent = String(entry.label || '未命名章节').trim();
      button.addEventListener('click', async () => {
        closeDialogs();
        if (!await engine?.display(entry.href)) return;
        status();
      }, { signal: life.signal });
      li.append(button);
      if (entry.subitems?.length) li.append(list(entry.subitems));
      ul.append(li);
    }
    return ul;
  }
  if (items.length) els.chapters.append(list(items));
  else {
    const p = document.createElement('p'); p.textContent = '这本书没有提供章节目录。'; els.chapters.append(p);
  }
}
async function getEngine() {
  if (engine) return engine;
  if (!enginePromise) {
    const generation = ++engineGeneration;
    enginePromise = createBookEngine({
    container: els.viewer, fontUrl: config.fontUrl, layout: narrow.matches ? 'scroll' : 'spread',
    onLocation: location => { if (generation === engineGeneration && view === 'reader' && !layoutBusy) saveLocation(location); },
    onNavigation: items => { if (generation === engineGeneration) renderChapters(items); },
    onKeydown: keydown,
    onMetadata: metadata => {
      if (!current || generation !== engineGeneration || view !== 'reader') return;
      current.title = metadata.title || current.title;
      current.author = metadata.creator || current.author;
      const short = title(current);
      els.titleLeft.textContent = short; els.titleRight.textContent = short;
      els.chapterTitle.textContent = short;
      document.title = `${short} · 阅读室`;
    },
    onError: error => {
      if (generation !== engineGeneration || view !== 'reader') return;
      lastError = error.message; status(error.message, true);
    },
  }).then(async value => {
    if (generation !== engineGeneration) { value.destroy(); throw new DOMException('已返回书库。', 'AbortError'); }
    engine = value; await engine.setFontSize(activeFontSize()); return value;
  }).catch(error => { if (generation === engineGeneration) enginePromise = null; throw error; });
  }
  return enginePromise;
}
async function openEntry(entry, { route = true, force = false } = {}) {
  closeDialogs();
  setView('reader');
  document.title = `${title(entry)} · 阅读室`;
  if (route) writeRoute(entry);
  if (!force && ready && current?.key === entry.key && engine?.currentBook) {
    status(); await syncResponsiveReader(); requestAnimationFrame(() => engine.resize()); return;
  }
  const operation = ++opening;
  current = entry; ready = false; busy = true; lastError = '';
  els.folioLeft.textContent = ''; els.folioRight.textContent = '';
  els.titleLeft.textContent = title(entry); els.titleRight.textContent = title(entry);
  els.chapterTitle.textContent = title(entry); renderChapters([]);
  controls(); status(narrow.matches ? '正在展开卷轴…' : '正在翻开书页…');
  try {
    const active = await getEngine();
    if (operation !== opening) return;
    let source = entry;
    if (entry.kind === 'file') {
      source = files.get(entry.key) || await storedFile(entry.key);
      if (!source) throw new Error('请从书库的收书纸函重新放入这本 EPUB。');
    }
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (operation !== opening) return;
    const opened = await active.open(source, { savedCfi: remembered(entry) });
    if (operation !== opening) return;
    ready = opened;
    if (ready) {
      status();
      if (entry.url && !books.some(item => item.key === entry.key)) {
        entry.kind = 'url'; entry.imported = true;
        state.imported = [entry, ...state.imported.filter(item => item.key !== entry.key)];
      }
      if (!entry.coverUrl) {
        try {
          const cover = await active.currentBook.coverUrl();
          if (cover && operation === opening) {
            // Make an owned URL before the rendition later destroys its archive URL.
            const bytes = await (await fetch(cover)).blob();
            if (operation !== opening) return;
            applyCover(entry, URL.createObjectURL(bytes));
          }
        } catch {}
      }
      persist();
    } else status(lastError || '这本书暂时无法打开，可以返回书库后重试。', true);
  } catch (error) {
    if (operation === opening) { lastError = error.message; status(error.message || '无法打开图书。', true); }
  } finally {
    if (operation === opening) {
      busy = false;
      controls();
      if (ready) void syncResponsiveReader();
    }
  }
}
async function turn(direction) {
  if (narrow.matches || view !== 'reader' || !ready || busy || layoutBusy || turnBusy || els.chapterDialog.open) return;
  turnBusy = true;
  try {
    const result = await (direction > 0 ? engine.next() : engine.prev());
    if (result && !reducedMotion.matches) {
      // Only live ink settles after a page turn; the painted desk does not flash.
      els.viewer.animate([{ opacity: .86 }, { opacity: 1 }], { duration: 150, easing: 'ease-out' });
    }
  } finally { turnBusy = false; controls(); }
}
function keydown(event) {
  if (event.defaultPrevented || event.isComposing) return;
  const typing = event.target?.closest?.('input,textarea,select,[contenteditable="true"],[contenteditable=""]');
  if (event.key === 'Escape') {
    if (els.chapterDialog.open) { event.preventDefault(); closeDialogs(); }
    else if (view === 'import') { event.preventDefault(); showLibrary(); }
    return;
  }
  if (typing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) return;
  if (narrow.matches || view !== 'reader' || els.chapterDialog.open) return;
  const key = event.key.toLowerCase();
  const direction = ['j', 'arrowright', 'pagedown'].includes(key) ? 1 : ['k', 'arrowleft', 'pageup'].includes(key) ? -1 : 0;
  if (!direction) return;
  event.preventDefault(); event.stopPropagation(); void turn(direction);
}

function externalEntry(raw) {
  const url = new URL(raw, document.baseURI);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('请使用 HTTP 或 HTTPS 的 EPUB 地址。');
  const filename = decodeURIComponent(url.pathname.split('/').pop() || 'EPUB');
  const known = allBooks().find(entry => entry.url === url.href || entry.localUrl === url.href);
  if (known) return known;
  // Arbitrary URLs use URL keys so two unrelated files with the same name never share a CFI.
  return { key: `url:${url.href}`, url: url.href, filename, title: filename.replace(/\.epub$/i, ''), author: '' };
}
async function restoreRoute() {
  const query = new URLSearchParams(location.search);
  if (query.get('local')) {
    const entry = state.imported.find(item => item.key === query.get('local'));
    if (entry) await openEntry(entry, { route: false });
    else { showImport({ route: false }); importMessage('这本书需要重新放入', '轻点纸函，选择原来的 EPUB'); }
  } else if (query.get('book')) {
    try { await openEntry(externalEntry(query.get('book')), { route: false }); }
    catch (error) { showLibrary({ route: false }); status(error.message); }
  } else if (query.get('view') === 'import') showImport({ route: false });
  else showLibrary({ route: false });
}
async function importBook(file) {
  if (!file || view !== 'import' || importBusy) return;
  const operation = ++importing;
  importBusy = true;
  importMessage('正在整理这册新书…', file.name, 'receiving');
  const key = `file:${file.name}:${file.size}:${file.lastModified || 0}`;
  try {
    const metadata = await inspectEpubImport(file);
    if (operation !== importing || view !== 'import') return;
    const committed = await storedFile(key, file);
    if (!committed) throw new Error('这册书还没能保存。请检查浏览器存储空间后再放入。');
    files.set(key, file);
    const previous = state.imported;
    const existing = previous.find(item => item.key === key);
    const entry = { ...existing, key, kind:'file', imported:true, filename:file.name, ...metadata };
    state.imported = [entry, ...previous.filter(item => item.key !== key)];
    if (!persist()) {
      state.imported = previous;
      throw new Error('藏书记录还没能保存。请允许此网站保存本地数据后再试。');
    }
    if (operation !== importing || view !== 'import') { if (view === 'library') renderBooks(); return; }
    importBusy = false;
    importMessage('已经收好，正在翻开…', metadata.title, 'received');
    await openEntry(entry);
  } catch (error) {
    if (operation === importing && view === 'import') {
      importBusy = false;
      importMessage(error.message || '这册书暂时无法放入。', '轻点纸函，重新选择 EPUB', 'error');
    }
  } finally {
    if (operation === importing) {
      importBusy = false;
      els.importZone.disabled = false;
      els.importZone.setAttribute('aria-busy', 'false');
    }
  }
}

document.addEventListener('keydown', keydown, { capture: true, signal: life.signal });
document.addEventListener('click', event => {
  const button = event.target.closest?.('[data-action]');
  if (!button || button.disabled) return;
  switch (button.dataset.action) {
    case 'home': persist(); location.assign(config.homeUrl); break;
    case 'library': showLibrary(); break;
    case 'chapters': if (ready) { controls(); els.chapterDialog.showModal(); } break;
    case 'import-room': showImport(); break;
    case 'previous': void turn(-1); break;
    case 'next': void turn(1); break;
    case 'shelf-previous': shelfPage = Math.max(0, shelfPage - 1); renderBooks(); break;
    case 'shelf-next': shelfPage = Math.min(shelfPageCount - 1, shelfPage + 1); renderBooks(); break;
    case 'close-dialog': closeDialogs(); break;
    case 'import': if (!importBusy && view === 'import') els.importFile.click(); break;
    case 'retry': if (current) void openEntry(current, { route: false, force: true }); break;
    case 'smaller': case 'larger': {
      const field = narrow.matches ? 'scrollFontSize' : 'fontSize';
      state[field] = Math.max(16, Math.min(narrow.matches ? 30 : 34, state[field] + (button.dataset.action === 'larger' ? 1 : -1)));
      persist(); controls(); void engine?.setFontSize(activeFontSize()); break;
    }
  }
}, { signal: life.signal });
for (const dialog of [els.chapterDialog]) dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
}, { signal: life.signal });
els.importFile.addEventListener('change', () => { void importBook(els.importFile.files[0]); els.importFile.value = ''; }, { signal: life.signal });
els.importRoom.addEventListener('dragenter', event => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault();
  dragDepth += 1;
  if (!importBusy) importMessage('把这册书轻轻放下', '一次放入一本 EPUB', 'dragging');
}, { signal: life.signal });
els.importRoom.addEventListener('dragover', event => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  event.preventDefault();
  event.dataTransfer.dropEffect = importBusy ? 'none' : 'copy';
}, { signal: life.signal });
els.importRoom.addEventListener('dragleave', event => {
  if (!event.dataTransfer?.types.includes('Files')) return;
  dragDepth = Math.max(0, dragDepth - 1);
  if (!dragDepth && !importBusy) importMessage();
}, { signal: life.signal });
els.importRoom.addEventListener('drop', event => {
  event.preventDefault(); dragDepth = 0;
  if (importBusy) return;
  const incoming = [...(event.dataTransfer?.files || [])];
  if (incoming.length !== 1) { importMessage('请一次放入一本书', '选好一本 EPUB，再放进纸函', 'error'); return; }
  void importBook(incoming[0]);
}, { signal: life.signal });
window.addEventListener('popstate', () => void restoreRoute(), { signal: life.signal });
function syncResponsiveReader() {
  layoutQueue = layoutQueue.catch(() => {}).then(async () => {
    if (!engine || view !== 'reader' || busy || !ready) return;
    const active = engine;
    const operation = opening;
    const bookKey = current?.key;
    const targetLayout = narrow.matches ? 'scroll' : 'spread';
    const targetFontSize = activeFontSize();
    const unchanged = () => engine === active && operation === opening
      && current?.key === bookKey && view === 'reader' && !busy;
    layoutBusy = true; controls();
    try {
      const layoutSet = await active.setLayout(targetLayout);
      if (!unchanged() || !layoutSet) return;
      const fontSet = await active.setFontSize(targetFontSize);
      if (unchanged() && fontSet && active.layout === targetLayout
          && targetLayout === (narrow.matches ? 'scroll' : 'spread')
          && targetFontSize === activeFontSize() && active.currentLocation) {
        saveLocation(active.currentLocation);
      }
    } catch (error) {
      if (unchanged()) status(error.message || '阅读布局暂时无法切换。', true);
    } finally {
      layoutBusy = false; controls();
    }
  });
  return layoutQueue;
}
const updateNarrow = () => {
  document.body.dataset.narrow = String(narrow.matches);
  document.body.dataset.readerLayout = narrow.matches ? 'scroll' : 'spread';
  controls();
  void syncResponsiveReader();
};
narrow.addEventListener('change', updateNarrow, { signal: life.signal });
shelfSmall.addEventListener('change', () => { shelfPage = 0; renderBooks(); }, { signal: life.signal });
updateNarrow(); controls();

// The exact same full font is reused by the outer controls and EPUB iframes.
const fontStyle = document.createElement('style');
fontStyle.textContent = `@font-face{font-family:HuiwenMincho;src:url(${JSON.stringify(config.fontUrl)}) format('woff2');font-display:swap}`;
document.head.append(fontStyle);

// Each moving part is sampled from the original complete painting. A clean plate reveals
// only the small area it leaves behind; no independently generated object art is used.
function attachScene(id, objects, smallScreen, version = 3) {
  const canvas = $(`#${id}-scene-canvas`);
  const image = $(`#${id}-scene-image`);
  try {
    const motion = mountObjectMotion({
      canvas, fallbackImage:image, imageUrl:image.src,
      cleanImageUrl:new URL(`./assets/${id}-clean-v${version}.png`, import.meta.url).href,
      objects, reduceMotion:reducedMotion.matches || smallScreen.matches,
      onStatus:({mode, reason}) => {
        canvas.dataset.motionState = mode;
        if (reason) canvas.dataset.motionLastReason = reason;
      },
    });
    sceneMotions.push(motion);
    void motion.ready.then(result => { canvas.dataset.motionReady = result?.mode || 'ready'; });
    for (const button of $$(`#${id}-scene [data-motion]`)) motion.bindRegion(button, button.dataset.motion);
    const update = () => motion.setReducedMotion(reducedMotion.matches || smallScreen.matches);
    reducedMotion.addEventListener('change', update, {signal:life.signal});
    smallScreen.addEventListener('change', update, {signal:life.signal});
  } catch {
    canvas.hidden = true; image.style.visibility = 'visible';
  }
}
attachScene('reader', READER_OBJECTS, narrow);
attachScene('library', LIBRARY_OBJECTS, shelfSmall, 4);
attachScene('import', IMPORT_OBJECTS, narrow, 4);

async function start() {
  const query = new URLSearchParams(location.search);
  let catalogUrl = config.catalogUrl;
  let fallbackUrl = config.fallbackUrl;
  if (query.has('catalog')) {
    const value = query.get('catalog');
    catalogUrl = value ? new URL(value, document.baseURI).href : null;
    fallbackUrl = catalogUrl === config.catalogUrl ? config.fallbackUrl : null;
  }
  books = await loadCatalog({
    catalogUrl, fallbackUrl, localBooksBase: config.localBooksBase, signal: life.signal,
    onUpdate: entries => { books = entries; if (view === 'library') renderBooks(); },
  });
  renderBooks();
  await restoreRoute();
}
void start().catch(error => { showLibrary({ route: false }); status(error.message || '书库暂时无法载入。'); });
window.addEventListener('pagehide', event => {
  persist();
  if (event.persisted) return;
  life.abort(); opening += 1; engine?.destroy(); coverObserver?.disconnect();
  for (const motion of sceneMotions) motion.destroy();
  for (const url of coverUrls) { revokeCover(url); URL.revokeObjectURL(url); }
  void databasePromise?.then(db => db?.close());
});
