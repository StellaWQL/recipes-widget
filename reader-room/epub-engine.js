/**
 * EPUB rendering only. The surrounding reading desk owns UI, routing and storage.
 * Requires the packaged JSZip and epub.js browser scripts before construction.
 */
const TEXT_COLOR = '#78515b';
const HEADING_COLOR = '#875b68';
const DEFAULT_FONT_SIZE = 22;
const MIN_SPREAD_WIDTH = 700;

function safeUrl(value) {
  const url = new URL(String(value || ''), document.baseURI);
  if (!value || !['http:', 'https:'].includes(url.protocol)) {
    throw new Error('请使用可读取的 EPUB 文件地址。');
  }
  return url.href;
}

function titleFromUrl(value) {
  try { return decodeURIComponent(new URL(value, document.baseURI).pathname.split('/').pop()).replace(/\.epub$/i, ''); }
  catch { return ''; }
}

function authorText(value) {
  return Array.isArray(value) ? value.map(authorText).filter(Boolean).join(' · ') : String(value || '').trim();
}

function isAbort(error) { return error?.name === 'AbortError'; }

function abortError() { return new DOMException('Reading request superseded.', 'AbortError'); }

function deferFrame() {
  return new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
}

/** A finite font wait must not turn a missing font into an unusable reader. */
async function finiteWait(promise, milliseconds, fallback = null) {
  let timer;
  try {
    return await Promise.race([
      promise,
      new Promise(resolve => { timer = setTimeout(() => resolve(fallback), milliseconds); }),
    ]);
  } finally { clearTimeout(timer); }
}

async function fetchEpub(source, signal) {
  if (source instanceof Blob) return source.arrayBuffer();
  const candidates = [...new Set([source.url, source.localUrl].filter(Boolean).map(safeUrl))];
  if (!candidates.length) throw new Error('没有找到这本书的 EPUB 地址。');
  let lastError;
  for (const url of candidates) {
    if (signal.aborted) throw abortError();
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal.addEventListener('abort', abort, { once: true });
    const timeout = setTimeout(abort, 14000);
    try {
      const response = await fetch(url, { signal: controller.signal, credentials: 'omit' });
      if (!response.ok) throw new Error(`EPUB 请求失败 (${response.status})`);
      const bytes = await response.arrayBuffer();
      const magic = new Uint8Array(bytes, 0, Math.min(bytes.byteLength, 4));
      // Some static hosts return their HTML fallback with status 200.
      if (magic.length < 4 || magic[0] !== 0x50 || magic[1] !== 0x4b) {
        throw new Error('这个地址没有返回有效的 EPUB 文件。');
      }
      return bytes;
    } catch (error) {
      if (signal.aborted) throw abortError();
      lastError = error;
    } finally {
      clearTimeout(timeout);
      signal.removeEventListener('abort', abort);
    }
  }
  const error = new Error('这本书暂时无法读取，请检查网络或图书文件路径。');
  error.cause = lastError;
  throw error;
}

/**
 * @param {{container:Element,fontUrl:string,ornamentUrl?:string,onLocation?:Function,onNavigation?:Function,
 * onMetadata?:Function,onKeydown?:Function,onError?:Function}} options
 * @returns {Promise<object>} Call open only after container is visible and sized.
 */
export async function createBookEngine({
  container, fontUrl, ornamentUrl, onLocation, onNavigation, onMetadata, onKeydown, onError,
} = {}) {
  if (!(container instanceof Element)) throw new TypeError('A reader container is required.');
  if (typeof window.ePub !== 'function' || !window.JSZip) {
    throw new Error('阅读组件未能载入，请检查 vendor 文件路径。');
  }

  const fontSource = fontUrl ? new URL(fontUrl, document.baseURI).href : '';
  const ornamentSource = ornamentUrl ? new URL(ornamentUrl, document.baseURI).href : '';
  let dead = false;
  let generation = 0;
  let active = null;
  let fontSize = DEFAULT_FONT_SIZE;
  let resizeTimer;
  let fontFace = null;
  let outerFontReady = Promise.resolve(false);

  // Warm the same URL used inside the EPUB iframes; browsers share the font cache.
  if (fontSource && typeof FontFace === 'function' && document.fonts) {
    try {
      fontFace = new FontFace('HuiwenMincho', `url(${JSON.stringify(fontSource)})`, { display: 'swap' });
      document.fonts.add(fontFace);
      outerFontReady = fontFace.load().then(() => true).catch(() => false);
    } catch { /* The serif fallback remains usable. */ }
  }

  function current(ctx) { return !!ctx && !dead && ctx === active && ctx.generation === generation && !ctx.disposed; }

  function report(error, ctx = active) {
    if (!current(ctx) || isAbort(error)) return;
    const normalized = error instanceof Error ? error : new Error(String(error || '阅读出现问题。'));
    onError?.(normalized);
  }

  function destroyBook(ctx) {
    if (!ctx) return;
    clearTimeout(ctx.fontTimer);
    ctx.controller.abort();
    for (const remove of ctx.cleanups) { try { remove(); } catch {} }
    ctx.cleanups.clear();
    try { ctx.rendition?.q?.clear?.(); } catch {}
    try { ctx.book?.destroy(); }
    catch { try { ctx.rendition?.destroy(); } catch {} }
    ctx.rendition = null;
    ctx.book = null;
    ctx.disposed = true;
  }

  function emitLocation(ctx, location) {
    if (!current(ctx) || !location?.start?.cfi) return;
    // A stale report from the previous chapter must not overwrite the jump target.
    if (ctx.targetIndex !== null && location.start.index !== ctx.targetIndex) return;
    ctx.location = location;
    if (ctx.targetIndex !== null) {
      ctx.target = null;
      ctx.targetIndex = null;
    }
    if (!ctx.opening) onLocation?.(location);
  }

  function setTarget(ctx, target) {
    ctx.target = target || null;
    ctx.targetIndex = null;
    if (!target) return;
    try { ctx.targetIndex = ctx.book?.spine.get(target)?.index ?? null; } catch {}
  }

  function scheduleFontRefresh(ctx) {
    if (!current(ctx) || ctx.fontRefreshed) return;
    clearTimeout(ctx.fontTimer);
    ctx.fontTimer = setTimeout(async () => {
      if (!current(ctx) || ctx.fontRefreshed) return;
      if (ctx.busy || ctx.opening || !ctx.rendition?.manager?.isRendered?.()) {
        scheduleFontRefresh(ctx);
        return;
      }
      const anchor = ctx.target || ctx.location?.start?.cfi;
      if (!anchor) { scheduleFontRefresh(ctx); return; }
      ctx.fontRefreshed = true;
      try { await ctx.rendition.display(anchor); }
      catch (error) { report(error, ctx); }
    }, 130);
  }

  function themeCss() {
    return `
      ${fontSource ? `@font-face {font-family:HuiwenMincho;src:url(${JSON.stringify(fontSource)}) format("woff2");font-display:swap;}` : ''}
      html,body { background:transparent !important; color:${TEXT_COLOR} !important; }
      body { font-family:HuiwenMincho,"Songti SC","Noto Serif CJK SC",serif !important;
        font-size:${fontSize}px !important; line-height:1.85 !important;
        padding-top:10px !important; padding-bottom:14px !important;
        overflow-wrap:break-word; text-rendering:optimizeLegibility; }
      body :is(p,div,span,section,article,li,blockquote,td,th,dd,dt,em,strong) {
        color:${TEXT_COLOR} !important; background-color:transparent !important;
        font-family:inherit !important; }
      p,li,blockquote {line-height:1.85 !important;}
      p {margin-top:0.45em !important;margin-bottom:0.65em !important;}
      h1,h2,h3,h4,h5,h6 {font-family:HuiwenMincho,serif !important;
        color:${HEADING_COLOR} !important; font-weight:normal !important; line-height:1.5 !important;
        break-after:avoid; page-break-after:avoid;}
      h1,h2 {text-align:center !important;font-size:1.32em !important;margin:1em 0 1.3em !important;}
      ${ornamentSource ? `.rr-chapter-heading {break-inside:avoid;page-break-inside:avoid;}
      .rr-chapter-heading::after {content:"";display:block;width:116px;height:66px;
        margin:.4em auto .2em;background-image:url(${JSON.stringify(ornamentSource)});
        background-size:300% 200%;background-position:100% 100%;background-repeat:no-repeat;
        break-inside:avoid;page-break-inside:avoid;}` : ''}
      a {color:#965f70 !important;text-decoration-color:#c99da7 !important;}
      pre,code {font-family:monospace !important;font-size:.88em;}
      img,video {max-width:100% !important;max-height:calc(100vh - 32px) !important;
        width:auto !important;height:auto !important;object-fit:contain !important;}
      svg {max-width:100% !important;max-height:calc(100vh - 32px) !important;}
      table {max-width:100% !important;table-layout:auto;}
      ::selection {background:#dfb6c0;color:#603f49;}
      html.rr-image-page body {margin:0 !important;}
      html.rr-image-page img,html.rr-image-page svg {display:block !important;margin:auto !important;}
    `;
  }

  async function styleContents(ctx, contents) {
    if (!current(ctx)) return;
    const doc = contents.document;
    if (ornamentSource) doc.querySelector('h1,h2')?.classList.add('rr-chapter-heading');
    contents.addStylesheetCss(themeCss(), 'rose-reader-theme');
    const forward = event => { if (current(ctx)) onKeydown?.(event); };
    doc.addEventListener('keydown', forward, true);
    const remove = () => doc.removeEventListener('keydown', forward, true);
    ctx.cleanups.add(remove);
    // View unload releases this document early; full destroy also removes remaining listeners.
    const unload = () => { remove(); ctx.cleanups.delete(remove); };
    contents.window.addEventListener('unload', unload, { once: true });

    const imagePage = !!doc.querySelector('meta[name="calibre:cover"][content="true"]')
      || (!doc.body.textContent.trim() && !!doc.querySelector('svg image,img'));
    if (imagePage) {
      doc.documentElement.classList.add('rr-image-page');
      const maxWidth = Math.max(1, (ctx.rendition?.layout?.columnWidth || container.clientWidth) - 12);
      const maxHeight = Math.max(1, container.clientHeight - 32);
      for (const svg of doc.querySelectorAll('svg[viewBox]')) {
        const box = svg.getAttribute('viewBox').trim().split(/[\s,]+/).map(Number);
        if (!(box[2] > 0 && box[3] > 0)) continue;
        const scale = Math.min(maxWidth / box[2], maxHeight / box[3]);
        svg.setAttribute('preserveAspectRatio', 'xMidYMid meet');
        svg.style.setProperty('width', `${box[2] * scale}px`, 'important');
        svg.style.setProperty('height', `${box[3] * scale}px`, 'important');
        for (const image of svg.querySelectorAll('image')) image.setAttribute('preserveAspectRatio', 'xMidYMid meet');
      }
    }

    if (fontSource && doc.fonts?.load) {
      let finite = true;
      const fontReady = doc.fonts.load(`${fontSize}px HuiwenMincho`).then(faces => {
        if (!finite && faces.length) scheduleFontRefresh(ctx);
        return !!faces.length;
      }).catch(() => false);
      await finiteWait(fontReady, 4500, false);
      finite = false;
    }
  }

  async function open(source, { savedCfi } = {}) {
    if (dead) return false;
    const mine = ++generation;
    destroyBook(active);
    container.replaceChildren();
    const entry = source instanceof Blob ? {
      key: `file:${source.name || 'EPUB'}:${source.size}:${source.lastModified || 0}`,
      title: (source.name || 'EPUB').replace(/\.epub$/i, ''),
    } : typeof source === 'string' ? { url: source, title: titleFromUrl(source) } : { ...source };
    const ctx = {
      generation:mine, controller:new AbortController(), cleanups:new Set(),
      source:entry, book:null, rendition:null, location:null, opening:true, busy:false,
      target:null, targetIndex:null, fontRefreshed:false, disposed:false, fontTimer:null,
      width:0, height:0,
    };
    active = ctx;
    try {
      const [bytes] = await Promise.all([
        fetchEpub(source instanceof Blob ? source : entry, ctx.controller.signal),
        finiteWait(outerFontReady, 6000, false),
      ]);
      if (!current(ctx)) return false;
      if (container.clientWidth < 1 || container.clientHeight < 1) {
        throw new Error('阅读区域尚未展开，请稍后重新打开这本书。');
      }
      const thisBook = window.ePub(undefined, { replacements:'blobUrl' });
      ctx.book = thisBook;
      thisBook.ready.catch(() => {});
      await thisBook.open(bytes);
      if (!current(ctx)) { try { thisBook.destroy(); } catch {} return false; }
      const metadata = await thisBook.loaded.metadata;
      if (!current(ctx)) return false;
      onMetadata?.({ ...metadata,
        title:String(metadata.title || entry.title || titleFromUrl(entry.url)).trim(),
        creator:authorText(metadata.creator || entry.author), source:entry,
      });
      ctx.width = container.clientWidth;
      ctx.height = container.clientHeight;
      ctx.rendition = thisBook.renderTo(container, {
        width:'100%', height:'100%', manager:'default', flow:'paginated',
        spread:'always', minSpreadWidth:MIN_SPREAD_WIDTH,
        allowScriptedContent:false, allowPopups:false,
      });
      const rendition = ctx.rendition;
      rendition.hooks.content.register(contents => styleContents(ctx, contents));
      rendition.themes.font('HuiwenMincho, "Songti SC", serif');
      rendition.themes.override('font-size', `${fontSize}px`, true);
      rendition.on('relocated', location => emitLocation(ctx, location));
      rendition.on('displayError', error => report(error || new Error('这一页暂时无法显示。'), ctx));
      setTarget(ctx, typeof savedCfi === 'string' ? savedCfi : null);
      try { await rendition.display(ctx.target || undefined); }
      catch (error) {
        if (!current(ctx)) return false;
        if (!savedCfi) throw error;
        setTarget(ctx, null);
        await rendition.display();
      }
      if (!current(ctx)) return false;
      thisBook.loaded.navigation.then(navigation => {
        if (current(ctx)) onNavigation?.(navigation.toc || []);
      }).catch(error => report(error, ctx));
      await deferFrame();
      if (current(ctx)) {
        // The first display and its font wait have finished. Only now may callers
        // replace the persisted CFI, including when an obsolete CFI needed fallback.
        ctx.opening = false;
        if (rendition.location?.start?.cfi) emitLocation(ctx, rendition.location);
        else if (ctx.location) onLocation?.(ctx.location);
      }
      return current(ctx);
    } catch (error) {
      if (!current(ctx) || ctx.controller.signal.aborted) return false;
      report(error, ctx);
      destroyBook(ctx);
      container.replaceChildren();
      return false;
    } finally {
      if (current(ctx)) ctx.opening = false;
    }
  }

  async function perform(action, target) {
    const ctx = active;
    if (!current(ctx) || !ctx.rendition || ctx.opening || ctx.busy) return false;
    if ((action === 'prev' && ctx.location?.atStart) || (action === 'next' && ctx.location?.atEnd)) return false;
    ctx.busy = true;
    if (action === 'display') setTarget(ctx, target);
    try {
      if (action === 'display') await ctx.rendition.display(target);
      else await ctx.rendition[action]();
      return current(ctx);
    } catch (error) {
      if (action === 'display') setTarget(ctx, null);
      report(error, ctx);
      return false;
    } finally { if (current(ctx)) ctx.busy = false; }
  }

  function resize() {
    const ctx = active;
    if (!current(ctx) || !ctx.rendition || ctx.opening) return false;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width < 1 || height < 1 || (width === ctx.width && height === ctx.height)) return false;
    if (ctx.busy) {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 120);
      return false;
    }
    ctx.width = width; ctx.height = height;
    // epub.js consumes the third argument as the CFI to redisplay after resizing.
    // Never call display(undefined) for a resize, which would return to the cover.
    const anchor = ctx.target || ctx.location?.start?.cfi;
    try { ctx.rendition.resize(width, height, anchor); return true; }
    catch (error) { report(error, ctx); return false; }
  }

  async function setFontSize(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return false;
    fontSize = Math.max(16, Math.min(34, parsed));
    const ctx = active;
    if (!current(ctx) || !ctx.rendition) return true;
    const cfi = ctx.target || ctx.location?.start?.cfi;
    ctx.rendition.themes.override('font-size', `${fontSize}px`, true);
    for (const contents of ctx.rendition.getContents()) {
      contents.document.body.style.setProperty('font-size', `${fontSize}px`, 'important');
    }
    if (cfi) {
      await deferFrame();
      if (current(ctx)) return perform('display', cfi);
    }
    return current(ctx);
  }

  const resizeObserver = typeof ResizeObserver === 'function' ? new ResizeObserver(() => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(resize, 120);
  }) : null;
  resizeObserver?.observe(container);

  return {
    open,
    next:() => perform('next'),
    prev:() => perform('prev'),
    display:target => typeof target === 'string' && target ? perform('display', target) : Promise.resolve(false),
    resize,
    setFontSize,
    get currentLocation() { return active?.location || null; },
    get currentBook() { return active?.book || null; },
    destroy() {
      if (dead) return;
      dead = true; generation += 1;
      clearTimeout(resizeTimer);
      resizeObserver?.disconnect();
      destroyBook(active);
      active = null;
      container.replaceChildren();
      if (fontFace) { try { document.fonts.delete(fontFace); } catch {} }
    },
  };
}
