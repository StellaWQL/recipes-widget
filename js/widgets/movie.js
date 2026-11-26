import { BaseWidget } from '../core/base-widget.js';
import { parseCSV } from '../core/utils.js';

export async function MovieWidget(board, opts = {}) {
  const w = new MovieWidgetImpl(board, opts);
  w.mount();
  await w.pick();
  return w;
}

class MovieWidgetImpl extends BaseWidget {
  constructor(board, opts) {
    super(board, {
      type: 'movie', title: 'Citrinitas',
      defaults: { x: 360, y: 180, state: {} },
      opts,
    });
  }

  html() {
    return `
      <div class="grid">
        <div class="row" data-incant></div>
        <div class="grid">
          <a class="figure poster" data-link target="_blank" rel="noopener noreferrer">
            <img data-img alt="movie poster" />
          </a>
          <div class="row">
            <strong data-title>准备中…</strong>
            <span class="badge" data-year></span>
            <span class="badge" data-score></span>
          </div>
          <div class="row" data-issues></div>
        </div>
      </div>`;
  }

  incantation() {
    return {
      parts: [
        { text: 'Sero' }, { text: 'te' }, { text: 'amavi,', hot: true },
        { text: 'Pulchritudo' }, { text: 'tam' }, { text: 'antiqua' },
        { text: 'et' }, { text: 'tam' }, { text: 'nova!' },
        { text: 'Sero' }, { text: 'te' }, { text: 'amavi.' },
      ],
      author: 'S. Augustine.',
    };
  }

  async loadData() {
    const res = await fetch(`./data/movies.csv?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('movies.csv 加载失败');
    const txt = await res.text();
    return parseCSV(txt, { header: true, skipEmptyLines: true })
      .map((r) => {
        const ms = (r.metascore || r.score || r.metascore_w || '').toString().trim();
        return {
          title:        (r.title || r.name || '').trim(),
          release_date: (r.release_date || r.date || '').trim(),
          metascore:    ms,
          poster_url:   (r.poster_url || r.image_url || r.poster || '').trim(),
          url:          (r.url || r.link || r.movie_url || '').trim(),
        };
      })
      .filter((o) => o.title && (o.poster_url || o.url));
  }

  render(r) {
    const title = this.bind('title');
    const year  = this.bind('year');
    const score = this.bind('score');
    const img   = this.bind('img');
    const link  = this.bind('link');

    title.textContent = r.title || '未命名';
    year.textContent  = MovieWidgetImpl._parseYear(r.release_date) || '年份未知';
    const sc = parseInt(r.metascore, 10);
    score.textContent = Number.isFinite(sc) ? `Metascore ${sc}` : '无分数';
    if (r.poster_url) img.src = r.poster_url;
    const target = r.url ||
      `https://www.google.com/search?q=${encodeURIComponent('site:metacritic.com ' + (r.title || ''))}`;
    link.href = target;
  }

  static _parseYear(d) {
    if (!d) return '';
    const m4 = String(d).match(/(19|20)\d{2}/);
    if (m4) return m4[0];
    const m2 = String(d).match(/(\d{2})(?!.*\d)/);
    if (m2) {
      const yy = parseInt(m2[1], 10);
      return String(yy >= 30 ? 1900 + yy : 2000 + yy);
    }
    return '';
  }
}
