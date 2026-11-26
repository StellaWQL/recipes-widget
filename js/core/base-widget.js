import { createWidget }    from './shell.js';
import { makeIncantation } from './incantation.js';
import { widgetState }     from './state.js';

export class BaseWidget {
  constructor(board, { type, title, defaults, opts = {} }) {
    const merged = { ...defaults, ...opts };
    const shell = createWidget(board, { type, title, ...merged });
    this.board  = board;
    this.type   = type;
    this.title  = title;
    this.root   = shell.root;
    this.body   = shell.body;
    this.id     = shell.id;
    this._state = shell.state;
    this._els   = {};
    widgetState.set(this.id, this._state);
  }

  get state() { return this._state; }

  html() { return ''; }
  incantation() { return { parts: [], author: '' }; }
  async loadData() { return []; }
  render(_item) {}

  bind(sel) {
    return this.body.querySelector(`[data-${sel}]`);
  }

  randomIndex(length) {
    if (length <= 0) return -1;
    if (length === 1) return 0;
    let i;
    do { i = Math.floor(Math.random() * length); }
    while (i === this._state.last);
    return i;
  }

  showError(msg) {
    const el = this._els.issues;
    if (el) el.innerHTML = `<span class="badge">${msg}</span>`;
  }

  async pick() {
    let data = this._state._cached;
    if (!data) {
      try {
        data = await this.loadData();
        if (!data?.length) throw new Error('无数据');
        this._state._cached = data;
      } catch (e) {
        this.showError(e.message);
        return;
      }
    }
    const idx = this.randomIndex(data.length);
    if (idx >= 0) {
      this._state.last = idx;
      this.render(data[idx]);
    }
  }

  mount() {
    this.body.innerHTML = this.html();
    const incantCfg = this.incantation();
    if (incantCfg.parts?.length) {
      const parts = incantCfg.parts.map((p) =>
        p.hot ? { ...p, onClick: () => this.pick() } : p
      );
      makeIncantation(this.bind('incant'), { ...incantCfg, parts });
    }
  }
}
