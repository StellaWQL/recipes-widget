import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { createRequire } from 'node:module';
import { once } from 'node:events';
import { configuration, createLibraryServer } from '../server.mjs';
import { GitHubLibrary } from '../github-repository.mjs';
import { validateEpub, inspectZipDirectory } from '../epub-validation.mjs';
import { createRepositoryLibrary } from '../../reader-room/library-sync.js';

const require = createRequire(import.meta.url);
const JSZip = require('../../reader-room/vendor/jszip.min.js');
const KEY = 'test-upload-key-used-only-in-mock-tests-00000000';
const TOKEN = 'test-github-credential-not-a-real-token';
const config = () => configuration({ GITHUB_TOKEN: TOKEN, LIBRARY_UPLOAD_KEY: KEY,
  ALLOWED_ORIGINS: 'https://shelf.example', PORT: '0' });
const blobSha = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { 'Content-Type': 'application/json', ...headers } });

async function epub({ utf16 = false, missingSpine = false, unsafe = false, doctype = false } = {}) {
  const z = new JSZip();
  z.file('mimetype', 'application/epub+zip', { compression: 'STORE' });
  const xml = source => utf16 ? Buffer.concat([Buffer.from([0xff, 0xfe]), Buffer.from(source.replace('UTF-8', 'UTF-16'), 'utf16le')]) : source;
  z.file('META-INF/container.xml', xml(`<?xml version="1.0" encoding="UTF-8"?><container xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>`));
  z.file('OEBPS/content.opf', xml(`<?xml version="1.0" encoding="UTF-8"?>${doctype ? '<!DOCTYPE package [<!ENTITY stolen SYSTEM "file:///private">]>' : ''}<package xmlns="http://www.idpf.org/2007/opf" version="3.0"><metadata xmlns:dc="http://purl.org/dc/elements/1.1/"><dc:title>纸上花园</dc:title><dc:creator>测试作者</dc:creator></metadata><manifest><item id="a" href="chapter.xhtml" media-type="application/xhtml+xml"/></manifest><spine><itemref idref="a"/></spine></package>`));
  if (!missingSpine) z.file('OEBPS/chapter.xhtml', '<html xmlns="http://www.w3.org/1999/xhtml"><body><p>测试正文。</p></body></html>');
  if (unsafe) z.file('../outside.txt', 'outside');
  return z.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
}

function mockGitHub({ failPut = false, invalidReceipt = false, rateLimited = false, pausePut = null } = {}) {
  const files = new Map(), calls = [];
  let commits = 0;
  const metadata = (path, bytes) => ({ type: 'file', path, name: path.split('/').pop(), size: bytes.length, sha: blobSha(bytes), download_url: 'https://untrusted.invalid/do-not-follow' });
  const fetchImpl = async (address, options) => {
    const url = new URL(address);
    assert.equal(url.origin, 'https://api.github.com');
    assert.equal(options.headers.Authorization, `Bearer ${TOKEN}`);
    const method = options.method || 'GET';
    calls.push({ method, path: decodeURIComponent(url.pathname), accept: options.headers.Accept });
    if (rateLimited) return json({}, 403, { 'x-ratelimit-remaining': '0' });
    const prefix = '/repos/StellaWQL/recipes-widget';
    assert(url.pathname.startsWith(prefix));
    const path = decodeURIComponent(url.pathname.slice(`${prefix}/contents/`.length));
    if (url.pathname.includes('/branches/')) return json({ name: 'practice' });
    if (method === 'GET' && path === 'data/books') return json([...files].map(([path, bytes]) => metadata(path, bytes)));
    if (method === 'GET') {
      const bytes = files.get(path);
      if (!bytes) return json({}, 404);
      return options.headers.Accept.includes('raw') ? new Response(bytes) : json(metadata(path, bytes));
    }
    assert.equal(method, 'PUT');
    if (pausePut) await pausePut;
    if (failPut) return json({}, 503);
    const body = JSON.parse(options.body);
    assert.equal(body.branch, 'practice');
    assert(!('sha' in body), 'The service must never overwrite a different existing book.');
    if (files.has(path)) return json({}, 422);
    const bytes = Buffer.from(body.content, 'base64');
    files.set(path, bytes); commits += 1;
    return json({ content: metadata(path, bytes), commit: invalidReceipt ? {} : { sha: 'a'.repeat(40), html_url: 'https://github.com/StellaWQL/recipes-widget/commit/' + 'a'.repeat(40) } }, 201);
  };
  return { fetchImpl, files, calls, get commits() { return commits; } };
}

async function serve(t, c, mock) {
  const server = createLibraryServer(c, { fetchImpl: mock.fetchImpl });
  server.listen(0, '127.0.0.1'); await once(server, 'listening');
  t.after(() => { server.closeAllConnections(); server.close(); });
  return `http://127.0.0.1:${server.address().port}`;
}
const headers = extra => ({ Authorization: `Bearer ${KEY}`, Origin: 'https://shelf.example', ...extra });
const upload = (base, bytes, filename = '纸上花园.epub') => fetch(`${base}/api/library/books`, {
  method: 'POST', headers: headers({ 'Content-Type': 'application/epub+zip', 'X-Book-Filename': encodeURIComponent(filename) }), body: bytes,
});

test('ordinary and UTF-16 EPUB metadata are read without altering file bytes', async () => {
  for (const utf16 of [false, true]) {
    const bytes = await epub({ utf16 }), before = Buffer.from(bytes);
    assert.deepEqual(await validateEpub(bytes), { title: '纸上花园', author: '测试作者' });
    assert.deepEqual(bytes, before);
  }
});

test('invalid ZIP, missing body, unsafe paths and XML entities are rejected', async () => {
  for (const bytes of [Buffer.from('not an epub'), await epub({ missingSpine: true }), await epub({ unsafe: true }), await epub({ doctype: true })]) {
    await assert.rejects(() => validateEpub(bytes), error => error.code === 'INVALID_EPUB');
  }
});

test('expanded-size cap is checked from ZIP directory before inflate', async () => {
  const bytes = Buffer.from(await epub());
  const index = bytes.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
  bytes.writeUInt32LE(201 * 1024 * 1024, index + 24);
  assert.throws(() => inspectZipDirectory(bytes), error => error.code === 'EXPANDED_TOO_LARGE');
});

test('status reports unavailable configuration honestly and does not contact GitHub', async t => {
  const mock = mockGitHub(), base = await serve(t, configuration({ PORT: '0' }), mock);
  const status = await (await fetch(`${base}/api/library/status`)).json();
  assert.equal(status.enabled, false);
  assert.equal(status.configured, false);
  assert.equal((await upload(base, await epub())).status, 403); // No allowed browser origin is configured either.
  const denied = await fetch(`${base}/api/library/books`, { method: 'POST' });
  assert.equal(denied.status, 503);
  assert.equal(mock.calls.length, 0);
});

test('authenticated API rejects missing key, wrong key and foreign origins before remote access', async t => {
  const mock = mockGitHub(), base = await serve(t, config(), mock);
  assert.equal((await fetch(`${base}/api/library/books`)).status, 401);
  assert.equal((await fetch(`${base}/api/library/books`, { headers: headers({ Authorization: 'Bearer wrong' }) })).status, 401);
  assert.equal((await fetch(`${base}/api/library/books`, { headers: headers({ Origin: 'https://other.example' }) })).status, 403);
  assert.equal(mock.calls.length, 0);
});

test('CORS is explicit, and credentials are never returned in status', async t => {
  const mock = mockGitHub(), base = await serve(t, config(), mock);
  const response = await fetch(`${base}/api/library/status`, { headers: { Origin: 'https://shelf.example' } });
  assert.equal(response.headers.get('access-control-allow-origin'), 'https://shelf.example');
  const text = await response.text(); assert(!text.includes(TOKEN)); assert(!text.includes(KEY));
  const preflight = await fetch(`${base}/api/library/books`, { method: 'OPTIONS', headers: { Origin: 'https://shelf.example' } });
  assert.equal(preflight.status, 204);
});

test('real acknowledgement is required and one authenticated EPUB becomes one immutable commit', async t => {
  const bytes = await epub(), mock = mockGitHub(), base = await serve(t, config(), mock);
  const response = await upload(base, bytes);
  assert.equal(response.status, 201);
  const receipt = await response.json();
  assert.equal(receipt.synced, true); assert.equal(receipt.alreadyPresent, false);
  assert.equal(receipt.commit.sha, 'a'.repeat(40)); assert.match(receipt.book.id, /^[a-f0-9]{64}$/);
  assert.equal(receipt.book.key, `repo:${receipt.book.id}`); assert.equal(receipt.book.title, '纸上花园');
  assert.equal(mock.commits, 1); assert.deepEqual([...mock.files.values()][0], bytes);
  assert(!JSON.stringify(receipt).includes(TOKEN));
});

test('repeat upload verifies repository content and creates no duplicate commit', async t => {
  const bytes = await epub(), mock = mockGitHub(), base = await serve(t, config(), mock);
  const first = await (await upload(base, bytes)).json();
  const response = await upload(base, bytes), duplicate = await response.json();
  assert.equal(response.status, 200); assert.equal(duplicate.alreadyPresent, true);
  assert.equal(duplicate.book.id, first.book.id); assert.equal(duplicate.commit, null); assert.equal(mock.commits, 1);
});

test('simultaneous identical uploads are serialized into a single commit', async () => {
  const bytes = await epub(), mock = mockGitHub(), library = new GitHubLibrary(config(), { fetchImpl: mock.fetchImpl });
  const receipts = await Promise.all([library.upload(bytes, '书.epub'), library.upload(bytes, '书.epub')]);
  assert.equal(mock.commits, 1); assert.equal(receipts.filter(receipt => receipt.alreadyPresent).length, 1);
});

test('repository listing and authenticated download work independently of uploader storage', async t => {
  const bytes = await epub(), mock = mockGitHub(), base = await serve(t, config(), mock);
  const receipt = await (await upload(base, bytes)).json();
  const catalogue = await (await fetch(`${base}/api/library/books`, { headers: headers() })).json();
  assert.equal(catalogue.books[0].id, receipt.book.id);
  const response = await fetch(base + catalogue.books[0].contentUrl, { headers: headers() });
  assert.equal(response.status, 200); assert.equal(response.headers.get('content-type'), 'application/epub+zip');
  assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
  assert.equal((await fetch(base + catalogue.books[0].contentUrl)).status, 401);
  assert(mock.calls.every(call => !call.path.includes('untrusted')));
});

test('failed GitHub PUT never returns a synchronized receipt', async t => {
  const mock = mockGitHub({ failPut: true }), base = await serve(t, config(), mock);
  const response = await upload(base, await epub()), body = await response.json();
  assert.equal(response.status, 502); assert.equal(body.error.code, 'GITHUB_UNAVAILABLE');
  assert.equal(body.synced, undefined); assert.equal(mock.commits, 0);
});

test('malformed GitHub acknowledgement is not success; retry recovers confirmed existing bytes', async t => {
  const bytes = await epub(), mock = mockGitHub({ invalidReceipt: true }), base = await serve(t, config(), mock);
  const first = await upload(base, bytes); assert.equal(first.status, 502);
  assert.equal((await first.json()).synced, undefined);
  const retry = await (await upload(base, bytes)).json();
  assert.equal(retry.synced, true); assert.equal(retry.alreadyPresent, true); assert.equal(mock.commits, 1);
});

test('rate-limited GitHub reports a distinct retryable result', async t => {
  const mock = mockGitHub({ rateLimited: true }), base = await serve(t, config(), mock);
  const response = await upload(base, await epub()), body = await response.json();
  assert.equal(response.status, 429); assert.equal(body.error.code, 'GITHUB_RATE_LIMIT'); assert.equal(body.error.retryable, true);
});

test('caller cannot choose remote target, upload a non-EPUB MIME or exceed service size', async t => {
  const mock = mockGitHub(), c = config(); c.maxBytes = 1024;
  const base = await serve(t, c, mock);
  assert.equal((await upload(base, Buffer.alloc(1025))).status, 413);
  const wrong = await fetch(`${base}/api/library/books`, { method: 'POST', headers: headers({ 'Content-Type': 'text/plain' }), body: 'hello' });
  assert.equal(wrong.status, 415);
  assert.equal((await fetch(`${base}/api/library/books/arbitrary/content`, { headers: headers() })).status, 404);
  assert.equal((await fetch(`${base}/library-sync-server/.env`)).status, 404);
  assert.equal(mock.calls.length, 0);
});

test('existing original-name content is acknowledged, while other content is never overwritten', async () => {
  const bytes = await epub(), mock = mockGitHub();
  mock.files.set('data/books/纸上花园.epub', bytes);
  const library = new GitHubLibrary(config(), { fetchImpl: mock.fetchImpl });
  const receipt = await library.upload(bytes, '纸上花园.epub');
  assert.equal(receipt.alreadyPresent, true); assert.equal(mock.commits, 0);
  const hash = createHash('sha256').update(bytes).digest('hex').slice(0, 16);
  mock.files.set(`data/books/别名--${hash}.epub`, Buffer.from('different content'));
  await assert.rejects(() => library.upload(bytes, '别名.epub'), error => error.code === 'CONTENT_CONFLICT');
  assert.equal(mock.commits, 0);
});

test('no synchronized response is produced while the remote write is pending', async () => {
  let release; const pending = new Promise(resolve => { release = resolve; });
  const mock = mockGitHub({ pausePut: pending }), library = new GitHubLibrary(config(), { fetchImpl: mock.fetchImpl });
  let settled = false;
  const operation = library.upload(await epub(), '待确认.epub').then(receipt => { settled = true; return receipt; });
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal(settled, false); assert.equal(mock.commits, 0);
  release(); assert.equal((await operation).synced, true);
});

test('real frontend client accepts backend receipts and another session reads the uploaded book', async t => {
  const bytes = await epub(), mock = mockGitHub(), base = await serve(t, config(), mock);
  const first = createRepositoryLibrary({ endpoint: `${base}/api/library/`, storage: null });
  assert.equal((await first.probe()).configured, true);
  await first.connect(KEY);
  const receipt = await first.upload(new Blob([bytes]), '新册.epub');
  assert.equal(receipt.commitSha, 'a'.repeat(40));
  const second = createRepositoryLibrary({ endpoint: `${base}/api/library/`, storage: null });
  await second.probe();
  const books = await second.connect(KEY);
  assert.equal(books.length, 1);
  assert.equal(books[0].repositoryId, receipt.book.repositoryId);
  const copy = await second.content(books[0].repositoryId);
  assert.deepEqual(Buffer.from(await copy.arrayBuffer()), bytes);
  const retry = await first.upload(new Blob([bytes]), '新册.epub');
  assert.equal(retry.alreadyPresent, true); assert.equal(retry.commitSha, null);
  assert.equal(mock.commits, 1);
});
