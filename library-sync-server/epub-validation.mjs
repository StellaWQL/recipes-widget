import { createRequire } from 'node:module';
import { posix } from 'node:path';
import { invalidBook, LibraryError } from './errors.mjs';

const require = createRequire(import.meta.url);
const JSZip = require('../reader-room/vendor/jszip.min.js');
const sax = require('./vendor/sax.cjs');
const MAX_EXPANDED = 200 * 1024 * 1024;
const MAX_XML = 4 * 1024 * 1024;
const MAX_ENTRIES = 8000;
const safePath = value => !!value && !/^[\\/]|^[a-z]:/i.test(value)
  && !value.split(/[\\/]/).some(part => part === '..' || part.includes('\0'));

// Read the ZIP directory before any inflate operation. This places hard bounds
// on resource use; the upload cannot choose files outside the archive.
export function inspectZipDirectory(input) {
  const bytes = Buffer.isBuffer(input) ? input : Buffer.from(input);
  let end = -1;
  for (let i = bytes.length - 22; i >= Math.max(0, bytes.length - 65557); i -= 1) {
    if (bytes.readUInt32LE(i) === 0x06054b50 && i + 22 + bytes.readUInt16LE(i + 20) === bytes.length) { end = i; break; }
  }
  if (end < 0) throw invalidBook('没有找到完整的 EPUB 压缩目录。');
  const count = bytes.readUInt16LE(end + 10);
  const size = bytes.readUInt32LE(end + 12);
  const start = bytes.readUInt32LE(end + 16);
  if (bytes.readUInt16LE(end + 4) || bytes.readUInt16LE(end + 6)
      || bytes.readUInt16LE(end + 8) !== count) throw invalidBook('暂不支持分卷压缩的 EPUB。');
  if (count === 0xffff || size === 0xffffffff || start === 0xffffffff) throw invalidBook('这本书使用 ZIP64 压缩，请重新导出为普通 EPUB 后再同步。');
  if (!count || count > MAX_ENTRIES || start + size > end) throw invalidBook('这本书的压缩目录大小或结构无法读取。');
  let offset = start, expanded = 0;
  const names = new Set();
  for (let i = 0; i < count; i += 1) {
    if (offset + 46 > start + size || bytes.readUInt32LE(offset) !== 0x02014b50) throw invalidBook('这本书的压缩目录不完整。');
    const flags = bytes.readUInt16LE(offset + 8);
    const method = bytes.readUInt16LE(offset + 10);
    const length = bytes.readUInt32LE(offset + 24);
    const nameLength = bytes.readUInt16LE(offset + 28);
    const extraLength = bytes.readUInt16LE(offset + 30);
    const commentLength = bytes.readUInt16LE(offset + 32);
    const next = offset + 46 + nameLength + extraLength + commentLength;
    if (next > start + size || flags & 1 || ![0, 8].includes(method)) throw invalidBook('这本 EPUB 使用了暂不支持的加密或压缩方式。');
    const name = bytes.subarray(offset + 46, offset + 46 + nameLength).toString('utf8');
    if (!safePath(name) || names.has(name)) throw invalidBook('这本 EPUB 含有重复或不安全的文件路径。');
    names.add(name);
    expanded += length;
    if (length === 0xffffffff || expanded > MAX_EXPANDED) {
      throw new LibraryError(413, 'EXPANDED_TOO_LARGE', '这本书展开后的内容超过同步服务的 200 MiB 限制。');
    }
    offset = next;
  }
  if (offset !== start + size) throw invalidBook('这本书的压缩目录边界不完整。');
  return { count, expanded };
}

function parseXml(text, expectedRoot) {
  const nodes = [], stack = [];
  let root = '', invalid = false;
  const parser = sax.parser(true, { xmlns: true, trim: false, normalize: false });
  // SAX never loads an external DTD. Older valid EPUB 2 packages may declare
  // one; keep those compatible, but reject internal entity declarations.
  parser.ondoctype = value => {
    if (/<!ENTITY|\[\s*<!/i.test(value)) throw invalidBook('书籍目录或内容清单不能包含自定义实体声明。');
  };
  parser.onerror = () => { invalid = true; };
  parser.onopentag = tag => {
    if (nodes.length >= 50000 || stack.length >= 128) throw invalidBook('这本书的目录层级或节点数量超出同步服务限制。');
    if (!root) root = tag.local;
    const node = { name: tag.local, uri: tag.uri || '', attrs: {}, text: '', parent: stack.at(-1) || null };
    for (const attr of Object.values(tag.attributes)) node.attrs[attr.name] = attr.value;
    nodes.push(node); stack.push(node);
  };
  const collectText = text => {
    for (const node of stack) {
      if (node.parent?.name === 'metadata') node.text = (node.text + text).slice(0, 16384);
    }
  };
  parser.ontext = collectText;
  parser.oncdata = collectText;
  parser.onclosetag = () => stack.pop();
  try { parser.write(text).close(); } catch { invalid = true; }
  if (invalid || root !== expectedRoot) throw invalidBook('这本书的目录或内容清单不是可读取的 XML。');
  return nodes;
}

function archivePath(href, from = '') {
  if (typeof href !== 'string' || !href || /^(?:[a-z][a-z\d+.-]*:|[\\/]{2})/i.test(href)) return null;
  try {
    const url = new URL(href, `https://epub.invalid/${from}`);
    if (url.origin !== 'https://epub.invalid') return null;
    const path = decodeURIComponent(url.pathname.slice(1));
    return safePath(path) ? path : null;
  } catch { return null; }
}

async function xmlEntry(entry, expectedRoot) {
  if (!entry || entry.dir || entry._data?.uncompressedSize > MAX_XML) throw invalidBook('这本书缺少目录文件，或目录文件过大。');
  const bytes = await entry.async('uint8array');
  if (bytes.byteLength > MAX_XML) throw invalidBook('这本书的目录文件过大。');
  let text;
  if (bytes[0] === 0xff && bytes[1] === 0xfe) text = new TextDecoder('utf-16le', { fatal: true }).decode(bytes);
  else if (bytes[0] === 0xfe && bytes[1] === 0xff) text = new TextDecoder('utf-16be', { fatal: true }).decode(bytes);
  else text = new TextDecoder('utf-8', { fatal: true }).decode(bytes);
  return parseXml(text, expectedRoot);
}

export async function validateEpub(bytes) {
  inspectZipDirectory(bytes);
  let archive;
  try { archive = await JSZip.loadAsync(bytes); }
  catch { throw invalidBook('这份文件无法作为 EPUB 解开。'); }
  // JSZip supports Unicode path extra fields. Validate its resolved names as
  // well as raw central-directory names, and never extract to the filesystem.
  for (const entry of Object.values(archive.files)) {
    if (!safePath(entry.name) || !safePath(entry.unsafeOriginalName || entry.name)) throw invalidBook('这本书包含不安全的内部路径。');
  }
  const container = await xmlEntry(archive.file('META-INF/container.xml'), 'container');
  const roots = container.filter(node => node.name === 'rootfile');
  const root = roots.find(node => node.attrs['media-type'] === 'application/oebps-package+xml') || roots[0];
  const opfPath = archivePath(root?.attrs['full-path']);
  if (!opfPath) throw invalidBook('这本书没有可读取的内容清单路径。');
  const packageNodes = await xmlEntry(archive.file(opfPath), 'package');
  const manifest = new Map(packageNodes.filter(node => node.name === 'item' && node.parent?.name === 'manifest')
    .map(node => [node.attrs.id, node]));
  const spine = packageNodes.filter(node => node.name === 'itemref' && node.parent?.name === 'spine');
  let readable = false;
  for (const reference of spine) {
    let item = manifest.get(reference.attrs.idref);
    const seen = new Set();
    while (item && !seen.has(item)) {
      seen.add(item);
      if (['application/xhtml+xml', 'text/html', 'image/svg+xml'].includes(item.attrs['media-type'])) {
        const path = archivePath(item.attrs.href, opfPath);
        if (path && archive.file(path) && !archive.file(path).dir && archive.file(path)._data?.uncompressedSize > 0) { readable = true; break; }
      }
      item = manifest.get(item.attrs.fallback);
    }
    if (readable) break;
  }
  if (!readable) throw invalidBook('这本书没有找到可读取的正文文件。');
  const metadata = packageNodes.filter(node => node.parent?.name === 'metadata');
  const values = name => metadata.filter(node => node.name === name).map(node => node.text.trim()).filter(Boolean);
  return { title: values('title')[0] || '', author: [...new Set(values('creator'))].join('、') };
}

export function normalizedFilename(value) {
  const raw = String(value || '').normalize('NFC').trim();
  if (!raw || raw !== posix.basename(raw) || /[\\\x00-\x1f\x7f]/.test(raw) || !/\.epub$/i.test(raw)) {
    throw new LibraryError(400, 'INVALID_FILENAME', '请提供一本 EPUB 的文件名。');
  }
  let stem = raw.replace(/\.epub$/i, '').replace(/[<>:"|?*]/g, '_').replace(/^\.+/, '').trim() || '新书';
  while (Buffer.byteLength(stem) > 120) stem = [...stem].slice(0, -1).join('');
  return `${stem}.epub`;
}
