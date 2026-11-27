/**
 * Original EPUB catalogue and artwork. No cover is recoloured or redrawn here.
 * All paths are relative to this module/catalogue, so project-site subpaths work.
 */
export const DEFAULT_CATALOG_URL = 'https://api.github.com/repos/StellaWQL/recipes-widget/contents/data/books?ref=practice';

const MODULE_ROOT = new URL('./', import.meta.url);
const FALLBACK_URL = new URL('data/catalog.json', MODULE_ROOT).href;
const LOCAL_BOOKS_BASE = new URL('../data/books/', MODULE_ROOT).href;
const coverCache = new Map();
const ownedCoverUrls = new Set();

function abortError() {
  return new DOMException('The operation was aborted.', 'AbortError');
}

function assertActive(signal) {
  if (signal?.aborted) throw abortError();
}

function absoluteUrl(value, base, allowBlob = false) {
  if (!value) return null;
  try {
    const result = new URL(String(value), base);
    if (!['http:', 'https:', 'file:', ...(allowBlob ? ['blob:'] : [])].includes(result.protocol)) return null;
    return result.href;
  } catch { return null; }
}

function decode(value) {
  try { return decodeURIComponent(value); } catch { return value; }
}

function getFilename(item, url) {
  let value = item.filename || item.name || item.path;
  if (!value && url) {
    try { value = new URL(url).pathname; } catch { /* An invalid URL is filtered later. */ }
  }
  return decode(String(value || '').split('/').pop()).normalize('NFC');
}

function authorText(value) {
  if (Array.isArray(value)) return value.map(authorText).filter(Boolean).join(' · ');
  return typeof value === 'string' ? value.trim() : '';
}

function catalogueEntries(data, base, localBooksBase) {
  const items = Array.isArray(data) ? data : Array.isArray(data?.books) ? data.books : null;
  if (!items) throw new Error('书目格式无法识别。');
  const result = [];
  const used = new Set();
  let localBase = localBooksBase ? absoluteUrl(localBooksBase, MODULE_ROOT) : null;
  if (localBase && !localBase.endsWith('/')) localBase += '/';
  for (let item of items) {
    if (typeof item === 'string') item = { url: item };
    if (!item || typeof item !== 'object' || item.type === 'dir') continue;
    const url = absoluteUrl(item.download_url || item.url || item.href || item.src || item.bookUrl, base);
    const filename = getFilename(item, url);
    if (!url || !/\.epub$/i.test(filename)) continue;
    const key = `epub:${filename}`;
    if (used.has(key)) continue;
    used.add(key);
    result.push({
      key,
      filename,
      url,
      localUrl: localBase ? new URL(encodeURIComponent(filename), localBase).href : null,
      title: String(item.title || filename.replace(/\.epub$/i, '').trim()),
      shortTitle: String(item.shortTitle || filename.replace(/\.epub$/i, '').trim()),
      author: authorText(item.author || item.creator || item.authors),
      coverUrl: absoluteUrl(item.coverUrl || item.cover, base, true),
      coverWidth: Number(item.coverWidth) || null,
      coverHeight: Number(item.coverHeight) || null,
      language: String(item.language || ''),
    });
  }
  return result;
}

async function request(url, { signal, timeout = 4500, bytes = false } = {}) {
  assertActive(signal);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal?.addEventListener('abort', abort, { once: true });
  const timer = setTimeout(abort, timeout);
  try {
    const response = await fetch(url, {
      signal: controller.signal,
      credentials: 'omit',
      headers: bytes ? undefined : { Accept: 'application/json' },
    });
    if (!response.ok) throw new Error(`读取失败（${response.status}）。`);
    return bytes ? await response.arrayBuffer() : await response.json();
  } finally {
    clearTimeout(timer);
    signal?.removeEventListener('abort', abort);
  }
}

function mergeFresh(remote, cached) {
  const lookup = new Map(cached.map((item, index) => [item.key, { item, index }]));
  return remote.map((item, index) => {
    const previous = lookup.get(item.key);
    const old = previous?.item;
    return {
      item: {
        ...item,
        // GitHub's contents API has only filenames. Preserve real EPUB metadata.
        title: old?.title || item.title,
        author: item.author || old?.author || '',
        coverUrl: item.coverUrl || old?.coverUrl || null,
        coverWidth: item.coverWidth || old?.coverWidth || null,
        coverHeight: item.coverHeight || old?.coverHeight || null,
        language: item.language || old?.language || '',
      },
      order: previous?.index ?? cached.length + index,
    };
  }).sort((a, b) => a.order - b.order).map(value => value.item);
}

/**
 * Resolves the bundled catalogue first, and returns it immediately when present.
 * A fresh remote catalogue is delivered later through onUpdate(entries).
 * Supply one AbortSignal for the page lifetime to cancel the background refresh.
 * catalogUrl:null disables remote refresh; localBooksBase:null disables local EPUB fallback.
 */
export async function loadCatalog({
  catalogUrl = DEFAULT_CATALOG_URL,
  fallbackUrl = FALLBACK_URL,
  localBooksBase = LOCAL_BOOKS_BASE,
  signal,
  onUpdate,
} = {}) {
  assertActive(signal);
  const fallback = fallbackUrl ? absoluteUrl(fallbackUrl, MODULE_ROOT) : null;
  const remote = catalogUrl ? absoluteUrl(catalogUrl, MODULE_ROOT) : null;
  const fallbackTask = fallback
    ? request(fallback, { signal, timeout: 2500 }).then(data => catalogueEntries(data, fallback, localBooksBase)).catch(() => [])
    : Promise.resolve([]);
  const remoteTask = remote && remote !== fallback
    ? request(remote, { signal, timeout: 4500 }).then(data => catalogueEntries(data, remote, localBooksBase)).catch(() => null)
    : Promise.resolve(null);
  const cached = await fallbackTask;
  assertActive(signal);
  if (cached.length) {
    // Do not await the network merely to paint 12 already available original covers.
    void remoteTask.then(fresh => {
      if (!fresh || signal?.aborted || typeof onUpdate !== 'function') return;
      try { onUpdate(mergeFresh(fresh, cached)); } catch { /* A consumer error cannot reject the background task. */ }
    });
    return cached;
  }
  const fresh = await remoteTask;
  assertActive(signal);
  return fresh || cached;
}

function parseXml(text) {
  const xml = new DOMParser().parseFromString(text, 'application/xml');
  if (xml.getElementsByTagName('parsererror').length) throw new Error('EPUB 元数据无法读取。');
  return xml;
}

function nodes(xml, localName) {
  return [...xml.getElementsByTagName('*')].filter(node => node.localName === localName);
}

function zipPath(href, basePath) {
  const url = new URL(href, `https://epub.invalid/${basePath}`);
  if (url.origin !== 'https://epub.invalid') return null;
  return decode(url.pathname.replace(/^\//, ''));
}

async function originalCoverBlob(bytes, signal) {
  if (!globalThis.JSZip) return null;
  const archive = await globalThis.JSZip.loadAsync(bytes);
  assertActive(signal);
  const containerFile = archive.file('META-INF/container.xml');
  if (!containerFile) return null;
  const container = parseXml(await containerFile.async('string'));
  const packagePath = nodes(container, 'rootfile')[0]?.getAttribute('full-path');
  const packageFile = packagePath && archive.file(packagePath);
  if (!packageFile) return null;
  const packageXml = parseXml(await packageFile.async('string'));
  const items = nodes(packageXml, 'item').map(node => ({
    id: node.getAttribute('id'),
    href: node.getAttribute('href'),
    mime: node.getAttribute('media-type') || '',
    properties: (node.getAttribute('properties') || '').split(/\s+/),
  }));
  const coverId = nodes(packageXml, 'meta').find(node => node.getAttribute('name')?.toLowerCase() === 'cover')?.getAttribute('content');
  let cover = items.find(item => item.properties.includes('cover-image'))
    || items.find(item => item.id === coverId && item.mime.startsWith('image/'))
    || items.find(item => item.mime.startsWith('image/') && /(?:^|[-_])cover(?:[-_.]|$)/i.test(item.id || item.href || ''));
  if (!cover) {
    const guide = nodes(packageXml, 'reference').find(node => /cover/i.test(node.getAttribute('type') || ''))?.getAttribute('href');
    const candidate = items.find(item => item.id === coverId) || items.find(item => /cover/i.test(item.id || '') && /html|xml/.test(item.mime));
    const documentPath = (guide || candidate?.href) && zipPath(guide || candidate.href, packagePath);
    const documentFile = documentPath && archive.file(documentPath);
    if (documentFile) {
      const coverDocument = parseXml(await documentFile.async('string'));
      const picture = nodes(coverDocument, 'img')[0] || nodes(coverDocument, 'image')[0];
      const href = picture?.getAttribute('src') || picture?.getAttribute('href') || picture?.getAttribute('xlink:href');
      const path = href && zipPath(href, documentPath);
      if (path) cover = { path, mime: items.find(item => zipPath(item.href, packagePath) === path)?.mime || '' };
    }
  }
  if (!cover) return null;
  const path = cover.path || zipPath(cover.href, packagePath);
  const imageFile = path && archive.file(path);
  if (!imageFile) return null;
  const extensions = { jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', svg: 'image/svg+xml' };
  const mime = cover.mime || extensions[path.split('.').pop().toLowerCase()];
  if (!mime?.startsWith('image/')) return null;
  const imageBytes = await imageFile.async('uint8array');
  assertActive(signal);
  return new Blob([imageBytes], { type: mime });
}

async function coverUrlFromBytes(bytes, key, signal) {
  const blob = await originalCoverBlob(bytes, signal);
  if (!blob) return null;
  assertActive(signal);
  if (coverCache.has(key)) return coverCache.get(key);
  const coverUrl = URL.createObjectURL(blob);
  ownedCoverUrls.add(coverUrl);
  coverCache.set(key, coverUrl);
  return coverUrl;
}

/**
 * Gets an EPUB's embedded cover without re-rendering or painting it.
 * Imported books may pass entry.blob or entry.file from IndexedDB, avoiding
 * a temporary download URL and restoring their original artwork after reload.
 */
export async function resolveCover(entry, { signal } = {}) {
  assertActive(signal);
  if (entry.coverUrl) return entry.coverUrl;
  const localBlob = entry.blob instanceof Blob ? entry.blob : entry.file instanceof Blob ? entry.file : null;
  const key = entry.key || entry.url || localBlob;
  if (coverCache.has(key)) return coverCache.get(key);
  if (localBlob) {
    try {
      const coverUrl = await coverUrlFromBytes(await localBlob.arrayBuffer(), key, signal);
      if (coverUrl) return coverUrl;
    } catch {
      if (signal?.aborted) throw abortError();
    }
  }
  const urls = [...new Set([entry.url, entry.localUrl].filter(Boolean))];
  for (const url of urls) {
    try {
      const bytes = await request(url, { signal, timeout: 10000, bytes: true });
      const coverUrl = await coverUrlFromBytes(bytes, key, signal);
      if (coverUrl) return coverUrl;
    } catch (error) {
      if (signal?.aborted) throw abortError();
      // The existing local book path can recover a network or CORS failure.
    }
  }
  return null;
}

/** Revoke only blob URLs owned by this module, never shared/static original artwork. */
export function revokeCover(url) {
  if (!ownedCoverUrls.delete(url)) return;
  URL.revokeObjectURL(url);
  for (const [key, value] of coverCache) if (value === url) coverCache.delete(key);
}
