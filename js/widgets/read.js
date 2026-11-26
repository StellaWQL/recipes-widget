import { BaseWidget } from '../core/base-widget.js';
import { GH } from '../core/config.js';

async function ensureEpubLibs() {
  if (window.ePub) return;
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/jszip@3.10.1/dist/jszip.min.js';
    s.onload  = () => res();
    s.onerror = () => rej(new Error('JSZip load fail'));
    document.head.appendChild(s);
  });
  await new Promise((res, rej) => {
    const s = document.createElement('script');
    s.src = 'https://unpkg.com/epubjs/dist/epub.min.js';
    s.onload  = () => res();
    s.onerror = () => rej(new Error('epub.js load fail'));
    document.head.appendChild(s);
  });
}

async function listFromGitHub() {
  const apiUrl = `https://api.github.com/repos/${GH.user}/${GH.repo}/contents/${GH.path}?ref=${GH.branch}`;
  const res = await fetch(apiUrl, { cache: 'no-store' });
  if (!res.ok) {
    const txt = await res.text().catch(() => '');
    throw new Error(`GitHub API ${res.status}: ${txt.slice(0, 160)}`);
  }
  const arr = await res.json();
  return arr
    .filter((it) => it.type === 'file' && /\.epub$/i.test(it.name))
    .map((it) => ({ name: it.name, url: it.download_url }));
}

async function extractCoverUrl(epubUrl) {
  await ensureEpubLibs();
  const book = ePub(epubUrl);
  await book.ready;
  let coverHref = await book.loaded.cover.catch(() => null);
  if (!coverHref) {
    const manifest = await book.loaded.manifest;
    const item = Object.values(manifest).find(
      (it) =>
        /cover/i.test(it.id || '') ||
        /cover/i.test(it.href || '') ||
        (it.properties || '').includes('cover-image'),
    );
    coverHref = item ? item.href : null;
  }
  if (!coverHref) return null;
  return book.resources.get(coverHref) || (await book.archive.createUrl(coverHref, { base64: false })) || null;
}

const readerUrlFor = (epubUrl) =>
  `./reader.html?${new URLSearchParams({ book: epubUrl }).toString()}`;

export async function ReadWidget(board, opts = {}) {
  const w = new ReadWidgetImpl(board, opts);
  w.mount();
  await w.pick();
  return w;
}

class ReadWidgetImpl extends BaseWidget {
  constructor(board, opts) {
    super(board, {
      type: 'read', title: 'Albedo',
      defaults: { x: 720, y: 140, state: {} },
      opts,
    });
  }

  html() {
    return `
      <div class="grid">
        <div class="row" data-incant></div>
        <div class="grid">
          <a class="figure poster" data-link target="_blank" rel="noopener noreferrer">
            <img data-img alt="book cover" />
          </a>
          <div class="row"><strong data-title>准备中…</strong></div>
          <div class="row" data-issues></div>
        </div>
      </div>`;
  }

  incantation() {
    return {
      parts: [
        { text: 'The' }, { text: 'stars', hot: true },
        { text: 'are' }, { text: 'threshed,' }, { text: 'and' },
        { text: 'the' }, { text: 'souls' }, { text: 'are' },
        { text: 'threshed' }, { text: 'from' }, { text: 'their' }, { text: 'husks.' },
      ],
      author: 'William Blake.',
    };
  }

  async loadData() {
    const list = await listFromGitHub();
    if (!list.length) throw new Error('没有发现任何 EPUB');
    return list;
  }

  async render(item) {
    const { name, url } = item;
    const title = this.bind('title');
    const link  = this.bind('link');
    const img   = this.bind('img');
    const issues = this.bind('issues');

    title.textContent = (name || '未命名').replace(/\.epub$/i, '');
    link.href = readerUrlFor(url);

    if (!this._state.covers) this._state.covers = {};
    img.removeAttribute('src');
    try {
      const cover = this._state.covers[url] || (await extractCoverUrl(url));
      if (cover) {
        this._state.covers[url] = cover;
        img.src = cover;
      } else {
        issues.innerHTML = '<span class="badge">未找到封面</span>';
      }
    } catch (e) {
      issues.innerHTML = '<span class="badge">封面解析失败</span>';
      console.error(e);
    }
  }
}
