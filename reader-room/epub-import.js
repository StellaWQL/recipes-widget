// Accept an EPUB's contents, including a single book exported as a Mac package.
const isMacMetadata = path => path.split('/').some(part => part === '__MACOSX' || part === '.DS_Store' || part.startsWith('._'));
const isSafePath = path => !!path && !/^(?:[a-z]:|[\\/])/i.test(path) && !path.split(/[\\/]/).some(part => part === '..');
const epubName = name => {
  const base = String(name || '新书').split(/[\\/]/).pop().replace(/\.zip$/i, '') || '新书';
  return /\.epub$/i.test(base) ? base : `${base}.epub`;
};

async function readFileBytes(file) {
  try {
    if (typeof file.arrayBuffer === 'function') return await file.arrayBuffer();
    // Older browsers may expose FileReader without Blob.arrayBuffer().
    if (typeof globalThis.FileReader === 'function') return await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = reader.onabort = () => reject(reader.error || new Error('File read interrupted'));
      reader.readAsArrayBuffer(file);
    });
    throw new Error('File reading is unavailable');
  } catch {
    throw new Error('未能读取所选文件。请先将它下载到本机，再重新选择。');
  }
}

async function openArchive(bytes) {
  try { return await globalThis.JSZip.loadAsync(bytes, { checkCRC32: true }); }
  catch (error) {
    const message = String(error?.message || '');
    if (/encrypt|password/i.test(message)) throw new Error('这份压缩包有密码保护，请放入可直接读取的 EPUB。');
    if (/CRC|checksum/i.test(message)) throw new Error('这份文件的压缩校验未通过，请重新下载完整文件后再试。');
    throw new Error('无法解开这份文件，请选择 EPUB，或只装有一本 EPUB 的 ZIP。');
  }
}

function bookCandidates(archive) {
  const files = Object.values(archive.files).filter(entry => !entry.dir && !isMacMetadata(entry.name));
  for (const entry of files) {
    if (!isSafePath(entry.name) || !isSafePath(entry.unsafeOriginalName || entry.name)) {
      throw new Error('这份文件的内部路径无法读取，请重新导出 EPUB。');
    }
  }
  const marker = 'META-INF/container.xml';
  const roots = files.filter(entry => entry.name === marker || entry.name.endsWith(`/${marker}`))
    .map(entry => entry.name.slice(0, -marker.length));
  const nested = files.filter(entry => /\.epub$/i.test(entry.name));
  if (roots.length + nested.length > 1) throw new Error('这份压缩包里有多本书，请每次放入一本 EPUB。');
  return { files, prefix: roots[0], nested: nested[0] };
}

async function repackBook(archive, prefix, name, lastModified) {
  const normalized = new JSZip();
  // EPUB requires mimetype first and uncompressed. All other book bytes are retained.
  normalized.file('mimetype', 'application/epub+zip', { compression: 'STORE', date: new Date(1980, 0, 1), createFolders: false });
  for (const entry of Object.values(archive.files)) {
    if (entry.dir || isMacMetadata(entry.name) || !entry.name.startsWith(prefix)) continue;
    const relative = entry.name.slice(prefix.length);
    if (!relative || relative === 'mimetype') continue;
    if (!isSafePath(relative)) throw new Error('这份文件的内部路径无法读取，请重新导出 EPUB。');
    normalized.file(relative, await entry.async('uint8array'), { date: entry.date, compression: 'DEFLATE', createFolders: false });
  }
  const bytes = await normalized.generateAsync({ type: 'uint8array', compression: 'DEFLATE' });
  const source = new File([bytes], epubName(name), { type: 'application/epub+zip', lastModified: Number.isFinite(lastModified) ? lastModified : 0 });
  return { source, archive: normalized };
}

async function singleBookArchive(file) {
  let source = file;
  let archive = await openArchive(await readFileBytes(source));
  // Unwrap at most one outer archive. Never guess between multiple books.
  for (let depth = 0; depth <= 1; depth += 1) {
    const candidate = bookCandidates(archive);
    if (candidate.prefix !== undefined) {
      if (!candidate.prefix) return { source, archive };
      const folderName = candidate.prefix.slice(0, -1).split('/').pop();
      return repackBook(archive, candidate.prefix, folderName || source.name, source.lastModified);
    }
    if (!candidate.nested) throw new Error('这份文件中没有找到 EPUB 目录，请放入一本 EPUB 或它的压缩包。');
    if (depth === 1) throw new Error('这份压缩包嵌套了多层，请直接放入里面的 EPUB。');
    const bytes = await candidate.nested.async('uint8array');
    source = new File([bytes], epubName(candidate.nested.name), {
      type: 'application/epub+zip', lastModified: Number.isFinite(source.lastModified) ? source.lastModified : 0,
    });
    archive = await openArchive(bytes);
  }
}

// A dropped Mac .epub package can be a directory rather than a single File.
// The caller must supply the FileSystemEntry from the user's drag event.
export async function epubFromDirectoryEntry(entry) {
  if (!entry?.isDirectory || typeof entry.createReader !== 'function') throw new Error('请放入一本 EPUB 或它的书籍目录。');
  if (!globalThis.JSZip) throw new Error('收书函还未准备好，请稍后再试。');
  const archive = new JSZip();
  const visited = new Set();
  let lastModified = 0;
  async function visit(item, path, depth) {
    if (isMacMetadata(path)) return;
    if (!isSafePath(path) || depth > 64) throw new Error('这份书籍目录的层级或路径无法读取，请将它压缩后再放入。');
    if (item.isFile) {
      const file = await new Promise((resolve, reject) => item.file(resolve, reject));
      lastModified = Math.max(lastModified, Number(file.lastModified) || 0);
      archive.file(path, await readFileBytes(file), {
        date: new Date(Math.max(Number(file.lastModified) || 0, 315532800000)), createFolders: false,
      });
      return;
    }
    if (!item.isDirectory || visited.has(item.fullPath || path)) throw new Error('这份书籍目录无法完整读取，请重新选择。');
    visited.add(item.fullPath || path);
    const reader = item.createReader();
    while (true) {
      const entries = await new Promise((resolve, reject) => reader.readEntries(resolve, reject));
      if (!entries.length) break;
      for (const child of entries) await visit(child, `${path}/${child.name}`, depth + 1);
    }
  }
  try { await visit(entry, entry.name || '新书.epub', 0); }
  catch (error) {
    if (error instanceof Error && /^(?:这份|未能|请)/.test(error.message)) throw error;
    throw new Error('未能完整读取这份书籍目录，请先下载到本机再放入。');
  }
  const { prefix, nested } = bookCandidates(archive);
  if (prefix !== undefined) return (await repackBook(archive, prefix, entry.name, lastModified)).source;
  if (nested) return new File([await nested.async('uint8array')], epubName(nested.name), { type: 'application/epub+zip', lastModified });
  throw new Error('这份目录中没有找到 EPUB 书籍，请选择一本 EPUB。');
}

// Inspect the actual archive before adding a local book to the durable catalogue.
export async function inspectEpubImport(file) {
  if (!file || !/\.(?:epub|zip)$/i.test(file.name || '')) throw new Error('请放入 EPUB，或只装有一本 EPUB 的 ZIP。');
  if (!file.size) throw new Error('这本书是空的，请重新选择。');
  if (!globalThis.JSZip || !globalThis.DOMParser) throw new Error('收书函还未准备好，请稍后再试。');
  const { source, archive } = await singleBookArchive(file);

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
    title: text('title')[0] || epubName(source.name).replace(/\.epub$/i, ''),
    author: [...new Set(text('creator'))].join('、'),
    source,
  };
}
