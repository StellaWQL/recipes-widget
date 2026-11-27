// Inspect the actual archive before adding a local book to the durable catalogue.
export async function inspectEpubImport(file) {
  if (!file || !/\.epub$/i.test(file.name || '')) throw new Error('请放入 EPUB 格式的书。');
  if (!file.size) throw new Error('这本书是空的，请重新选择。');
  if (!globalThis.JSZip || !globalThis.DOMParser) throw new Error('收书函还未准备好，请稍后再试。');

  let archive;
  try {
    archive = await globalThis.JSZip.loadAsync(await file.arrayBuffer(), { checkCRC32: true });
  } catch {
    throw new Error('这本 EPUB 已损坏，或不是有效的 EPUB 文件。');
  }

  const nodes = (root, name) => Array.from(root.getElementsByTagNameNS('*', name));
  const parse = (source, rootName) => {
    const doc = new DOMParser().parseFromString(source, 'application/xml');
    return doc.documentElement?.localName === rootName && !nodes(doc, 'parsererror').length ? doc : null;
  };
  const pathFor = (href, from = '') => {
    if (!href || /^(?:[a-z][a-z\d+.-]*:|\/\/)/i.test(href)) return '';
    try { return new URL(href, `https://epub.local/${from}`).pathname.slice(1); }
    catch { return ''; }
  };
  const entryFor = path => {
    if (!path) return null;
    const exact = archive.file(path);
    if (exact) return exact;
    try { return archive.file(decodeURIComponent(path)); } catch { return null; }
  };

  const containerEntry = archive.file('META-INF/container.xml');
  if (!containerEntry) throw new Error('这本书缺少 EPUB 目录，请换一份文件。');
  let container;
  try { container = parse(await containerEntry.async('string'), 'container'); } catch {}
  if (!container) throw new Error('这本书的 EPUB 目录无法读取。');
  const roots = nodes(container, 'rootfile');
  const root = roots.find(node => node.getAttribute('media-type') === 'application/oebps-package+xml') || roots[0];
  const packageEntry = entryFor(pathFor(root?.getAttribute('full-path')));
  if (!packageEntry) throw new Error('这本书缺少内容清单，请换一份文件。');
  let packageDoc;
  try { packageDoc = parse(await packageEntry.async('string'), 'package'); } catch {}
  if (!packageDoc) throw new Error('这本书的内容清单无法读取。');

  const manifest = nodes(packageDoc, 'manifest')[0];
  const spine = nodes(packageDoc, 'spine')[0];
  const items = new Map(manifest ? nodes(manifest, 'item').map(node => [node.getAttribute('id'), node]) : []);
  let readable = false;
  for (const ref of spine ? nodes(spine, 'itemref') : []) {
    let item = items.get(ref.getAttribute('idref'));
    const seen = new Set();
    // EPUB permits a fallback chain for spine items that are not XHTML or SVG.
    while (item && !seen.has(item)) {
      seen.add(item);
      const type = item.getAttribute('media-type');
      if (['application/xhtml+xml', 'image/svg+xml', 'text/html'].includes(type)) {
        const entry = entryFor(pathFor(item.getAttribute('href'), packageEntry.name));
        if (entry) {
          try {
            const source = await entry.async('string');
            if (type === 'text/html') {
              readable = /<html(?:\s|>)/i.test(source) && !!new DOMParser().parseFromString(source, 'text/html').body;
            } else readable = !!parse(source, type === 'image/svg+xml' ? 'svg' : 'html');
          } catch {}
        }
      }
      if (readable) break;
      item = items.get(item.getAttribute('fallback'));
    }
    if (readable) break;
  }
  if (!readable) throw new Error('这本书没有可读取的正文，请换一份 EPUB。');

  const metadata = nodes(packageDoc, 'metadata')[0];
  const text = name => metadata ? nodes(metadata, name).map(node => node.textContent.trim()).filter(Boolean) : [];
  return {
    title: text('title')[0] || file.name.replace(/\.epub$/i, ''),
    author: [...new Set(text('creator'))].join('、'),
  };
}
