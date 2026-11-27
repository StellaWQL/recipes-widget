import { config } from './config.js';
import { loadCatalog, resolveCover, revokeCover } from './catalog.js';
import { createBookEngine } from './epub-engine.js';

const $ = selector => document.querySelector(selector);
const $$ = selector => [...document.querySelectorAll(selector)];
const life = new AbortController();
// Match room.css so the painted page count always agrees with EPUB's 700px spread threshold.
const narrow = matchMedia('(max-width:1100px), (max-height:620px)');
const shelfMedium = matchMedia('(max-width:800px)');
const shelfSmall = matchMedia('(max-width:560px)');
const reducedMotion = matchMedia('(prefers-reduced-motion: reduce)');
const els = {
  library: $('#library-view'), grid: $('#library-grid'), empty: $('#library-empty'),
  reader: $('#reader-view'), shell: $('#book-shell'), viewer: $('#epub-viewer'),
  chapterDialog: $('#chapter-dialog'), chapters: $('#chapter-list'), chapterTitle: $('#chapter-title'),
  searchDialog: $('#search-dialog'), search: $('#library-search'), searchCount: $('#search-count'),
  status: $('#room-status'), statusMessage: $('#status-message'),
  importFile: $('#import-file'), urlForm: $('#url-form'), urlInput: $('#url-input'),
  titleLeft: $('#running-left'), titleRight: $('#running-right'),
  folioLeft: $('#folio-left'), folioRight: $('#folio-right'), fontSize: $('#font-size-value'),
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
let chapters = [];
let view = 'library';
let queryText = '';
let lastError = '';
const files = new Map();
const coverUrls = new Set();
const pendingCovers = new Set();
let coverObserver;
let databasePromise;

function readStorage(key) {
  try { return JSON.parse(localStorage.getItem(key) || '{}'); } catch { return {}; }
}
const legacy = readStorage(config.legacyStorageKey);
const saved = readStorage(config.storageKey);
const state = {
  positions: saved.positions && typeof saved.positions === 'object' ? saved.positions : {},
  fontSize: Math.max(16, Math.min(34, Number(saved.fontSize || legacy.fontSize) || config.defaultFontSize)),
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
  } catch { /* A storage quota must not interrupt a reading session. */ }
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
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

function status(text = '', retry = false) {
  els.statusMessage.textContent = text;
  els.status.hidden = !text;
  const button = $('[data-action="retry"]');
  if (button) button.hidden = !retry;
}

function controls() {
  $$('[data-action="previous"]').forEach(button => {
    button.disabled = busy || !ready || !!engine?.currentLocation?.atStart;
  });
  $$('[data-action="next"]').forEach(button => {
    button.disabled = busy || !ready || !!engine?.currentLocation?.atEnd;
  });
  $$('[data-action="chapters"]').forEach(button => { button.disabled = busy || !ready; });
  els.fontSize.textContent = `${state.fontSize}`;
  const smaller = $('[data-action="smaller"]');
  const larger = $('[data-action="larger"]');
  if (smaller) smaller.disabled = state.fontSize <= 16;
  if (larger) larger.disabled = state.fontSize >= 34;
}

function closeDialogs() {
  for (const dialog of [els.chapterDialog, els.searchDialog]) if (dialog.open) dialog.close();
}
function setView(next) {
  closeDialogs();
  view = next;
  document.body.dataset.view = next;
  els.library.hidden = next !== 'library';
  els.reader.hidden = next !== 'reader';
  if (next === 'library') document.title = '书库 · THE RAVEN';
}
function writeRoute(entry, replace = false) {
  const url = new URL(location.href);
  url.hash = '';
  if (entry?.url) url.searchParams.set('book', entry.url);
  else if (entry?.kind === 'file') url.searchParams.set('local', entry.key);
  else { url.searchParams.delete('book'); url.searchParams.delete('local'); }
  if (entry?.url) url.searchParams.delete('local');
  if (entry?.kind === 'file') url.searchParams.delete('book');
  if (url.href !== location.href) history[replace ? 'replaceState' : 'pushState']({}, '', url);
}
function showLibrary({ route = true } = {}) {
  if (busy) {
    // Leaving during a fetch must not later reopen a hidden reader or report an old error.
    opening += 1; engineGeneration += 1;
    engine?.destroy(); engine = null; enginePromise = null;
    busy = false; ready = false;
  }
  setView('library');
  status();
  if (route) writeRoute(null);
  renderBooks();
  controls();
}

function title(entry) { return entry.shortTitle || entry.title || entry.filename?.replace(/\.epub$/i, '') || '未命名图书'; }
function columnCount() { return shelfSmall.matches ? 2 : shelfMedium.matches ? 3 : 4; }
function allBooks() {
  const map = new Map();
  for (const entry of [...books, ...state.imported]) if (entry.key) map.set(entry.key, entry);
  return [...map.values()];
}
function renderBooks() {
  coverObserver?.disconnect();
  const filter = queryText.trim().toLocaleLowerCase();
  const matches = allBooks().filter(entry => `${entry.title} ${entry.shortTitle || ''} ${entry.author || ''}`.toLocaleLowerCase().includes(filter));
  els.grid.replaceChildren();
  els.empty.hidden = matches.length > 0;
  els.empty.textContent = filter ? '没有找到这本书。' : '这里还没有图书。可以从右下角的目录卡载入 EPUB。';
  els.searchCount.textContent = filter ? `找到 ${matches.length} 本` : `${matches.length} 本图书`;
  let row;
  matches.forEach((entry, index) => {
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
  // A search or catalogue refresh can replace both the entry and its DOM button.
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
    container: els.viewer, fontUrl: config.fontUrl, ornamentUrl: config.ornamentUrl,
    onLocation: location => { if (generation === engineGeneration && view === 'reader') saveLocation(location); },
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
    engine = value; await engine.setFontSize(state.fontSize); return value;
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
    status(); requestAnimationFrame(() => engine.resize()); return;
  }
  const operation = ++opening;
  current = entry; ready = false; busy = true; lastError = '';
  els.folioLeft.textContent = ''; els.folioRight.textContent = '';
  els.titleLeft.textContent = title(entry); els.titleRight.textContent = title(entry);
  els.chapterTitle.textContent = title(entry); renderChapters([]);
  controls(); status('正在翻开书页…');
  try {
    const active = await getEngine();
    if (operation !== opening) return;
    let source = entry;
    if (entry.kind === 'file') {
      source = files.get(entry.key) || await storedFile(entry.key);
      if (!source) throw new Error('请从书库目录卡重新载入这本本地 EPUB。');
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
      if (ready && engine?.currentLocation) saveLocation(engine.currentLocation);
      controls();
    }
  }
}
async function turn(direction) {
  if (view !== 'reader' || !ready || busy || turnBusy || els.chapterDialog.open || els.searchDialog.open) return;
  turnBusy = true;
  try {
    const result = await (direction > 0 ? engine.next() : engine.prev());
    if (result && !reducedMotion.matches) {
      els.shell.animate([{ opacity: .92 }, { opacity: 1 }], { duration: 190, easing: 'ease-out' });
    }
  } finally { turnBusy = false; controls(); }
}
function keydown(event) {
  if (event.defaultPrevented || event.isComposing) return;
  const typing = event.target?.closest?.('input,textarea,select,[contenteditable="true"],[contenteditable=""]');
  if (event.key === 'Escape') {
    if (els.chapterDialog.open || els.searchDialog.open) { event.preventDefault(); closeDialogs(); }
    return;
  }
  if (typing || event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.repeat) return;
  if (view !== 'reader' || els.chapterDialog.open || els.searchDialog.open) return;
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
    else { showLibrary({ route: false }); status('这本本地书尚未载入，请从目录卡选择 EPUB。'); }
  } else if (query.get('book')) {
    try { await openEntry(externalEntry(query.get('book')), { route: false }); }
    catch (error) { showLibrary({ route: false }); status(error.message); }
  } else showLibrary({ route: false });
}
async function importBook(file) {
  if (!file) return;
  if (!/\.epub$/i.test(file.name)) { status('请选择 EPUB 文件。'); return; }
  const key = `file:${file.name}:${file.size}:${file.lastModified || 0}`;
  files.set(key, file);
  await storedFile(key, file);
  const entry = { key, kind: 'file', imported: true, filename: file.name, title: file.name.replace(/\.epub$/i, ''), author: '' };
  state.imported = [entry, ...state.imported.filter(item => item.key !== key)];
  persist(); await openEntry(entry);
}

document.addEventListener('keydown', keydown, { capture: true, signal: life.signal });
document.addEventListener('click', event => {
  const button = event.target.closest?.('[data-action]');
  if (!button || button.disabled) return;
  switch (button.dataset.action) {
    case 'home': persist(); location.assign(config.homeUrl); break;
    case 'library': showLibrary(); break;
    case 'chapters': if (ready) { controls(); els.chapterDialog.showModal(); } break;
    case 'search': els.searchDialog.showModal(); requestAnimationFrame(() => els.search.focus()); break;
    case 'previous': void turn(-1); break;
    case 'next': void turn(1); break;
    case 'close-dialog': closeDialogs(); break;
    case 'import': els.importFile.click(); break;
    case 'retry': if (current) void openEntry(current, { route: false, force: true }); break;
    case 'smaller': case 'larger': {
      state.fontSize = Math.max(16, Math.min(34, state.fontSize + (button.dataset.action === 'larger' ? 2 : -2)));
      persist(); controls(); void engine?.setFontSize(state.fontSize); break;
    }
  }
}, { signal: life.signal });
for (const dialog of [els.chapterDialog, els.searchDialog]) dialog.addEventListener('click', event => {
  if (event.target !== dialog) return;
  const rect = dialog.getBoundingClientRect();
  if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) dialog.close();
}, { signal: life.signal });
els.search.addEventListener('input', () => { queryText = els.search.value; renderBooks(); }, { signal: life.signal });
els.importFile.addEventListener('change', () => { void importBook(els.importFile.files[0]); els.importFile.value = ''; }, { signal: life.signal });
els.urlForm?.addEventListener('submit', event => {
  event.preventDefault();
  try { void openEntry(externalEntry(els.urlInput.value)); }
  catch (error) { status(error.message); }
}, { signal: life.signal });
window.addEventListener('popstate', () => void restoreRoute(), { signal: life.signal });
const updateNarrow = () => {
  document.body.dataset.narrow = String(narrow.matches);
  requestAnimationFrame(() => engine?.resize());
};
narrow.addEventListener('change', updateNarrow, { signal: life.signal });
for (const media of [shelfMedium, shelfSmall]) media.addEventListener('change', renderBooks, { signal: life.signal });
updateNarrow(); controls();

// The exact same full font is reused by the outer controls and EPUB iframes.
const fontStyle = document.createElement('style');
fontStyle.textContent = `@font-face{font-family:HuiwenMincho;src:url(${JSON.stringify(config.fontUrl)}) format('woff2');font-display:swap}`;
document.head.append(fontStyle);

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
  for (const url of coverUrls) { revokeCover(url); URL.revokeObjectURL(url); }
  void databasePromise?.then(db => db?.close());
});
