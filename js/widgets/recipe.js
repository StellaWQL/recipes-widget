import { BaseWidget } from '../core/base-widget.js';
import { parseCSV, validUrl } from '../core/utils.js';

export async function RecipeWidget(board, opts = {}) {
  const w = new RecipeWidgetImpl(board, opts);
  w.mount();
  await w.pick();
  return w;
}

class RecipeWidgetImpl extends BaseWidget {
  constructor(board, opts) {
    super(board, {
      type: 'recipe', title: 'Rubedo',
      defaults: { x: 140, y: 120, state: {} },
      opts,
    });
  }

  html() {
    return `
      <div class="grid">
        <div class="row" data-incant></div>
        <div class="grid">
          <a class="figure square" data-link target="_blank" rel="noopener noreferrer">
            <img data-img alt="recipe image" />
          </a>
          <div class="row"><strong data-title>准备中…</strong></div>
          <div class="row" data-issues></div>
        </div>
      </div>`;
  }

  incantation() {
    return {
      parts: [{ text: 'Et' }, { text: 'luna' }, { text: 'phase', hot: true }, { text: 'XI' }],
      author: '',
    };
  }

  async loadData() {
    const res = await fetch(`./data/atk_recipes_all.csv?t=${Date.now()}`, { cache: 'no-store' });
    if (!res.ok) throw new Error('CSV 加载失败: ' + res.status);
    const text = await res.text();
    return parseCSV(text, { header: true, skipEmptyLines: true })
      .map((r) => ({
        title:      (r.title || r.Title || r.name || '').trim(),
        image_url:  (r.image_url || r.image || r.img || '').trim(),
        recipe_url: (r.recipe_url || r.url || r.link || '').trim(),
      }))
      .filter((r) => r.title && (r.image_url || r.recipe_url));
  }

  render(r) {
    const title = this.bind('title');
    const img   = this.bind('img');
    const link  = this.bind('link');
    const issues = this.bind('issues');

    title.textContent = r.title || '未命名';
    const imgOk  = validUrl(r.image_url);
    const linkOk = validUrl(r.recipe_url);
    img.src  = imgOk  ? r.image_url  : '';
    link.href = linkOk ? r.recipe_url : '#';

    const msgs = [];
    if (!imgOk)  msgs.push('图片无效');
    if (!linkOk) msgs.push('链接无效');
    issues.innerHTML = msgs.map((s) => `<span class="badge">${s}</span>`).join('');
  }
}
