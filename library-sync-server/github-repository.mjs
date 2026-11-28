import { createHash } from 'node:crypto';
import { LibraryError } from './errors.mjs';
import { normalizedFilename, validateEpub } from './epub-validation.mjs';

const digest = (algorithm, value) => createHash(algorithm).update(value).digest('hex');
const gitBlobSha = bytes => createHash('sha1').update(`blob ${bytes.length}\0`).update(bytes).digest('hex');
const encodePath = value => value.split('/').map(encodeURIComponent).join('/');
const wait = milliseconds => new Promise(resolve => setTimeout(resolve, milliseconds));
const remoteFailure = () => new LibraryError(502, 'GITHUB_UNAVAILABLE', '暂时没有收到书库仓库的确认，请稍后重试。', true);

export async function boundedBytes(response, limit) {
  const claimed = Number(response.headers.get('content-length'));
  if (Number.isFinite(claimed) && claimed > limit) {
    await response.body?.cancel();
    throw new LibraryError(413, 'TOO_LARGE', '文件超过同步服务允许的大小。');
  }
  if (!response.body) return Buffer.alloc(0);
  const reader = response.body.getReader();
  const chunks = []; let length = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      length += value.byteLength;
      if (length > limit) {
        await reader.cancel();
        throw new LibraryError(413, 'TOO_LARGE', '文件超过同步服务允许的大小。');
      }
      chunks.push(Buffer.from(value));
    }
  } finally { reader.releaseLock(); }
  return Buffer.concat(chunks, length);
}

/** One immutable book commit at a time. All paths come from trusted server config. */
export class GitHubLibrary {
  constructor(config, { fetchImpl = fetch } = {}) {
    this.config = config;
    this.fetch = fetchImpl;
    this.base = `https://api.github.com/repos/${encodeURIComponent(config.owner)}/${encodeURIComponent(config.repo)}`;
    this.queue = Promise.resolve();
    this.catalog = null;
    this.catalogAt = 0;
  }

  async request(suffix, { method = 'GET', body, raw = false, allow404 = false, allowConflict = false } = {}) {
    let response;
    try {
      response = await this.fetch(`${this.base}${suffix}`, {
        method, redirect: 'error', signal: AbortSignal.timeout(30000),
        headers: {
          Accept: raw ? 'application/vnd.github.raw+json' : 'application/vnd.github+json',
          Authorization: `Bearer ${this.config.githubToken}`,
          'X-GitHub-Api-Version': '2026-03-10',
          'User-Agent': 'Raven-Library-Sync',
          ...(body ? { 'Content-Type': 'application/json' } : {}),
        },
        ...(body ? { body: JSON.stringify(body) } : {}),
      });
    } catch { throw remoteFailure(); }
    if (response.ok || (allow404 && response.status === 404)
        || (allowConflict && [409, 422].includes(response.status))) return response;
    const retry = response.headers.get('retry-after');
    if (response.status === 429 || (response.status === 403 && (retry || response.headers.get('x-ratelimit-remaining') === '0'))) {
      await response.body?.cancel();
      throw new LibraryError(429, 'GITHUB_RATE_LIMIT', '书库仓库暂时限制了请求次数，稍后会继续尝试。', true);
    }
    await response.body?.cancel();
    if ([401, 403].includes(response.status)) throw new LibraryError(502, 'GITHUB_PERMISSION', '同步服务暂时没有书库仓库的读写权限，请检查服务端授权。');
    if (response.status === 404) throw new LibraryError(502, 'GITHUB_TARGET_MISSING', '同步服务没有找到配置的书库仓库或分支。');
    throw remoteFailure();
  }

  contentsUrl(path, branch = this.config.branch) {
    return `/contents/${encodePath(path)}?ref=${encodeURIComponent(branch)}`;
  }

  entry(file, metadata = {}) {
    const id = digest('sha256', `${this.config.owner}/${this.config.repo}/${this.config.branch}/${file.path}`);
    const title = file.name.replace(/--[0-9a-f]{16}\.epub$/i, '.epub').replace(/\.epub$/i, '');
    return {
      id, key: `repo:${id}`, filename: file.name,
      title: metadata.title || title, author: metadata.author || '',
      size: file.size || 0, sha: file.sha,
      contentUrl: `/api/library/books/${id}/content`,
    };
  }

  async json(response) {
    try { return JSON.parse((await boundedBytes(response, 8 * 1024 * 1024)).toString('utf8')); }
    catch (error) { if (error instanceof LibraryError) throw error; throw remoteFailure(); }
  }

  async list({ fresh = false } = {}) {
    if (!fresh && this.catalog && Date.now() - this.catalogAt < 15000) return this.catalog;
    const response = await this.request(this.contentsUrl(this.config.booksPath), { allow404: true });
    if (response.status === 404) {
      await response.body?.cancel();
      // A new books directory is allowed, but a wrong repository/branch is not.
      const branch = await this.request(`/branches/${encodeURIComponent(this.config.branch)}`);
      await branch.body?.cancel();
      this.catalog = []; this.catalogAt = Date.now(); return [];
    }
    const files = await this.json(response);
    if (!Array.isArray(files)) throw new LibraryError(502, 'GITHUB_TARGET_INVALID', '服务端配置的书库位置不是目录。');
    if (files.length >= 1000) throw new LibraryError(503, 'CATALOG_LIMIT', '书库目录已达到当前接口的一千项限制，需要调整服务端目录索引。');
    this.catalog = files.filter(file => file?.type === 'file' && /\.epub$/i.test(file.name || '')
      && file.path === `${this.config.booksPath}/${file.name}`).map(file => ({ ...this.entry(file), path: file.path }));
    this.catalogAt = Date.now();
    return this.catalog;
  }

  async books() { return (await this.list({ fresh: true })).map(({ path, ...entry }) => entry); }

  async lookup(id) {
    if (!/^[a-f0-9]{64}$/.test(id)) throw new LibraryError(404, 'BOOK_NOT_FOUND', '没有找到这册藏书。');
    let book = (await this.list()).find(entry => entry.id === id);
    if (!book) book = (await this.list({ fresh: true })).find(entry => entry.id === id);
    if (!book) throw new LibraryError(404, 'BOOK_NOT_FOUND', '没有找到这册藏书。');
    return book;
  }

  async content(id) {
    const book = await this.lookup(id);
    if (!Number.isSafeInteger(book.size) || book.size < 4 || book.size > 100 * 1024 * 1024) {
      throw new LibraryError(413, 'TOO_LARGE', '这本书超出当前服务支持的下载大小。');
    }
    const response = await this.request(this.contentsUrl(book.path), { raw: true });
    const bytes = await boundedBytes(response, 100 * 1024 * 1024);
    if (bytes.length !== book.size || gitBlobSha(bytes) !== book.sha) {
      this.catalog = null;
      throw new LibraryError(502, 'BOOK_CHANGED', '书库中的文件刚刚更新，请重新打开这册书。', true);
    }
    if (bytes.readUInt32LE(0) !== 0x04034b50) throw new LibraryError(422, 'INVALID_EPUB', '书库中的这份文件不是可读取的 EPUB 压缩包。');
    return { response: new Response(bytes, { headers: { 'Content-Type': 'application/epub+zip' } }), filename: book.filename, sha: book.sha };
  }

  async existing(path) {
    const response = await this.request(this.contentsUrl(path), { allow404: true });
    if (response.status === 404) { await response.body?.cancel(); return null; }
    const file = await this.json(response);
    if (file.type !== 'file' || file.path !== path) throw new LibraryError(409, 'CONTENT_CONFLICT', '书库中已有同名目录或不同文件，未覆盖原内容。');
    return file;
  }

  async verifyExisting(file, bytes, metadata) {
    // The Git blob hash commits to the exact bytes, including length. A same
    // filename is never sufficient evidence and never causes an overwrite.
    if (file.size !== bytes.length || file.sha !== gitBlobSha(bytes)) throw new LibraryError(409, 'CONTENT_CONFLICT', '书库中已有同名但内容不同的文件，原书未被覆盖。');
    return { synced: true, alreadyPresent: true, book: this.entry(file, metadata), commit: null };
  }

  async upload(bytes, filename) {
    const operation = this.queue.then(() => this.commitBook(bytes, filename));
    this.queue = operation.catch(() => {});
    return operation;
  }

  async commitBook(bytes, filename) {
    const original = normalizedFilename(filename);
    const metadata = await validateEpub(bytes);
    const hash = digest('sha256', bytes);
    const storedName = `${original.replace(/\.epub$/i, '')}--${hash.slice(0, 16)}.epub`;
    const target = `${this.config.booksPath}/${storedName}`;
    let file = await this.existing(target);
    if (file) return this.verifyExisting(file, bytes, metadata);
    // Recognize an existing original-name EPUB, without renaming or replacing it.
    const originalFile = await this.existing(`${this.config.booksPath}/${original}`);
    if (originalFile?.sha === gitBlobSha(bytes) && originalFile.size === bytes.length) return this.verifyExisting(originalFile, bytes, metadata);
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const response = await this.request(`/contents/${encodePath(target)}`, {
        method: 'PUT', allowConflict: true,
        body: { message: `Add library book: ${original}`, branch: this.config.branch, content: bytes.toString('base64') },
      });
      if (response.ok) {
        const result = await this.json(response);
        if (!/^[a-f0-9]{40,64}$/.test(result?.commit?.sha || '') || result?.content?.path !== target
            || result.content.sha !== gitBlobSha(bytes)) throw remoteFailure();
        this.catalog = null;
        return {
          synced: true, alreadyPresent: false,
          book: this.entry({ ...result.content, size: bytes.length, name: storedName }, metadata),
          commit: { sha: result.commit.sha, url: result.commit.html_url || null },
        };
      }
      await response.body?.cancel();
      file = await this.existing(target);
      if (file) { this.catalog = null; return this.verifyExisting(file, bytes, metadata); }
      if (attempt < 2) await wait(180 * (attempt + 1));
    }
    throw new LibraryError(409, 'GITHUB_WRITE_CONFLICT', '书库正在接收另一册书，这册书暂未确认入库，请稍后重试。', true);
  }
}
