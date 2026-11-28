/** Authenticated repository storage. GitHub credentials never enter this module. */
export class LibrarySyncError extends Error {
  constructor(message, code = 'SYNC_UNAVAILABLE', retryable = false) {
    super(message); this.name = 'LibrarySyncError'; this.code = code; this.retryable = retryable;
  }
}

export function createRepositoryLibrary({ endpoint, fetch: requestFetch = globalThis.fetch.bind(globalThis),
  storage, signal, timeout = 45000 } = {}) {
  if (storage === undefined) {
    try { storage = globalThis.sessionStorage; } catch { storage = null; }
  }
  const base = new URL(endpoint || '../api/library/', import.meta.url);
  if (!base.pathname.endsWith('/')) base.pathname += '/';
  base.search = ''; base.hash = '';
  if (base.protocol !== 'https:' && !(base.protocol === 'http:' && ['localhost', '127.0.0.1', '[::1]'].includes(base.hostname))) {
    throw new LibrarySyncError('书库同步地址需要使用 HTTPS。', 'INVALID_ENDPOINT');
  }
  const storageKey = `raven.library.auth:${base.origin}${base.pathname}`;
  let accessKey = '';
  let verified = false;
  try { accessKey = storage?.getItem(storageKey) || ''; } catch { /* Session storage is optional. */ }
  let capability = { configured: false, enabled: false };
  function remember(value) {
    accessKey = value; verified = false;
    try { value ? storage?.setItem(storageKey, value) : storage?.removeItem(storageKey); } catch {}
  }
  async function request(path, { auth = true, bytes = false, deadline = timeout, ...options } = {}) {
    if (auth && !accessKey) throw new LibrarySyncError('请先盖上书库钥印。', 'AUTH_REQUIRED');
    const controller = new AbortController();
    const abort = () => controller.abort();
    signal?.addEventListener('abort', abort, { once: true });
    if (signal?.aborted) abort();
    const timer = setTimeout(abort, deadline);
    try {
      const response = await requestFetch(new URL(path, base).href, {
        ...options, credentials: 'omit', cache: 'no-store', redirect: 'error', signal: controller.signal,
        headers: { Accept: bytes ? 'application/epub+zip' : 'application/json',
          ...(auth ? { Authorization: `Bearer ${accessKey}` } : {}), ...options.headers },
      });
      if (!response.ok) {
        let body;
        try { body = await response.json(); } catch {}
        const code = body?.error?.code || (response.status === 401 ? 'AUTH_REQUIRED' : response.status === 404 ? 'NOT_CONFIGURED' : 'SYNC_UNAVAILABLE');
        if (code === 'AUTH_REQUIRED') remember('');
        throw new LibrarySyncError(body?.error?.message || (code === 'NOT_CONFIGURED' ? '书库服务尚未接入，书已保留在本机。' : '书库暂时无法同步，书已保留在本机。'), code, body?.error?.retryable ?? response.status >= 500);
      }
      if (bytes) return await response.blob();
      try { return await response.json(); }
      catch { throw new LibrarySyncError('书库服务尚未接入，书已保留在本机。', 'NOT_CONFIGURED'); }
    } catch (error) {
      if (error instanceof LibrarySyncError) throw error;
      if (signal?.aborted) throw error;
      throw new LibrarySyncError('未能连上书库，书已保留在本机，稍后可以继续入藏。', 'NETWORK_ERROR', true);
    } finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  function entry(book) {
    if (!book || !/^[a-f0-9]{64}$/i.test(book.id || '') || !/\.epub$/i.test(book.filename || '') || !/^[a-f0-9]{40,64}$/i.test(book.sha || '')) {
      throw new LibrarySyncError('书库返回的藏书信息不完整。', 'INVALID_RESPONSE');
    }
    // Construct the URL ourselves; a server response can never redirect our bearer to another origin.
    return { key: `repo:${book.id}`, repositoryId: book.id, kind: 'repository',
      filename: String(book.filename), title: String(book.title || book.filename.replace(/\.epub$/i, '')),
      author: String(book.author || ''), size: Number(book.size) || 0, sha: book.sha,
      contentUrl: new URL(`books/${encodeURIComponent(book.id)}/content`, base).href };
  }
  async function listBooks() {
    const result = await request('books');
    if (!Array.isArray(result.books)) throw new LibrarySyncError('书库返回的书目无法读取。', 'INVALID_RESPONSE');
    const books = result.books.map(entry);
    verified = true;
    return books;
  }
  return {
    get authenticated() { return !!accessKey && verified; },
    get hasCredentials() { return !!accessKey; },
    get configured() { return capability.configured === true && capability.enabled === true; },
    get maxBytes() { return capability.maxBytes || 25 * 1024 * 1024; },
    async probe() {
      try {
        const value = await request('status', { auth: false, deadline: 6000 });
        capability = value && typeof value.configured === 'boolean' ? value : { enabled: false, configured: false };
      } catch (error) {
        capability = { enabled: false, configured: false, message: error.message, code: error.code };
      }
      return { ...capability };
    },
    async connect(value) {
      const candidate = String(value || '').trim();
      if (/^(?:gh[pousr]_|github_pat_)/i.test(candidate)) throw new LibrarySyncError('这里需要书库服务的钥印，请不要填写 GitHub 令牌。', 'WRONG_CREDENTIAL_TYPE');
      if (!candidate) throw new LibrarySyncError('请填写书库钥印。', 'AUTH_REQUIRED');
      const previousKey = accessKey, previousVerified = verified;
      remember(candidate);
      try { return await listBooks(); }
      catch (error) {
        remember(previousKey);
        verified = previousVerified;
        throw error;
      }
    },
    disconnect() { remember(''); },
    listBooks,
    async upload(blob, filename) {
      if (!(blob instanceof Blob)) throw new LibrarySyncError('本机的书籍文件暂时无法读取。', 'LOCAL_FILE_MISSING');
      if (blob.size > (capability.maxBytes || 25 * 1024 * 1024)) throw new LibrarySyncError('这本书超过当前书库服务的单册大小上限。', 'TOO_LARGE');
      const result = await request('books', { method: 'POST', body: blob,
        headers: { 'Content-Type': 'application/epub+zip', 'X-Book-Filename': encodeURIComponent(filename || blob.name || '新书.epub') } });
      const book = entry(result.book);
      const actualCommit = /^[a-f0-9]{40,64}$/i.test(result.commit?.sha || '');
      const verifiedExisting = result.alreadyPresent === true && result.commit === null;
      if (result.synced !== true || (!actualCommit && !verifiedExisting)) {
        throw new LibrarySyncError('尚未收到仓库保存成功的回执，这本书仍会保留在待同步中。', 'UNCONFIRMED_WRITE', true);
      }
      return { book, commitSha: actualCommit ? result.commit.sha : null, alreadyPresent: verifiedExisting };
    },
    async content(id) {
      if (!/^[a-f0-9]{64}$/i.test(id || '')) throw new LibrarySyncError('藏书编号无效。', 'INVALID_BOOK');
      return await request(`books/${encodeURIComponent(id)}/content`, { bytes: true });
    },
  };
}
