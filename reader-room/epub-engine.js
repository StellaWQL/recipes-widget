/**
 * EPUB rendering only. The surrounding reading desk owns UI, routing and storage.
 * Requires the packaged JSZip and epub.js browser scripts before construction.
 */
const TEXT_COLOR = '#78515b';
const HEADING_COLOR = '#875b68';
const DEFAULT_FONT_SIZE = 17;
// The host selects scroll below its 900px breakpoint. Explicit spread mode must
// remain two pages even when the decorative desktop frame leaves a narrow viewer.
// This vendor treats zero as an omitted option, so use one rather than zero.
const MIN_SPREAD_WIDTH = 1;

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

/**
 * Lock only the HTML reading surface to the light paper theme. Publication
 * styles sometimes contain inline !important declarations, which a stylesheet
 * selector cannot outrank. No EPUB nodes or text are removed, preserving CFIs.
 */
function lockLightContents(contents) {
  const doc = contents.document;
  const view = contents.window;
  const html = doc.documentElement;
  const body = doc.body;
  if (!html || !body) return;

  // Official Dark Reader page opt-out, including dynamically created documents:
  // https://github.com/darkreader/darkreader/blob/main/CONTRIBUTING.md#disabling-dark-reader-on-your-site
  if (doc.head && !doc.head.querySelector('meta[name="darkreader-lock"]')) {
    const lock = doc.createElement('meta');
    lock.setAttribute('name', 'darkreader-lock');
    doc.head.appendChild(lock);
  }

  let scheme = doc.head?.querySelector('meta[name="color-scheme"]');
  if (!scheme && doc.head) {
    scheme = doc.createElement('meta');
    scheme.setAttribute('name', 'color-scheme');
    doc.head.appendChild(scheme);
  }
  scheme?.setAttribute('content', 'only light');
  for (const duplicate of doc.head?.querySelectorAll('meta[name="color-scheme"]') || []) {
    duplicate.setAttribute('content', 'only light');
  }

  const frame = view.frameElement;
  for (const element of [frame, html, body].filter(Boolean)) {
    element.style.setProperty('color-scheme', 'only light', 'important');
    element.style.setProperty('background-color', 'transparent', 'important');
  }
  frame?.style.setProperty('background-image', 'none', 'important');
  body.style.setProperty('font-family', 'HuiwenMincho,"Songti SC","Noto Serif CJK SC",serif', 'important');

  const containers = [html, body, ...body.querySelectorAll(
    'main,section,article,div,p,span,h1,h2,h3,h4,h5,h6,ul,ol,li,blockquote,pre,code,'
    + 'table,thead,tbody,tfoot,tr,td,th,dl,dt,dd,figure,figcaption,a,b,strong,i,em,'
    + 'font,small,big,mark,label,address,aside,header,footer,center'
  )];
  for (const element of containers) {
    // SVG illustrations (including foreignObject labels) keep their original ink.
    if (element.namespaceURI !== 'http://www.w3.org/1999/xhtml' || element.closest('svg,math')) continue;
    const computed = view.getComputedStyle(element);
    element.style.setProperty('background-color', 'transparent', 'important');
    // Preserve actual raster/SVG background artwork. Remove only non-image fills
    // such as CSS gradients; img/picture/svg/video elements are never selected.
    if (!/url\(/i.test(computed.backgroundImage || '')) {
      element.style.setProperty('background-image', 'none', 'important');
    }
    if (!element.textContent.trim() && element !== html && element !== body) continue;
    const ink = element.closest('h1,h2,h3,h4,h5,h6') ? HEADING_COLOR
      : element.closest('a') ? '#965f70' : TEXT_COLOR;
    element.style.setProperty('color', ink, 'important');
    element.style.setProperty('text-shadow', 'none', 'important');
    // Override a publisher's explicit WebKit white text fill only where actual
    // HTML text lives, avoiding an inherited fill that would recolor an SVG.
    if ([...element.childNodes].some(node => node.nodeType === 3 && node.textContent.trim())) {
      element.style.setProperty('-webkit-text-fill-color', ink, 'important');
    }
  }
}

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
 * @param {{container:Element,fontUrl:string,onLocation?:Function,onNavigation?:Function,
 * onMetadata?:Function,onKeydown?:Function,onError?:Function,layout?:'spread'|'scroll'}} options
 * @returns {Promise<object>} Call open only after container is visible and sized.
 */
export async function createBookEngine({
  container, fontUrl, onLocation, onNavigation, onMetadata, onKeydown, onError, layout = 'spread',
} = {}) {
  if (!(container instanceof Element)) throw new TypeError('A reader container is required.');
  if (typeof window.ePub !== 'function' || !window.JSZip) {
    throw new Error('阅读组件未能载入，请检查 vendor 文件路径。');
  }

  const fontSource = fontUrl ? new URL(fontUrl, document.baseURI).href : '';
  let dead = false;
  let generation = 0;
  let active = null;
  let requestedLayout = layout === 'scroll' ? 'scroll' : 'spread';
  let layoutWork = Promise.resolve(true);
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
  function currentView(ctx, rendition) { return current(ctx) && ctx.rendition === rendition; }
  function sameGeometry(ctx) {
    return container.clientWidth === ctx.width && container.clientHeight === ctx.height
      && ctx.width > 0 && ctx.height > 0;
  }

  function report(error, ctx = active) {
    if (!current(ctx) || isAbort(error)) return;
    const normalized = error instanceof Error ? error : new Error(String(error || '阅读出现问题。'));
    onError?.(normalized);
  }

  function destroyRendition(ctx) {
    const rendition = ctx.rendition;
    // Invalidate callbacks before the vendor removes any iframe documents.
    ctx.rendition = null;
    clearTimeout(ctx.fontTimer);
    clearTimeout(ctx.scrollFillTimer);
    for (const remove of ctx.viewCleanups) { try { remove(); } catch {} }
    ctx.viewCleanups.clear();
    ctx.contentTasks.clear();
    for (const hook of ctx.spineHooks) {
      try { ctx.book?.spine?.hooks?.content?.deregister(hook); } catch {}
    }
    ctx.spineHooks = [];
    if (!rendition) return;
    const manager = rendition.manager;
    for (const timer of ['trimTimeout', 'scrollTimeout', 'orientationTimeout', 'resizeTimeout', 'afterScrolled']) {
      clearTimeout(manager?.[timer]);
    }
    manager?._scrolled?.cancel?.();
    // The packaged stage removes "orientationChange" instead of the actual
    // "orientationchange" listener. Remove its original callback explicitly.
    if (manager?.stage?.orientationChangeFunc) {
      window.removeEventListener('orientationchange', manager.stage.orientationChangeFunc);
    }
    try { manager?.q?.stop?.(); rendition.q?.stop?.(); } catch {}
    try { rendition.destroy(); } catch {}
    if (ctx.book?.rendition === rendition) ctx.book.rendition = undefined;
  }

  function destroyBook(ctx) {
    if (!ctx) return;
    ctx.controller.abort();
    destroyRendition(ctx);
    for (const remove of ctx.cleanups) { try { remove(); } catch {} }
    ctx.cleanups.clear();
    ctx.archiveImageUrls.clear();
    try { ctx.book?.destroy(); } catch {}
    ctx.book = null;
    ctx.disposed = true;
    ctx.finishOpen?.();
    ctx.finishBusy?.();
  }

  function emitLocation(ctx, location) {
    if (!current(ctx) || !location?.start?.cfi) return;
    // A stale report from the previous chapter must not overwrite the jump target.
    if (ctx.targetIndex !== null && location.start.index !== ctx.targetIndex) return;
    // Initial reports can precede asynchronous image/font hooks in epub.js.
    // Keep the original restoration target until the final layout is ready.
    if (ctx.opening || ctx.busy) return;
    // Responsive CSS changes before ResizeObserver/media handlers finish. An old
    // view can then report a different chapter using the new geometry. Preserve
    // the last published reading position until its resize/layout is settled.
    if (ctx.layout !== requestedLayout || !sameGeometry(ctx)) return;
    ctx.location = location;
    if (ctx.targetIndex !== null) {
      ctx.target = null;
      ctx.targetIndex = null;
    }
    onLocation?.(location);
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
      try { await perform('display', anchor); }
      catch (error) { report(error, ctx); }
    }, 130);
  }

  function themeCss(mode) {
    return `
      ${fontSource ? `@font-face {font-family:HuiwenMincho;src:url(${JSON.stringify(fontSource)}) format("woff2");font-display:swap;}` : ''}
      :root {color-scheme:only light !important;--rr-text-size:${fontSize}px;}
      html,body {background-color:transparent !important;color:${TEXT_COLOR} !important;}
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
      a {color:#965f70 !important;text-decoration-color:#c99da7 !important;}
      pre,code {font-family:monospace !important;font-size:.88em;}
      img,video {max-width:100% !important;max-height:calc(100vh - 32px) !important;
        width:auto !important;height:auto !important;object-fit:contain !important;}
      svg {max-width:100% !important;max-height:calc(100vh - 32px) !important;}
      /* A note marker is inline typography, not an illustration. In particular,
         Duokan EPUBs use a 48px PNG whose publisher width is 0.8em; the generic
         image width:auto above must never make that asset full intrinsic size. */
      body :is(a.duokan-footnote,a.noteref,a.footnote-ref,a.footnoteRef,
        a.footnote-reference,a.fnanchor,a[rel~="footnote"],
        [role~="doc-noteref"],[epub\\:type~="noteref"]) {
        font-size:calc(var(--rr-text-size) * .72) !important;
        display:inline !important;float:none !important;line-height:1 !important;
        vertical-align:.18em !important;text-indent:0 !important;white-space:nowrap;
        margin:0 .08em !important;padding:0 !important; }
      body :is(a.duokan-footnote,a.noteref,a.footnote-ref,a.footnoteRef,
        a.footnote-reference,a.fnanchor,a[rel~="footnote"],
        [role~="doc-noteref"],[epub\\:type~="noteref"]) :is(img,svg) {
        display:inline-block !important;float:none !important;
        width:1em !important;height:1em !important;
        max-width:1em !important;max-height:1em !important;
        min-width:0 !important;min-height:0 !important;
        margin:0 !important;padding:0 !important;vertical-align:text-bottom !important;
        object-fit:contain !important; }
      body :is(.duokan-footnote-item,.footnote-item,li.footnote,aside.footnote,
        div.footnote,p.footnote,li.endnote,aside.endnote,div.endnote,p.endnote,
        [role~="doc-footnote"],[role~="doc-endnote"],
        [epub\\:type~="footnote"],[epub\\:type~="endnote"]) {
        font-size:calc(var(--rr-text-size) * .8) !important;line-height:1.7 !important; }
      body :is(.duokan-footnote-item,.footnote-item,li.footnote,aside.footnote,
        div.footnote,p.footnote,li.endnote,aside.endnote,div.endnote,p.endnote,
        [role~="doc-footnote"],[role~="doc-endnote"],
        [epub\\:type~="footnote"],[epub\\:type~="endnote"])
        :is(p,div,span,li,blockquote,a,em,strong,small) {
        font-size:inherit !important;line-height:1.7 !important; }
      table {max-width:100% !important;table-layout:auto;}
      ::selection {background:#dfb6c0;color:#603f49;}
      html.rr-image-page body {margin:0 !important;}
      html.rr-image-page img,html.rr-image-page svg {display:block !important;margin:auto !important;}
      ${mode === 'scroll' ? `
        html {overflow:hidden !important;}
        body {margin:0 !important;padding:18px 14px 30px !important;
          height:auto !important;max-height:none !important;overflow:visible !important;}
        img,video,svg {max-height:${Math.max(240, container.clientHeight - 40)}px !important;}
      ` : ''}
    `;
  }

  /**
   * Some otherwise readable EPUBs omit an image from their OPF manifest, so
   * epub.js cannot replace its relative URL. Resolve only exact archive entries;
   * do not guess file names, fetch external resources, or change CFI-bearing nodes.
   */
  async function repairArchiveImages(ctx, contents, rendition) {
    const archive = ctx.book?.archive;
    if (!archive?.zip || typeof archive.getBlob !== 'function') return;
    const section = ctx.book.spine.get(contents.sectionIndex);
    if (!section?.href) return;
    const origin = 'https://epub-archive.invalid';
    let base;
    try { base = new URL(ctx.book.resolve(section.href, false), `${origin}/`); }
    catch { return; }
    if (base.origin !== origin) return;

    await Promise.all([...contents.document.querySelectorAll('img[src],svg image')].map(async image => {
      const attribute = image.hasAttribute('src') ? 'src'
        : image.hasAttribute('href') ? 'href' : 'xlink:href';
      const original = image.getAttribute(attribute);
      const source = original?.trim();
      // Existing blob/data URLs, external URLs, and SVG fragment references stay intact.
      if (!source || /^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(source) || source.includes('\\')) return;
      let resource, path;
      try {
        resource = new URL(source, base);
        path = decodeURIComponent(resource.pathname).replace(/^\//, '');
      } catch { return; }
      if (resource.origin !== origin || !/\.(?:avif|bmp|gif|jpe?g|png|svg|webp)$/i.test(path)) return;
      const entry = archive.zip.file(path);
      if (!entry || entry.dir) return;

      let pending = ctx.archiveImageUrls.get(path);
      if (!pending) {
        // archive.getBlob supplies the image MIME type. Own the fallback URL so
        // switching books revokes it even with older epub.js archive cleanup.
        pending = Promise.resolve(archive.getBlob(resource.pathname)).then(blob => {
          if (!blob || !current(ctx)) return null;
          const url = URL.createObjectURL(blob);
          ctx.cleanups.add(() => URL.revokeObjectURL(url));
          return url;
        }).catch(() => null);
        ctx.archiveImageUrls.set(path, pending);
      }
      const url = await pending;
      if (!url || !currentView(ctx, rendition) || image.getAttribute(attribute) !== original) return;
      const loaded = new Promise(resolve => {
        let timer;
        const finish = () => {
          clearTimeout(timer);
          image.removeEventListener('load', finish);
          image.removeEventListener('error', finish);
          ctx.viewCleanups.delete(finish);
          resolve();
        };
        image.addEventListener('load', finish, { once:true });
        image.addEventListener('error', finish, { once:true });
        // Finite waiting keeps a corrupt archive image from blocking a chapter.
        timer = setTimeout(finish, 1800);
        ctx.viewCleanups.add(finish);
        image.setAttribute(attribute, url + resource.hash);
        if (image.complete) finish();
      });
      await loaded;
    }));
  }

  async function styleContents(ctx, contents, rendition, mode) {
    if (!currentView(ctx, rendition)) return;
    const doc = contents.document;
    contents.addStylesheetCss(themeCss(mode), 'rose-reader-theme');
    lockLightContents(contents);
    await repairArchiveImages(ctx, contents, rendition);
    if (!currentView(ctx, rendition)) return;
    const forward = event => {
      // Scroll mode leaves all native scrolling keys and touch gestures alone.
      if (currentView(ctx, rendition) && (mode === 'spread' || event.key === 'Escape')) onKeydown?.(event);
    };
    doc.addEventListener('keydown', forward, true);
    const remove = () => doc.removeEventListener('keydown', forward, true);
    ctx.viewCleanups.add(remove);
    // View unload releases this document early; full destroy also removes remaining listeners.
    const unload = () => { remove(); ctx.viewCleanups.delete(remove); };
    contents.window.addEventListener('unload', unload, { once: true });

    const imagePage = !!doc.querySelector('meta[name="calibre:cover"][content="true"]')
      || (!doc.body.textContent.trim() && !!doc.querySelector('svg image,img'));
    if (imagePage) {
      doc.documentElement.classList.add('rr-image-page');
      const maxWidth = Math.max(1, (rendition.layout?.columnWidth || container.clientWidth) - 12);
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
        if (!finite && faces.length && currentView(ctx, rendition)) scheduleFontRefresh(ctx);
        return !!faces.length;
      }).catch(() => false);
      await finiteWait(fontReady, 4500, false);
      finite = false;
    }
  }

  async function settleContents(ctx, rendition = ctx.rendition) {
    // In this epub.js version display() resolves before afterDisplayed() awaits
    // its content hooks. Yield once so those hooks register, then await our work.
    await deferFrame();
    while (currentView(ctx, rendition) && ctx.contentTasks.size) {
      await Promise.all([...ctx.contentTasks]);
    }
    if (!currentView(ctx, rendition)) return false;
    // Fonts and repaired images may have changed the number of columns. Reflow
    // existing views before looking up the requested CFI a second time.
    rendition.manager.updateLayout();
    await deferFrame();
    return currentView(ctx, rendition);
  }

  function nativeManager(mode) {
    const name = mode === 'scroll' ? 'continuous' : 'default';
    const Base = window.ePub.Rendition?.prototype?.requireManager?.(name);
    if (typeof Base !== 'function') return name;
    // Keep the vendor's native continuous loading/scrolling implementation, but
    // omit its anonymous window-unload listener, which cannot be removed when
    // switching layouts. The host owns pagehide and calls engine.destroy().
    return class ReaderManager extends Base {
      render(...args) {
        const result = super.render(...args);
        if (mode === 'scroll') {
          // Apply before the first fill(), not after display() resolves. Native
          // continuous already compensates scrollTop when a chapter is prepended.
          this.container.style.overflowAnchor = 'none';
          this.container.style.overflowX = 'hidden';
          this.container.dataset.readerLayout = 'scroll';
        }
        return result;
      }

      scrollTo(...args) {
        const result = super.scrollTo(...args);
        if (mode === 'scroll' && this.container) {
          // check() runs synchronously after programmatic positioning, before
          // the browser dispatches its scroll event. Do not test stale offsets.
          this.scrollTop = this.container.scrollTop;
          this.scrollLeft = this.container.scrollLeft;
        }
        return result;
      }

      scrollBy(...args) {
        const result = super.scrollBy(...args);
        if (mode === 'scroll' && this.container) {
          this.scrollTop = this.container.scrollTop;
          this.scrollLeft = this.container.scrollLeft;
        }
        return result;
      }

      fill() {
        if (mode !== 'scroll') return Promise.resolve();
        // The bundled fill() forgets to reject its outer deferred when check()
        // fails. Keep its native queue/check algorithm, but propagate failures.
        return this.q.enqueue(() => this.check()).then(more => more ? this.fill() : undefined);
      }

      addEventListeners() {
        if (mode === 'scroll') this.addScrollListeners();
        else {
          this._onScroll = this.onScroll.bind(this);
          this.container.addEventListener('scroll', this._onScroll, { passive:true });
        }
      }
    };
  }

  function createRendition(ctx, mode) {
    ctx.layout = mode;
    ctx.fontRefreshed = false;
    ctx.width = container.clientWidth;
    ctx.height = container.clientHeight;
    const contentHooks = ctx.book.spine.hooks?.content;
    const previousHooks = new Set(contentHooks?.list?.() || []);
    const rendition = ctx.book.renderTo(container, {
      width:ctx.width, height:ctx.height, manager:nativeManager(mode),
      flow:mode === 'scroll' ? 'scrolled-continuous' : 'paginated',
      spread:mode === 'scroll' ? 'none' : 'always', minSpreadWidth:MIN_SPREAD_WIDTH,
      axis:mode === 'scroll' ? 'vertical' : 'horizontal',
      overflow:mode === 'scroll' ? 'auto' : 'hidden', fullsize:false, snap:false,
      resizeOnOrientationChange:false,
      ...(mode === 'scroll' ? { gap:0, offset:Math.max(450, ctx.height), offsetDelta:250 } : {}),
      allowScriptedContent:false, allowPopups:false,
    });
    ctx.rendition = rendition;
    // Rendition.destroy() leaves its bound injectIdentifier hook on the shared
    // book. Without this ownership list, a later chapter calls a destroyed reader.
    ctx.spineHooks = (contentHooks?.list?.() || []).filter(hook => !previousHooks.has(hook));
    rendition.hooks.content.register(contents => {
      if (!currentView(ctx, rendition)) return;
      const task = styleContents(ctx, contents, rendition, mode);
      ctx.contentTasks.add(task);
      const remove = () => ctx.contentTasks.delete(task);
      task.then(remove, remove);
      return task;
    });
    rendition.themes.font('HuiwenMincho, "Songti SC", serif');
    rendition.themes.override('font-size', `${fontSize}px`, true);
    ctx.appliedFontSize = fontSize;
    rendition.on('relocated', location => { if (currentView(ctx, rendition)) emitLocation(ctx, location); });
    rendition.on('displayerror', error => {
      if (currentView(ctx, rendition) && !ctx.workWaits) report(error || new Error('这一页暂时无法显示。'), ctx);
    });
    return rendition;
  }

  function configureScroller(ctx, rendition) {
    const scroller = rendition.manager?.container;
    if (!scroller || !currentView(ctx, rendition)) return;
    scroller.dataset.readerLayout = ctx.layout;
    scroller.style.background = 'transparent';
    scroller.style.colorScheme = 'only light';
    scroller.style.overflowX = 'hidden';
    scroller.style.overflowY = ctx.layout === 'scroll' ? 'auto' : 'hidden';
    scroller.style.overscrollBehaviorY = 'contain';
    scroller.style.scrollBehavior = 'auto';
    if (ctx.layout === 'scroll') scroller.style.overflowAnchor = 'none';
    scroller.style.setProperty('-webkit-overflow-scrolling', 'touch');
  }

  function liveLocation(ctx) {
    try { return ctx.rendition?.currentLocation() || ctx.location; }
    catch { return ctx.location; }
  }

  function publishLocation(ctx) {
    if (!current(ctx) || !ctx.rendition) return;
    if (ctx.layout !== requestedLayout || !sameGeometry(ctx)) return;
    const location = liveLocation(ctx);
    setTarget(ctx, null);
    if (location?.start?.cfi) emitLocation(ctx, location);
  }

  function renditionWork(ctx, rendition, work) {
    return new Promise((resolve, reject) => {
      let settled = false;
      let timer;
      const finish = (error, value) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        rendition.off?.('displayerror', failed);
        ctx.controller.signal.removeEventListener('abort', cancel);
        ctx.viewCleanups.delete(cancel);
        ctx.workWaits -= 1;
        if (error) reject(error);
        else resolve(value);
      };
      const failed = error => finish(error instanceof Error ? error : new Error('这部分内容暂时无法完成排版。'));
      const cancel = () => finish(abortError());
      ctx.workWaits += 1;
      rendition.on('displayerror', failed);
      ctx.controller.signal.addEventListener('abort', cancel, { once:true });
      ctx.viewCleanups.add(cancel);
      timer = setTimeout(() => {
        const error = new Error('阅读排版耗时过长，请重新打开这本书。');
        error.name = 'TimeoutError';
        finish(error);
      }, 20000);
      if (!currentView(ctx, rendition) || ctx.controller.signal.aborted) cancel();
      else Promise.resolve().then(() => {
        if (!currentView(ctx, rendition)) throw abortError();
        return work();
      }).then(value => finish(null, value), failed);
    });
  }

  function loadedScrollView(ctx, rendition, target) {
    if (ctx.layout !== 'scroll' || !target || !currentView(ctx, rendition)) return null;
    try {
      const section = ctx.book.spine.get(target);
      return (rendition.manager.views?.all?.() || []).find(view =>
        view.section.index === section?.index && view.displayed && view.contents
      ) || null;
    } catch { return null; }
  }

  function positionLoadedScroll(ctx, rendition, target) {
    const view = loadedScrollView(ctx, rendition, target);
    if (!view) return false;
    try {
      const inside = view.locationOf(target);
      const top = view.offset().top + inside.top;
      if (!Number.isFinite(top)) return false;
      view.show();
      // Native continuous.display() always starts another fill(), even for an
      // already rendered chapter. Its layout can be positioned directly after
      // fonts/images settle, using an absolute offset in the one scroll container.
      rendition.manager.scrollTo(0, Math.max(0, top), true);
      return true;
    } catch { return false; }
  }

  function scheduleScrollCheck(ctx, rendition) {
    if (ctx.layout !== 'scroll' || !currentView(ctx, rendition)) return;
    clearTimeout(ctx.scrollFillTimer);
    const check = () => {
      if (!currentView(ctx, rendition)) return;
      if (ctx.opening || ctx.busy) {
        ctx.scrollFillTimer = setTimeout(check, 40);
        return;
      }
      const manager = rendition.manager;
      // Native display already filled once. Check for any gap left by reflow in
      // the background; restoring a loaded CFI must not wait for another fill loop.
      Promise.resolve(manager.q.enqueue(() => currentView(ctx, rendition) ? manager.check() : false))
        .catch(error => { if (currentView(ctx, rendition)) report(error, ctx); });
    };
    ctx.scrollFillTimer = setTimeout(check, 60);
  }

  async function displayReady(ctx, rendition, target, { fallback = false } = {}) {
    let restoreTarget = typeof target === 'string' && target ? target : null;
    setTarget(ctx, restoreTarget);
    if (loadedScrollView(ctx, rendition, restoreTarget)) {
      container.dataset.readerPhase = 'settling';
      if (!await settleContents(ctx, rendition)) return false;
      container.dataset.readerPhase = 'positioning';
      if (positionLoadedScroll(ctx, rendition, restoreTarget)) {
        await deferFrame();
        if (!currentView(ctx, rendition)) return false;
        configureScroller(ctx, rendition);
        scheduleScrollCheck(ctx, rendition);
        container.dataset.readerPhase = 'ready';
        return true;
      }
    }
    container.dataset.readerPhase = 'displaying';
    try { await renditionWork(ctx, rendition, () => rendition.display(restoreTarget || undefined)); }
    catch (error) {
      if (!currentView(ctx, rendition)) return false;
      if (!fallback || !restoreTarget || isAbort(error) || error.name === 'TimeoutError') throw error;
      restoreTarget = null;
      setTarget(ctx, null);
      await renditionWork(ctx, rendition, () => rendition.display());
    }
    container.dataset.readerPhase = 'settling';
    if (!await settleContents(ctx, rendition)) return false;
    if (restoreTarget) {
      container.dataset.readerPhase = 'positioning';
      if (positionLoadedScroll(ctx, rendition, restoreTarget)) await deferFrame();
      else {
        await renditionWork(ctx, rendition, () => rendition.display(restoreTarget));
        if (!await settleContents(ctx, rendition)) return false;
      }
    }
    if (!currentView(ctx, rendition)) return false;
    configureScroller(ctx, rendition);
    scheduleScrollCheck(ctx, rendition);
    container.dataset.readerPhase = 'ready';
    return currentView(ctx, rendition);
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
      generation:mine, controller:new AbortController(), cleanups:new Set(), archiveImageUrls:new Map(),
      contentTasks:new Set(), viewCleanups:new Set(), spineHooks:[], layout:requestedLayout, workWaits:0,
      source:entry, book:null, rendition:null, location:null, opening:true, busy:false,
      target:null, targetIndex:null, fontRefreshed:false, disposed:false, fontTimer:null, scrollFillTimer:null,
      width:0, height:0, openDone:null, finishOpen:null, busyDone:null, finishBusy:null,
    };
    ctx.openDone = new Promise(resolve => { ctx.finishOpen = resolve; });
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
      const rendition = createRendition(ctx, requestedLayout);
      if (!await displayReady(ctx, rendition, savedCfi, { fallback:true })) return false;
      thisBook.loaded.navigation.then(navigation => {
        if (current(ctx)) onNavigation?.(navigation.toc || []);
      }).catch(error => report(error, ctx));
      await deferFrame();
      if (current(ctx)) {
        // Content hooks and the final CFI restoration have finished. Only now may callers
        // replace the persisted CFI, including when an obsolete CFI needed fallback.
        ctx.opening = false;
        publishLocation(ctx);
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
      ctx.finishOpen();
    }
  }

  async function perform(action, target) {
    const ctx = active;
    if (!current(ctx) || !ctx.rendition || ctx.opening || ctx.busy) return false;
    if (ctx.layout === 'scroll' && action !== 'display') return false;
    if ((action === 'prev' && ctx.location?.atStart) || (action === 'next' && ctx.location?.atEnd)) return false;
    beginBusy(ctx);
    const rendition = ctx.rendition;
    let success = false;
    try {
      if (action === 'display') success = await displayReady(ctx, rendition, target);
      else {
        await rendition[action]();
        success = await settleContents(ctx, rendition);
      }
      return success;
    } catch (error) {
      if (action === 'display') setTarget(ctx, null);
      report(error, ctx);
      return false;
    } finally { finishBusy(ctx, success); }
  }

  function beginBusy(ctx) {
    ctx.busy = true;
    ctx.busyDone = new Promise(resolve => { ctx.finishBusy = resolve; });
  }

  function finishBusy(ctx, publish = false) {
    if (current(ctx)) {
      ctx.busy = false;
      if (publish) publishLocation(ctx);
    }
    ctx.finishBusy?.();
    ctx.finishBusy = null;
  }

  function setLayout(next) {
    if (!['spread', 'scroll'].includes(next) || dead) return Promise.resolve(false);
    requestedLayout = next;
    layoutWork = layoutWork.catch(() => false).then(async () => {
      const ctx = active;
      if (!ctx) return !dead;
      if (ctx.opening) await ctx.openDone;
      while (current(ctx) && ctx.busy) await ctx.busyDone;
      if (!current(ctx)) return false;
      if (!ctx.rendition || ctx.layout === requestedLayout) return !!ctx.rendition;
      // A hidden library view has no usable dimensions. Remember the mode and
      // apply it when resize() is called after the reader becomes visible again.
      if (container.clientWidth < 1 || container.clientHeight < 1) return true;
      const anchor = ctx.target || ctx.location?.start?.cfi || liveLocation(ctx)?.start?.cfi;
      beginBusy(ctx);
      let success = false;
      try {
        destroyRendition(ctx);
        container.replaceChildren();
        const rendition = createRendition(ctx, requestedLayout);
        success = await displayReady(ctx, rendition, anchor);
        return success;
      } catch (error) {
        report(error, ctx);
        return false;
      } finally { finishBusy(ctx, success); }
    });
    return layoutWork;
  }

  function resize() {
    const ctx = active;
    if (!current(ctx) || !ctx.rendition || ctx.opening) return false;
    const width = container.clientWidth;
    const height = container.clientHeight;
    if (width < 1 || height < 1) return false;
    if (ctx.layout !== requestedLayout) { void setLayout(requestedLayout); return true; }
    if (width === ctx.width && height === ctx.height) return false;
    if (ctx.busy) {
      clearTimeout(resizeTimer);
      resizeTimer = setTimeout(resize, 120);
      return false;
    }
    ctx.width = width; ctx.height = height;
    const rendition = ctx.rendition;
    const anchor = ctx.target || ctx.location?.start?.cfi || liveLocation(ctx)?.start?.cfi;
    beginBusy(ctx);
    void (async () => {
      let success = false;
      try {
        // The vendor accepts a CFI as the third argument. Explicitly settle the
        // recreated iframe and restore once more after its images/fonts are ready.
        rendition.resize(width, height, anchor);
        success = await displayReady(ctx, rendition, anchor);
      } catch (error) { report(error, ctx); }
      finally { finishBusy(ctx, success); }
    })();
    return true;
  }

  async function setFontSize(value) {
    const parsed = Number(value);
    if (!Number.isFinite(parsed)) return false;
    const nextSize = Math.max(16, Math.min(34, parsed));
    const ctx = active;
    if (nextSize === fontSize && (!ctx?.rendition || ctx.appliedFontSize === nextSize)) return !dead;
    fontSize = nextSize;
    if (!current(ctx) || !ctx.rendition) return true;
    if (ctx.opening) await ctx.openDone;
    while (current(ctx) && ctx.busy) await ctx.busyDone;
    if (!current(ctx) || !ctx.rendition) return false;
    const rendition = ctx.rendition;
    const cfi = ctx.target || ctx.location?.start?.cfi || liveLocation(ctx)?.start?.cfi;
    beginBusy(ctx);
    let success = false;
    try {
      rendition.themes.override('font-size', `${fontSize}px`, true);
      ctx.appliedFontSize = fontSize;
      for (const contents of rendition.getContents()) {
        contents.document.documentElement.style.setProperty('--rr-text-size', `${fontSize}px`);
        contents.document.body.style.setProperty('font-size', `${fontSize}px`, 'important');
      }
      if (!await settleContents(ctx, rendition)) return false;
      success = cfi ? await displayReady(ctx, rendition, cfi) : currentView(ctx, rendition);
      return success;
    } catch (error) { report(error, ctx); return false; }
    finally { finishBusy(ctx, success); }
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
    setLayout,
    get layout() { return active?.layout || requestedLayout; },
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
