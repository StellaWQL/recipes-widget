/** A quiet, buildless EPUB room. All publication data comes from a real book or catalog. */
export const DEFAULT_CATALOG_URL = 'https://api.github.com/repos/StellaWQL/recipes-widget/contents/data/books?ref=practice';

const MODULE_ROOT = new URL('../', import.meta.url);
const STORAGE_KEY = 'raven.reader.v1';
const FONT_URL = new URL('assets/fonts/huiwen-mincho.woff2?v=2', MODULE_ROOT).href;
const ICONS = {
  shelf: '<path d="M4 5v15M9 5v15M14 5v15M18 6l3 13M3 20h19"/>',
  upload: '<path d="M4 8h6l2 2h8v10H4zM12 15V3m-4 4 4-4 4 4"/>',
  link: '<path d="m10 14 4-4M8 16l-1 1a4 4 0 0 1-6-6l4-4a4 4 0 0 1 6 0m2 10a4 4 0 0 0 6 0l4-4a4 4 0 0 0-6-6l-1 1" transform="translate(1 -1) scale(.9)"/>',
  toc: '<path d="M8 6h12M8 12h12M8 18h12M3 6h1M3 12h1M3 18h1"/>',
  minus: '<path d="m3 18 5-12 5 12M5 14h6M16 12h6"/>',
  plus: '<path d="m2 18 5-12 5 12M4 14h6M15 12h7M18.5 8.5v7"/>',
  close: '<path d="m6 6 12 12M18 6 6 18"/>',
  prev: '<path d="m14 5-7 7 7 7"/>',
  next: '<path d="m10 5 7 7-7 7"/>',
  open: '<path d="M4 12h15m-5-5 5 5-5 5"/>',
  book: '<path d="M12 5c-3-2-7-2-10-1v15c3-1 7-1 10 1 3-2 7-2 10-1V4c-3-1-7-1-10 1Zm0 0v15"/>',
  alert: '<path d="m12 3 10 18H2L12 3Zm0 6v5m0 3v1"/>',
};

function icon(name) {
  return `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.45" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${ICONS[name] || ICONS.book}</svg>`;
}

function control(name, label, action) {
  return `<button class="rr-control" type="button" data-action="${action}" aria-label="${label}">${icon(name)}</button>`;
}

function readState() {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || '{}');
    return {
      fontSize: Math.min(34, Math.max(16, Number(saved.fontSize) || 22)),
      recent: Array.isArray(saved.recent) ? saved.recent.slice(0, 16) : [],
      positions: saved.positions && typeof saved.positions === 'object' ? saved.positions : {},
    };
  } catch { return { fontSize: 22, recent: [], positions: {} }; }
}

function persist(state) {
  try {
    const entries = Object.entries(state.positions).sort((a, b) => (b[1]?.updatedAt || 0) - (a[1]?.updatedAt || 0));
    state.positions = Object.fromEntries(entries.slice(0, 120));
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch { /* Private browsing or a full quota should not stop reading. */ }
}

function sourceUrl(value, base = document.baseURI) {
  if (!String(value || '').trim()) throw new Error('请提供 EPUB 文件地址。');
  const url = new URL(String(value), base);
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('无法打开这个书籍地址。');
  return url.href;
}

function filename(url) {
  try { return decodeURIComponent(new URL(url, document.baseURI).pathname.split('/').pop()).replace(/\.epub$/i, ''); }
  catch { return ''; }
}

function authorText(author) {
  if (Array.isArray(author)) return author.map(authorText).filter(Boolean).join(' · ');
  return typeof author === 'string' ? author.trim() : '';
}

function catalogEntries(data, base) {
  const list = Array.isArray(data) ? data : Array.isArray(data?.books) ? data.books : [];
  return list.flatMap(item => {
    if (typeof item === 'string') item = { url: item };
    if (!item || item.type === 'dir') return [];
    const raw = item.download_url || item.url || item.href || item.src || item.bookUrl;
    if (!raw) return [];
    const reference = `${item.name || item.path || ''} ${raw}`;
    if (!/\.epub(?:[?#\s]|$)/i.test(reference) && item.mimeType !== 'application/epub+zip') return [];
    try {
      const url = sourceUrl(raw, base);
      return [{ key: `url:${url}`, url, kind: 'url', title: String(item.title || item.name || filename(url)).replace(/\.epub$/i, ''), author: authorText(item.author || item.creator || item.authors) }];
    } catch { return []; }
  });
}

let dependencies;
function loadScript(file, globalName) {
  if (window[globalName]) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const script = document.createElement('script');
    script.src = new URL(`vendor/${file}`, MODULE_ROOT).href;
    script.async = true;
    script.onload = () => window[globalName] ? resolve() : reject(new Error('阅读组件未能载入。'));
    script.onerror = () => { script.remove(); reject(new Error('阅读组件未能载入。')); };
    document.head.append(script);
  });
}

function ensureDependencies() {
  if (!dependencies) {
    dependencies = loadScript('jszip.min.js', 'JSZip')
      .then(() => loadScript('epub.min.js', 'ePub'))
      .catch(error => { dependencies = null; throw error; });
  }
  return dependencies;
}

function ensureStyles() {
  const href = new URL('styles/reader.css', MODULE_ROOT).href;
  if ([...document.querySelectorAll('link[rel="stylesheet"]')].some(link => link.href === href)) return;
  const link = document.createElement('link');
  link.rel = 'stylesheet'; link.href = href;
  document.head.append(link);
}

// Files stay in this browser; the catalog and all reading positions remain plain local metadata.
let fileDatabase;
function openFileDatabase() {
  if (!window.indexedDB) return Promise.resolve(null);
  if (!fileDatabase) fileDatabase = new Promise(resolve => {
    const request = indexedDB.open('raven-reader-files', 1);
    request.onupgradeneeded = () => request.result.createObjectStore('books');
    request.onsuccess = () => resolve(request.result);
    request.onerror = request.onblocked = () => resolve(null);
  });
  return fileDatabase;
}

async function fileStore(key, file) {
  const db = await openFileDatabase();
  if (!db) return null;
  return new Promise(resolve => {
    try {
      const tx = db.transaction('books', file ? 'readwrite' : 'readonly');
      const request = file ? tx.objectStore('books').put(file, key) : tx.objectStore('books').get(key);
      request.onsuccess = () => resolve(request.result || null);
      request.onerror = () => resolve(null);
    } catch { resolve(null); }
  });
}

/**
 * mountReader(container, { onClose, bookUrl, catalogUrl })
 * catalogUrl defaults to the verified original GitHub repository; null disables the catalog.
 * open accepts an EPUB URL, a File/Blob, or {url,title,author}; destroy releases the book and listeners.
 */
export function mountReader(container, options = {}) {
  if (!(container instanceof Element)) throw new TypeError('mountReader requires a container element.');
  ensureStyles();
  const lifetime = new AbortController();
  const state = readState();
  const catalogUrl = options.catalogUrl === undefined ? DEFAULT_CATALOG_URL : options.catalogUrl;
  let dead = false;
  let sequence = 0;
  let openController = null;
  let catalogController = null;
  let book = null;
  let rendition = null;
  let current = null;
  let catalog = [];
  let currentLocation = null;
  let opening = false;
  let turning = false;
  let navigating = false;
  let navigationTarget = null;
  let navigationIndex = null;
  let fontRefreshTimer = 0;
  let fontRefreshDone = false;
  let activePanel = null;
  const localFiles = new Map();
  const frameCleanups = new Set();
  const root = document.createElement('section');
  root.className = options.showClose ? 'rr-reader rr-own-close' : 'rr-reader';
  root.setAttribute('aria-label', '阅读室');
  root.innerHTML = `
    <header class="rr-header">
      <div class="rr-heading"><h2 data-book-title></h2><p data-book-author></p></div>
      <div class="rr-toolbar" role="toolbar" aria-label="阅读操作">
        ${control('shelf', '打开书架', 'shelf')}
        ${control('upload', '载入 EPUB 文件', 'file')}
        ${control('link', '输入 EPUB 地址', 'url')}
        ${control('toc', '章节目录', 'toc')}
        ${control('minus', '减小字号', 'smaller')}
        ${control('plus', '增大字号', 'larger')}
        ${options.showClose ? control('close', '关闭阅读室', 'close') : ''}
      </div>
    </header>
    <form class="rr-urlbar" data-url-form hidden>
      <span class="rr-url-mark">${icon('link')}</span>
      <input type="url" inputmode="url" autocomplete="url" spellcheck="false" aria-label="EPUB 文件地址" data-url-input required>
      <button type="submit" class="rr-control" aria-label="打开 EPUB 地址">${icon('open')}</button>
      ${control('close', '收起地址输入', 'dismiss-url')}
    </form>
    <div class="rr-body">
      <aside class="rr-panel rr-shelf" aria-label="书架" data-shelf hidden><div class="rr-book-list" data-books></div></aside>
      <aside class="rr-panel rr-toc" aria-label="章节目录" data-toc hidden><nav data-chapters aria-label="书籍章节"></nav></aside>
      <div class="rr-stage">
        <div class="rr-empty" data-empty aria-label="可从书架打开书籍，或载入 EPUB 文件与地址">${icon('book')}</div>
        <div class="rr-viewer" data-viewer></div>
      </div>
      <div class="rr-status" data-status role="status" aria-live="polite" hidden></div>
      <div class="rr-loading" data-loading role="status" aria-label="正在载入" hidden><span></span></div>
    </div>
    <footer class="rr-footer">
      ${control('prev', '上一页', 'previous')}
      <span class="rr-position" data-position aria-live="off"></span>
      ${control('next', '下一页', 'next')}
    </footer>
    <input data-file type="file" accept=".epub,application/epub+zip" hidden>
  `;
  container.append(root);
  const $ = selector => root.querySelector(selector);
  const els = {
    body: $('.rr-body'), stage: $('.rr-stage'), viewer: $('[data-viewer]'), empty: $('[data-empty]'),
    shelf: $('[data-shelf]'), books: $('[data-books]'), toc: $('[data-toc]'), chapters: $('[data-chapters]'),
    title: $('[data-book-title]'), author: $('[data-book-author]'), status: $('[data-status]'), loading: $('[data-loading]'),
    urlForm: $('[data-url-form]'), urlInput: $('[data-url-input]'), file: $('[data-file]'), position: $('[data-position]'),
  };

  function message(text = '') {
    els.status.textContent = text;
    els.status.hidden = !text;
  }

  function updateControls() {
    $('[data-action="toc"]').disabled = !rendition || !els.chapters.childElementCount;
    $('[data-action="smaller"]').disabled = !rendition || state.fontSize <= 16;
    $('[data-action="larger"]').disabled = !rendition || state.fontSize >= 34;
    $('[data-action="previous"]').disabled = !rendition || opening || !!currentLocation?.atStart;
    $('[data-action="next"]').disabled = !rendition || opening || !!currentLocation?.atEnd;
  }

  function setPanel(panel) {
    activePanel = panel;
    els.shelf.hidden = panel !== 'shelf';
    els.toc.hidden = panel !== 'toc';
    els.body.classList.toggle('rr-panel-open', !!panel && !!rendition);
    root.classList.toggle('rr-library-only', !rendition);
    $('[data-action="shelf"]').setAttribute('aria-expanded', String(panel === 'shelf'));
    $('[data-action="toc"]').setAttribute('aria-expanded', String(panel === 'toc'));
  }

  function showLibrary() {
    setPanel(activePanel === 'shelf' && rendition ? null : 'shelf');
    message();
  }

  function renderBooks() {
    const merged = new Map();
    for (const entry of [...state.recent, ...catalog]) {
      if (!entry?.key || merged.has(entry.key)) continue;
      merged.set(entry.key, entry);
    }
    els.books.replaceChildren();
    for (const entry of merged.values()) {
      const button = document.createElement('button');
      button.type = 'button'; button.className = 'rr-book';
      button.setAttribute('aria-label', entry.title || filename(entry.url || ''));
      const mark = document.createElement('span');
      mark.className = 'rr-book-mark'; mark.innerHTML = icon('book');
      const text = document.createElement('span'); text.className = 'rr-book-text';
      const title = document.createElement('span'); title.className = 'rr-book-title';
      title.textContent = entry.title || filename(entry.url || '');
      text.append(title);
      if (entry.author) {
        const author = document.createElement('span'); author.className = 'rr-book-author';
        author.textContent = entry.author; text.append(author);
      }
      if (entry.key === current?.key) button.setAttribute('aria-current', 'true');
      button.append(mark, text);
      button.addEventListener('click', () => { void open(entry); }, { signal: lifetime.signal });
      els.books.append(button);
    }
    root.classList.toggle('rr-has-books', merged.size > 0);
  }

  async function loadCatalog() {
    if (!catalogUrl) return;
    catalogController = new AbortController();
    const signal = catalogController.signal;
    const candidates = [catalogUrl];
    if (catalogUrl === DEFAULT_CATALOG_URL) candidates.push(new URL('data/books-catalog.json', MODULE_ROOT).href);
    for (const candidate of candidates) {
      const timeout = new AbortController();
      const abort = () => timeout.abort();
      signal.addEventListener('abort', abort, { once: true });
      const timer = setTimeout(() => timeout.abort(), 9000);
      try {
        const url = sourceUrl(candidate);
        const response = await fetch(url, { signal: timeout.signal, credentials: 'omit', headers: { Accept: 'application/json' } });
        if (!response.ok) throw new Error('catalog unavailable');
        const entries = catalogEntries(await response.json(), url);
        if (dead || signal.aborted) return;
        catalog = entries;
        renderBooks();
        if (!rendition && !opening && entries.length) setPanel('shelf');
        return;
      } catch {
        if (dead || signal.aborted) return;
      } finally {
        clearTimeout(timer);
        signal.removeEventListener('abort', abort);
      }
    }
    if (!rendition && !opening) message('暂时无法读取书目。已载入的书仍保留在这里。');
  }

  function rememberCurrent() {
    if (!current) return;
    const entry = { ...current, updatedAt: Date.now() };
    delete entry.blob;
    state.recent = [entry, ...state.recent.filter(item => item.key !== current.key)].slice(0, 16);
    persist(state);
    renderBooks();
  }

  function saveLocation(location) {
    if (dead || !current || !location?.start?.cfi) return;
    // A late location report from the old page must not overwrite a requested chapter.
    if (navigationIndex !== null && location.start.index !== navigationIndex) return;
    if (navigationIndex !== null) { navigationTarget = null; navigationIndex = null; }
    currentLocation = location;
    const displayed = location.start.displayed;
    state.positions[current.key] = {
      cfi: location.start.cfi,
      index: location.start.index,
      page: displayed?.page,
      total: displayed?.total,
      fontSize: state.fontSize,
      viewport: `${els.viewer.clientWidth}x${els.viewer.clientHeight}`,
      updatedAt: Date.now(),
    };
    if (displayed?.page && displayed?.total) {
      els.position.textContent = `${displayed.page} / ${displayed.total}`;
      els.position.setAttribute('aria-label', `本章第 ${displayed.page} 页，共 ${displayed.total} 页`);
    } else els.position.textContent = '';
    persist(state);
    updateControls();
  }

  function clearBook() {
    clearTimeout(fontRefreshTimer);
    fontRefreshDone = false;
    navigating = false;
    navigationTarget = null;
    navigationIndex = null;
    currentLocation = null;
    for (const cleanup of frameCleanups) cleanup();
    frameCleanups.clear();
    try {
      if (book) book.destroy();
      else rendition?.destroy();
    } catch {
      // A partially loaded archive may have no spine yet.
      try { rendition?.destroy(); } catch { /* Already released. */ }
    }
    rendition = null; book = null;
    els.viewer.replaceChildren();
    els.chapters.replaceChildren();
    els.position.textContent = '';
    els.empty.hidden = false;
    root.classList.remove('rr-has-book');
  }

  function renderChapters(items) {
    els.chapters.replaceChildren();
    function list(entries) {
      const ul = document.createElement('ul');
      for (const entry of entries || []) {
        const li = document.createElement('li');
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = entry.label || filename(entry.href || '');
        button.addEventListener('click', () => { void goToChapter(entry.href); }, { signal: lifetime.signal });
        li.append(button);
        if (entry.subitems?.length) li.append(list(entry.subitems));
        ul.append(li);
      }
      return ul;
    }
    els.chapters.append(list(items));
    updateControls();
  }

  function close() {
    if (!els.urlForm.hidden) { els.urlForm.hidden = true; return; }
    if (activePanel && rendition) { setPanel(null); return; }
    options.onClose?.();
  }

  async function goToChapter(target) {
    const active = rendition;
    if (!active || opening || dead) return;
    navigating = true;
    navigationTarget = target;
    navigationIndex = book?.spine.get(target)?.index ?? null;
    setPanel(null);
    try {
      await active.started;
      if (!dead && active === rendition) await active.display(target);
    } catch {
      navigationTarget = null; navigationIndex = null;
      message('这一章节暂时无法打开。');
    } finally {
      if (active === rendition) navigating = false;
    }
  }

  function refreshAfterFontLoad(active, generation) {
    if (fontRefreshDone || dead || generation !== sequence || active !== rendition) return;
    clearTimeout(fontRefreshTimer);
    fontRefreshTimer = setTimeout(() => {
      if (dead || generation !== sequence || active !== rendition || fontRefreshDone) return;
      if (opening || turning || navigating || !active.manager?.isRendered?.()) {
        refreshAfterFontLoad(active, generation);
        return;
      }
      const anchor = navigationTarget || currentLocation?.start?.cfi;
      // display() resolves before relocated can publish its CFI. An undefined target
      // means "start at the cover" to epub.js, never "keep the current page".
      if (!anchor) {
        refreshAfterFontLoad(active, generation);
        return;
      }
      fontRefreshDone = true;
      // One redisplay after actual glyph availability, including fonts that arrive late.
      // No resize() call: epub.js owns its manager and window-resize lifecycle.
      void active.display(anchor).catch(() => {});
    }, 120);
  }

  async function turn(direction) {
    if (!rendition || opening || turning || navigating || dead) return;
    if (direction < 0 && currentLocation?.atStart || direction > 0 && currentLocation?.atEnd) return;
    turning = true;
    try { await (direction > 0 ? rendition.next() : rendition.prev()); }
    catch { message('这一页暂时无法打开。'); }
    finally { turning = false; }
  }

  async function restoreSameLayoutPage(active, saved) {
    const signature = `${els.viewer.clientWidth}x${els.viewer.clientHeight}`;
    if (!saved?.page || !saved.total || !Number.isInteger(saved.index)
      || saved.fontSize !== state.fontSize || saved.viewport !== signature) return false;
    let fontTimer;
    try {
      const fontLoads = active.getContents().map(content => content.document.fonts?.load(`${state.fontSize}px HuiwenMincho`));
      const loaded = await Promise.race([
        Promise.all(fontLoads).then(results => results.length > 0 && results.every(faces => faces?.length)),
        new Promise(resolve => { fontTimer = setTimeout(() => resolve(false), 12000); }),
      ]);
      if (!loaded || dead || active !== rendition) return false;
    } catch { return false; }
    finally { clearTimeout(fontTimer); }
    // epub.js reports relocated on animation frames after display() has resolved.
    await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
    if (dead || active !== rendition) return false;
    let location = active.location || currentLocation;
    const matches = value => value?.start?.index === saved.index
      && value.start.displayed?.total === saved.total;
    if (!matches(location) || Math.abs(saved.page - location.start.displayed.page) > 24) return false;
    for (let step = 0; step < 24 && location.start.displayed.page !== saved.page; step += 1) {
      if (dead || active !== rendition || !matches(location)) return false;
      const oldPage = location.start.displayed.page;
      const direction = saved.page > oldPage ? 'next' : 'prev';
      location = await new Promise(resolve => {
        let finished = false;
        let timeout;
        const finish = value => {
          if (finished) return;
          finished = true;
          clearTimeout(timeout);
          active.off('relocated', finish);
          resolve(value || active.location);
        };
        active.on('relocated', finish);
        timeout = setTimeout(() => finish(active.location), 1500);
        void active[direction]().catch(() => finish(active.location));
      });
      if (!matches(location) || location.start.displayed.page === oldPage) break;
    }
    return matches(location) && location.start.displayed.page === saved.page;
  }

  function keydown(event) {
    if (dead || !root.isConnected || !root.getClientRects().length) return;
    if (event.key === 'Escape') {
      event.preventDefault(); event.stopImmediatePropagation(); close(); return;
    }
    if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.target?.closest?.('input,textarea,select,[contenteditable="true"]')) return;
    if (activePanel || !els.urlForm.hidden) return;
    const direction = ['ArrowRight', 'PageDown'].includes(event.key) ? 1 : ['ArrowLeft', 'PageUp'].includes(event.key) ? -1 : 0;
    if (!direction || !rendition) return;
    event.preventDefault(); event.stopPropagation();
    void turn(direction);
  }

  async function styleContents(contents) {
    const doc = contents.document;
    const active = rendition;
    const generation = sequence;
    const imagePage = !!doc.querySelector('meta[name="calibre:cover"][content="true"]')
      || (!doc.body.textContent.trim() && !!doc.body.querySelector('svg image, img'));
    if (imagePage) {
      doc.documentElement.classList.add('rr-image-page');
      const maxWidth = Math.max(1, (contents.window.innerWidth || doc.documentElement.clientWidth) - 40);
      const maxHeight = Math.max(1, (contents.window.innerHeight || doc.documentElement.clientHeight) - 32);
      for (const svg of doc.body.querySelectorAll('svg[viewBox]')) {
        const box = svg.getAttribute('viewBox').trim().split(/[\s,]+/).map(Number);
        if (!(box[2] > 0 && box[3] > 0)) continue;
        const scale = Math.min(maxWidth / box[2], maxHeight / box[3]);
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        svg.style.setProperty('width', `${box[2] * scale}px`, 'important');
        svg.style.setProperty('height', `${box[3] * scale}px`, 'important');
        svg.style.setProperty('max-width', 'none', 'important');
        svg.style.setProperty('max-height', 'none', 'important');
        for (const image of svg.querySelectorAll('image')) image.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      }
    }
    const fontCss = `
      @font-face { font-family: HuiwenMincho; src: local("Huiwen-MinchoGBK"), local("汇文明朝体GBK"), local("匯文明朝體GBK"), url("${FONT_URL}") format("woff2"); font-display: swap; }
      html, body { background: transparent !important; color: #443846 !important; }
      body { font-family: HuiwenMincho, serif !important; font-size: ${state.fontSize}px !important; line-height: 1.9 !important; padding: 12px 26px !important; }
      body * { font-family: HuiwenMincho, serif !important; }
      body section, body article, body div, body p { background-color: transparent !important; color: #443846 !important; }
      p, li, blockquote { line-height: 1.9 !important; }
      p { margin-top: 0.55em !important; margin-bottom: 0.7em !important; }
      h1, h2, h3, h4 { color: #594151 !important; font-weight: normal !important; line-height: 1.55 !important; }
      a { color: #765365 !important; text-decoration-color: #9e7c8c !important; }
      img, video { max-width: 100% !important; max-height: calc(100vh - 40px) !important; width: auto !important; height: auto !important; object-fit: contain !important; }
      svg { max-width: 100% !important; max-height: calc(100vh - 40px) !important; }
      html.rr-image-page body { display: flex !important; align-items: center !important; justify-content: center !important; width: 100vw !important; height: 100vh !important; margin: 0 !important; padding: 0 !important; overflow: hidden !important; }
      html.rr-image-page body > div { display: flex !important; align-items: center !important; justify-content: center !important; width: 100% !important; height: 100% !important; }
      html.rr-image-page svg, html.rr-image-page img { display: block !important; margin: 0 auto !important; }
      ::selection { color: #3a3040; background: #b4a5be; }
    `;
    contents.addStylesheetCss(fontCss, 'raven-reader-theme');
    doc.addEventListener('keydown', keydown, true);
    const remove = () => doc.removeEventListener('keydown', keydown, true);
    frameCleanups.add(remove);
    // No wheel listener: a trackpad's pixel stream must never turn many pages at once.
    if (doc.fonts?.load) {
      let timedOut = false;
      let waitTimer;
      const fontReady = doc.fonts.load(`${state.fontSize}px HuiwenMincho`).then(faces => {
        if (timedOut && faces.length) refreshAfterFontLoad(active, generation);
      });
      try {
        await Promise.race([fontReady, new Promise(resolve => {
          waitTimer = setTimeout(() => { timedOut = true; resolve(); }, 12000);
        })]);
      } catch { /* The browser's serif fallback remains readable while the font is unavailable. */ }
      finally { clearTimeout(waitTimer); }
      // Keep observing the actual load after the finite wait, without an unhandled rejection.
      void fontReady.catch(() => {});
    }
  }

  async function open(source) {
    if (dead) return false;
    const mine = ++sequence;
    openController?.abort();
    openController = new AbortController();
    const signal = openController.signal;
    opening = true;
    message();
    els.loading.hidden = false;
    root.setAttribute('aria-busy', 'true');
    els.urlForm.hidden = true;
    let entry;
    try {
      if (source instanceof Blob) {
        const name = source.name || 'EPUB';
        const key = `file:${name}:${source.size}:${source.lastModified || 0}`;
        entry = { key, kind: 'file', title: name.replace(/\.epub$/i, ''), author: '', fileName: name };
        localFiles.set(key, source);
        void fileStore(key, source);
      } else if (typeof source === 'string') {
        const url = sourceUrl(source);
        entry = { key: `url:${url}`, kind: 'url', url, title: filename(url), author: '' };
      } else if (source?.kind === 'file' && source.key) {
        entry = { ...source };
      } else {
        const url = sourceUrl(source?.url || source?.download_url || source?.href || '');
        entry = { key: `url:${url}`, kind: 'url', url, title: source?.title || source?.name?.replace(/\.epub$/i, '') || filename(url), author: authorText(source?.author) };
      }
      await ensureDependencies();
      if (dead || mine !== sequence) return false;
      let bytes;
      if (entry.kind === 'file') {
        const file = localFiles.get(entry.key) || await fileStore(entry.key);
        if (!file) throw new Error('这本本地书未保留在浏览器中，请重新载入原 EPUB 文件。');
        bytes = await file.arrayBuffer();
      } else {
        const response = await fetch(entry.url, { signal, credentials: 'omit' });
        if (!response.ok) throw new Error('书籍地址暂时无法读取，请稍后再试。');
        bytes = await response.arrayBuffer();
      }
      if (dead || mine !== sequence) return false;
      clearBook();
      current = entry;
      const thisBook = window.ePub(undefined, { replacements: 'blobUrl' });
      book = thisBook;
      // epub.js exposes both promises; consume the ready rejection as well as opened.
      thisBook.ready.catch(() => {});
      // Explicit open() rejects for malformed files; the constructor's opened promise
      // can otherwise remain pending after an openFailed event in epub.js 0.3.
      await thisBook.open(bytes);
      if (dead || mine !== sequence) return false;
      const metadata = await thisBook.loaded.metadata;
      current.title = metadata.title?.trim() || entry.title;
      current.author = authorText(metadata.creator) || entry.author;
      els.title.textContent = current.title;
      els.author.textContent = current.author;
      // Keep the complete pre-open snapshot; the first relocated event can land at
      // the beginning of the same long CJK paragraph and replace the live state.
      const savedPosition = { ...state.positions[entry.key] };
      const savedCfi = typeof savedPosition.cfi === 'string' ? savedPosition.cfi : undefined;
      // Hold the saved target across initial display and font loading. Only a
      // relocated report from that spine item may replace the stored position.
      if (savedCfi) {
        navigationTarget = savedCfi;
        try { navigationIndex = thisBook.spine.get(savedCfi)?.index ?? null; }
        catch { navigationIndex = null; }
      }
      rendition = thisBook.renderTo(els.viewer, {
        width: '100%', height: '100%', flow: 'paginated', spread: 'none',
        allowScriptedContent: false, allowPopups: false,
      });
      const thisRendition = rendition;
      thisRendition.hooks.content.register(styleContents);
      thisRendition.themes.font('HuiwenMincho, serif');
      thisRendition.themes.override('font-size', `${state.fontSize}px`, true);
      thisRendition.on('relocated', location => {
        if (mine === sequence && !dead) saveLocation(location);
      });
      thisRendition.on('displayError', () => {
        if (mine === sequence && !dead) message('这一页暂时无法显示。');
      });
      setPanel(null);
      els.empty.hidden = true;
      root.classList.add('rr-has-book');
      try { await thisRendition.display(savedCfi || undefined); }
      catch (error) {
        if (!savedCfi) throw error;
        navigationTarget = null; navigationIndex = null;
        await thisRendition.display();
      }
      if (dead || mine !== sequence) return false;
      if (savedCfi && await restoreSameLayoutPage(thisRendition, savedPosition)) {
        // The real font and identical pagination are now verified; a pending
        // late-font redisplay must not collapse this precise page back to its CFI.
        fontRefreshDone = true;
        clearTimeout(fontRefreshTimer);
      }
      if (dead || mine !== sequence) return false;
      thisBook.loaded.navigation.then(nav => {
        if (!dead && mine === sequence) renderChapters(nav.toc || []);
      }).catch(() => {});
      rememberCurrent();
      message();
      return true;
    } catch (error) {
      if (dead || mine !== sequence || signal.aborted) return false;
      if (!rendition) {
        clearBook(); current = null;
        els.title.textContent = ''; els.author.textContent = '';
        setPanel('shelf');
      }
      const detail = error instanceof TypeError ? '无法读取这本书。请检查网络，或载入本地 EPUB 文件。' : error.message;
      message(detail || '这本书暂时无法打开。');
      return false;
    } finally {
      if (!dead && mine === sequence) {
        opening = false;
        els.loading.hidden = true;
        root.removeAttribute('aria-busy');
        updateControls();
      }
    }
  }

  function changeFont(delta) {
    if (!rendition) return;
    state.fontSize = Math.max(16, Math.min(34, state.fontSize + delta));
    // Keep the same logical position when the pagination changes.
    const cfi = currentLocation?.start?.cfi;
    const thisRendition = rendition;
    // Store priority in the theme override too, so re-rendered chapters keep it.
    thisRendition.themes.override('font-size', `${state.fontSize}px`, true);
    for (const contents of thisRendition.getContents()) {
      contents.document.body.style.setProperty('font-size', `${state.fontSize}px`, 'important');
    }
    persist(state);
    updateControls();
    if (cfi) requestAnimationFrame(() => {
      if (!dead && rendition === thisRendition) void thisRendition.display(cfi).catch(() => {});
    });
  }

  root.addEventListener('click', event => {
    const button = event.target.closest('button[data-action]');
    if (!button || button.disabled) return;
    const action = button.dataset.action;
    if (action === 'shelf') showLibrary();
    else if (action === 'file') els.file.click();
    else if (action === 'url') { els.urlForm.hidden = !els.urlForm.hidden; if (!els.urlForm.hidden) els.urlInput.focus(); }
    else if (action === 'dismiss-url') els.urlForm.hidden = true;
    else if (action === 'toc') setPanel(activePanel === 'toc' ? null : 'toc');
    else if (action === 'smaller') changeFont(-2);
    else if (action === 'larger') changeFont(2);
    else if (action === 'previous') void turn(-1);
    else if (action === 'next') void turn(1);
    else if (action === 'close') options.onClose?.();
  }, { signal: lifetime.signal });
  els.file.addEventListener('change', () => {
    const file = els.file.files?.[0];
    if (file) void open(file);
    els.file.value = '';
  }, { signal: lifetime.signal });
  els.urlForm.addEventListener('submit', event => {
    event.preventDefault();
    const url = els.urlInput.value.trim();
    if (url) void open(url);
  }, { signal: lifetime.signal });
  document.addEventListener('keydown', keydown, { capture: true, signal: lifetime.signal });
  window.addEventListener('pagehide', () => persist(state), { signal: lifetime.signal });

  renderBooks(); setPanel('shelf'); updateControls();
  const initial = options.bookUrl || (options.resume === false ? null : state.recent[0]);
  const ready = Promise.allSettled([loadCatalog(), initial ? open(initial) : Promise.resolve()]);
  return {
    open,
    ready,
    destroy() {
      if (dead) return;
      dead = true; sequence += 1;
      persist(state);
      lifetime.abort(); openController?.abort(); catalogController?.abort();
      clearTimeout(fontRefreshTimer);
      clearBook(); root.remove(); localFiles.clear();
    },
  };
}
