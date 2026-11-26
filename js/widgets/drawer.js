import { BaseWidget } from '../core/base-widget.js';

export async function CardDrawer(board, opts = {}) {
  const w = new CardDrawerImpl(board, opts);
  w.mount();
  return w;
}

class CardDrawerImpl extends BaseWidget {
  constructor(board, opts) {
    super(board, {
      type: 'drawer', title: 'Nigredo',
      defaults: { x: 820, y: 160, state: {} },
      opts,
    });
  }

  html() {
    const len = this._state.deck?.length || 5;
    return `
      <div class="grid">
        <div class="row">
          <button class="btn" data-draw>抽一张</button>
          <button class="btn secondary" data-peek>查看卡组(${len})</button>
        </div>
        <div class="grid" data-area><div class="badge">点"抽一张"随机出卡</div></div>
      </div>`;
  }

  async loadData() {
    return this._state.deck || [
      { title: '今日惊喜', desc: 'TBD' },
      { title: '健康打卡', desc: 'TBD' },
      { title: '电影之夜', desc: 'TBD' },
      { title: '整理时间', desc: 'TBD' },
      { title: '放松一下', desc: 'TBD' },
    ];
  }

  incantation() {
    return { parts: [], author: '' };
  }

  async mount() {
    super.mount();
    if (!this._state.deck) this._state.deck = await this.loadData();

    const area = this.bind('area');
    const drawBtn = this.bind('draw');
    const peekBtn = this.bind('peek');

    const renderCard = (c) => {
      area.innerHTML = '';
      const card = document.createElement('div');
      card.style.border       = '1px solid var(--stroke)';
      card.style.borderRadius = '12px';
      card.style.padding      = '10px';
      card.style.background   = '#17111a';
      card.innerHTML = `<strong>${c.title}</strong><div class="muted">${c.desc || ''}</div>`;
      area.appendChild(card);
    };

    drawBtn.addEventListener('click', () => {
      const deck = this._state.deck;
      if (!deck?.length) return;
      renderCard(deck[Math.floor(Math.random() * deck.length)]);
    });

    peekBtn.addEventListener('click', () => {
      const deck = this._state.deck;
      area.innerHTML = '';
      deck.forEach((c) => {
        const row = document.createElement('div');
        row.className = 'row';
        row.innerHTML = `<span class="badge">${c.title}</span><span class="muted">${c.desc || ''}</span>`;
        area.appendChild(row);
      });
    });

  }
}
