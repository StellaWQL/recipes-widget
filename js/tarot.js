const DEFAULT_STORAGE_KEY = 'raven.tarot.free-spread.v1';
const DEFAULT_DECK_URL = new URL('../data/tarot-deck.json', import.meta.url);
const CSS_URL = new URL('../styles/tarot.css', import.meta.url);
const BACK_URL = new URL('../assets/art/tarot-back.png', import.meta.url);
// Visible card bounds inside all 78 original 240 × 320 PNGs are
// x = 39..199 and y = 0..319. Keep the paper, drag proxy and back this shape.
const CARD_ASPECT = 161 / 320;

const ICONS = {
  shuffle: '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M5 9h3c6 0 8 14 14 14h5M22 18l5 5-5 5M5 23h3c2.9 0 4.8-3.3 6.7-6.6M18.6 11.3C19.7 9.9 20.8 9 22 9h5M22 4l5 5-5 5"/></svg>',
  close: '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="m10 10 12 12M22 10 10 22"/></svg>',
  retry: '<svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M25 12a10 10 0 1 0 1 8M25 5v8h-8"/></svg>',
};


function element(tag, className, attributes = {}) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
  return node;
}

function clamp(value, fallback = 0.5) {
  return Number.isFinite(value) ? Math.max(0, Math.min(1, value)) : fallback;
}

function shuffled(values) {
  const result = [...values];
  for (let i = result.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
}

function ensureStyles() {
  if (document.querySelector('link[data-raven-tarot-style]')) return;
  const link = element('link', '', { rel: 'stylesheet', href: CSS_URL.href });
  link.dataset.ravenTarotStyle = '';
  document.head.append(link);
}

/**
 * Mount a free-form, upright-only tarot table.
 *
 * The returned API is immediate. Await `ready` for the deck result. `destroy()`
 * removes listeners and the mounted DOM; state is retained in localStorage.
 * `onClose` is optional and handles Escape. The host owns its close control;
 * pass `showClose: true` only when a standalone icon-only close is wanted.
 */
export function mountTarot(container, options = {}) {
  if (!(container instanceof Element)) throw new TypeError('A tarot container is required.');
  ensureStyles();

  const onClose = typeof options.onClose === 'function' ? options.onClose : null;
  const storageKey = options.storageKey || DEFAULT_STORAGE_KEY;
  const deckURL = new URL(options.deckUrl || DEFAULT_DECK_URL.href, document.baseURI);
  const controller = new AbortController();
  const { signal } = controller;
  let deck = [];
  let byId = new Map();
  let state = { version: 1, order: [], drawn: [] };
  let pending = null;
  let destroyed = false;
  let loading = false;
  let shuffleTimer = null;
  let suppressClickUntil = 0;
  let suppressClickId = null;
  let loadPromise;
  let deckColumns = 26;

  const root = element('section', 'tarot-module', {
    'aria-label': '塔罗自由摆牌', tabindex: '-1',
  });
  const table = element('div', 'tarot-table', { 'aria-label': '自由解牌区' });
  const tableSurface = element('div', 'tarot-table__surface', { 'aria-hidden': 'true' });
  const placedLayer = element('div', 'tarot-table__cards');
  table.append(tableSurface, placedLayer);

  const controls = element('div', 'tarot-controls');
  const shuffleButton = iconButton('shuffle', '重新洗牌并清空解牌区');
  const retryButton = iconButton('retry', '重新载入牌组');
  retryButton.hidden = true;
  controls.append(shuffleButton, retryButton);
  if (onClose && options.showClose === true) {
    const closeButton = iconButton('close', '回到画面');
    closeButton.addEventListener('click', () => onClose(), { signal });
    controls.append(closeButton);
  }

  const deckDock = element('div', 'tarot-dock');
  const deckLayout = element('div', 'tarot-deck-layout', {
    'aria-label': '全部背面牌，经过单张牌抬起，拖入解牌区',
  });
  const deckTrack = element('div', 'tarot-deck-track');
  deckLayout.append(deckTrack);
  deckDock.append(deckLayout);
  const status = element('p', 'tarot-sr-only', { 'aria-live': 'polite', 'aria-atomic': 'true' });
  root.append(table, deckDock, controls, status);
  container.replaceChildren(root);

  function iconButton(icon, label) {
    const button = element('button', 'tarot-control', { type: 'button', 'aria-label': label });
    button.innerHTML = ICONS[icon];
    return button;
  }

  function announce(message) {
    status.textContent = message;
  }

  function save() {
    if (!deck.length) return;
    try { localStorage.setItem(storageKey, JSON.stringify(state)); } catch { /* Private browsing can disable storage. */ }
  }

  function restore() {
    const all = deck.map(card => card.id);
    let saved = null;
    try { saved = JSON.parse(localStorage.getItem(storageKey) || 'null'); } catch { /* A fresh table remains usable. */ }
    if (!saved || saved.version !== 1 || !Array.isArray(saved.order) || !Array.isArray(saved.drawn)) {
      state = { version: 1, order: shuffled(all), drawn: [] };
      return;
    }
    const known = new Set(all);
    const seen = new Set();
    const order = saved.order.filter(id => {
      if (typeof id !== 'string' || !known.has(id) || seen.has(id)) return false;
      seen.add(id);
      return true;
    });
    order.push(...shuffled(all.filter(id => !seen.has(id))));
    const drawnIds = new Set();
    const drawn = saved.drawn.filter(card => {
      if (!card || !known.has(card.id) || drawnIds.has(card.id)) return false;
      drawnIds.add(card.id);
      return true;
    }).map((card, index) => ({
      id: card.id,
      x: clamp(card.x),
      y: clamp(card.y),
      flipped: card.flipped === true,
      z: Number.isFinite(card.z) ? card.z : index + 1,
    }));
    drawn.sort((a, b) => a.z - b.z).forEach((card, index) => { card.z = index + 1; });
    state = { version: 1, order, drawn };
  }

  function makeCard(id, kind, index) {
    const card = element('button', `tarot-card tarot-card--${kind}`, {
      type: 'button',
      'aria-label': kind === 'deck'
        ? `第 ${index + 1} 张背面牌，拖入解牌区或按回车抽取`
        : `已抽出的第 ${index + 1} 张牌，点击翻面，方向键移动`,
    });
    card.dataset.cardId = id;
    card.dataset.kind = kind;
    const inner = element('span', 'tarot-card__inner', { 'aria-hidden': 'true' });
    const back = element('span', 'tarot-card__back');
    const artwork = element('img', 'tarot-card__back-art', { src: BACK_URL.href, alt: '', draggable: 'false' });
    artwork.decoding = 'async';
    back.append(artwork);
    const front = element('span', 'tarot-card__front');
    inner.append(back, front);
    card.append(inner);
    if (kind === 'deck') {
      card.dataset.slot = String(index);
      card.style.zIndex = String(index + 1);
    }
    return card;
  }

  function applyFace(cardElement, card) {
    cardElement.classList.toggle('is-face-up', card.flipped);
    cardElement.setAttribute('aria-pressed', String(card.flipped));
    cardElement.setAttribute('aria-label', card.flipped
      ? '正位牌面，点击翻回背面，方向键移动'
      : '背面牌，点击翻开，方向键移动');
    if (!card.flipped) return;
    const front = cardElement.querySelector('.tarot-card__front');
    if (!front.firstChild) {
      const img = element('img', '', { src: byId.get(card.id).url, alt: '', draggable: 'false' });
      img.decoding = 'async';
      front.append(img);
    }
  }

  function positionCard(cardElement, card) {
    const availableWidth = Math.max(0, placedLayer.clientWidth - cardElement.offsetWidth);
    const availableHeight = Math.max(0, placedLayer.clientHeight - cardElement.offsetHeight);
    cardElement.style.left = `${clamp(card.x) * availableWidth}px`;
    cardElement.style.top = `${clamp(card.y) * availableHeight}px`;
    cardElement.style.zIndex = String(card.z);
  }

  function layoutPlaced() {
    // The taller card must still fit fully in the reading area on a short
    // viewport. This same measured size is used for pointer drop geometry.
    const maxWidth = Math.max(1, Math.min(placedLayer.clientWidth,
      placedLayer.clientHeight * CARD_ASPECT));
    root.style.setProperty('--tarot-max-card-width', `${maxWidth}px`);
    for (const cardElement of placedLayer.children) {
      const card = state.drawn.find(item => item.id === cardElement.dataset.cardId);
      if (card) positionCard(cardElement, card);
    }
  }

  function layoutDeck() {
    const width = deckTrack.clientWidth;
    if (!width || !root.clientHeight) return;
    const style = getComputedStyle(root);
    const contentHeight = root.clientHeight - parseFloat(style.paddingTop) - parseFloat(style.paddingBottom)
      - parseFloat(style.rowGap || 0);
    const narrow = width < 580;
    deckColumns = narrow ? 13 : 26;
    const rows = Math.max(1, Math.ceil(state.order.length / deckColumns));
    const dockHeight = Math.round(Math.min(narrow ? 320 : 290,
      Math.max(narrow ? 180 : 160, contentHeight * (narrow ? .46 : .38)),
      Math.max(100, contentHeight - 145)));
    root.style.setProperty('--tarot-dock-height', `${dockHeight}px`);
    const lift = narrow ? 10 : 14;
    const top = lift + 5;
    const bottom = 5;
    const preferredWidth = Math.min(narrow ? 56 : 82,
      Math.max(narrow ? 38 : 52, width / (deckColumns * .67)));
    const cardHeight = Math.max(24, Math.min(preferredWidth / CARD_ASPECT,
      (dockHeight - top - bottom) / (1 + (rows - 1) * .72)));
    const cardWidth = cardHeight * CARD_ASPECT;
    const stepX = deckColumns > 1 ? Math.max(0, (width - cardWidth) / (deckColumns - 1)) : 0;
    const stepY = rows > 1 ? (dockHeight - top - bottom - cardHeight) / (rows - 1) : 0;
    const actualLift = Math.min(lift, cardHeight * .2);
    for (const card of deckTrack.children) {
      const slot = Number(card.dataset.slot);
      const column = slot % deckColumns;
      const row = Math.floor(slot / deckColumns);
      // A stable narrow hit strip belongs to each card. Raised artwork cannot
      // steal the adjacent card's pointer target, even though the backs overlap.
      card.style.left = `${column * stepX}px`;
      card.style.top = `${top + row * stepY}px`;
      card.style.width = `${column === deckColumns - 1 ? cardWidth : Math.min(cardWidth, stepX)}px`;
      card.style.height = `${Math.min(cardHeight - actualLift, row === rows - 1 ? cardHeight : stepY)}px`;
      card.style.setProperty('--deck-card-width', `${cardWidth}px`);
      card.style.setProperty('--deck-card-height', `${cardHeight}px`);
      card.style.setProperty('--deck-card-lift', `${actualLift}px`);
    }
    root.dataset.deckRows = String(rows);
    root.dataset.deckColumns = String(deckColumns);
  }

  function layout() {
    layoutDeck();
    layoutPlaced();
  }

  function render() {
    const drawnIds = new Set(state.drawn.map(card => card.id));
    const backs = document.createDocumentFragment();
    // Keep the original slot after drawing. The hole shows where that paper
    // card was pulled out; other cards never slide under the pointer.
    state.order.forEach((id, index) => {
      if (!drawnIds.has(id)) backs.append(makeCard(id, 'deck', index));
    });
    deckTrack.replaceChildren(backs);
    const placed = document.createDocumentFragment();
    state.drawn.forEach((card, index) => {
      const node = makeCard(card.id, 'placed', index);
      applyFace(node, card);
      placed.append(node);
    });
    placedLayer.replaceChildren(placed);
    layout();
  }

  function nextZ() {
    return state.drawn.reduce((max, card) => Math.max(max, card.z), 0) + 1;
  }

  function cardNode(id) {
    return [...placedLayer.children].find(node => node.dataset.cardId === id);
  }

  function drawCard(id, position = { x: 0.5, y: 0.5 }, keyboard = false) {
    if (!byId.has(id) || state.drawn.some(card => card.id === id)) return false;
    state.drawn.push({ id, x: clamp(position.x), y: clamp(position.y), flipped: false, z: nextZ() });
    render();
    save();
    announce(`一张背面牌已放入解牌区，共 ${state.drawn.length} 张。`);
    if (keyboard) cardNode(id)?.focus({ preventScroll: true });
    return true;
  }

  function setPositionFromClient(clientX, clientY, offsetX, offsetY, width, height, targetWidth = width, targetHeight = height) {
    const bounds = placedLayer.getBoundingClientRect();
    const centerX = clientX - offsetX + width / 2;
    const centerY = clientY - offsetY + height / 2;
    if (centerX < bounds.left || centerX > bounds.right || centerY < bounds.top || centerY > bounds.bottom) return null;
    const availableWidth = Math.max(0, bounds.width - targetWidth);
    const availableHeight = Math.max(0, bounds.height - targetHeight);
    return {
      x: availableWidth ? clamp((centerX - bounds.left - targetWidth / 2) / availableWidth) : 0,
      y: availableHeight ? clamp((centerY - bounds.top - targetHeight / 2) / availableHeight) : 0,
    };
  }

  function placedSize() {
    const existing = placedLayer.firstElementChild;
    if (existing) return { width: existing.offsetWidth, height: existing.offsetHeight };
    const measure = element('span', 'tarot-card tarot-card--placed', { 'aria-hidden': 'true' });
    measure.style.visibility = 'hidden';
    measure.style.pointerEvents = 'none';
    placedLayer.append(measure);
    const size = { width: measure.offsetWidth, height: measure.offsetHeight };
    measure.remove();
    return size;
  }

  function beginPointer(event) {
    if (pending || loading || event.button > 0) return;
    const source = event.target.closest('.tarot-card');
    if (!source || !root.contains(source)) return;
    // Only suppress the click emitted by the completed drag. A deliberate new
    // press, even immediately after dropping, must be able to flip the card.
    suppressClickUntil = 0;
    suppressClickId = null;
    const rect = (source.dataset.kind === 'deck'
      ? source.querySelector('.tarot-card__inner') : source).getBoundingClientRect();
    const target = source.dataset.kind === 'deck' ? placedSize() : rect;
    pending = {
      pointerId: event.pointerId,
      pointerType: event.pointerType,
      source,
      id: source.dataset.cardId,
      kind: source.dataset.kind,
      downX: event.clientX,
      downY: event.clientY,
      offsetX: event.clientX - rect.left,
      offsetY: event.clientY - rect.top,
      width: rect.width,
      height: rect.height,
      targetWidth: target.width,
      targetHeight: target.height,
      started: false,
      ghost: null,
    };
    if (event.pointerType !== 'touch') source.focus({ preventScroll: true });
    try { source.setPointerCapture(event.pointerId); } catch { /* Window handlers still finish a mouse drag. */ }
  }

  function positionGhost(drag, clientX, clientY) {
    const host = drag.ghostHost;
    const bounds = host.getBoundingClientRect();
    const style = getComputedStyle(host);
    // The opening dialog briefly scales. Local absolute coordinates work both
    // during that transform and after it ends, without a fixed-child jump.
    const scaleX = bounds.width / (parseFloat(style.width) || bounds.width);
    const scaleY = bounds.height / (parseFloat(style.height) || bounds.height);
    const left = (clientX - drag.offsetX - bounds.left) / scaleX
      - (parseFloat(style.borderLeftWidth) || 0) + host.scrollLeft;
    const top = (clientY - drag.offsetY - bounds.top) / scaleY
      - (parseFloat(style.borderTopWidth) || 0) + host.scrollTop;
    drag.ghost.style.left = `${left}px`;
    drag.ghost.style.top = `${top}px`;
    drag.ghost.style.width = `${drag.width / scaleX}px`;
    drag.ghost.style.height = `${drag.height / scaleY}px`;
  }

  function movePointer(event) {
    if (!pending || pending.pointerId !== event.pointerId) return;
    const dx = event.clientX - pending.downX;
    const dy = event.clientY - pending.downY;
    if (!pending.started) {
      if (Math.hypot(dx, dy) < 7) return;
      pending.started = true;
      const ghost = pending.source.cloneNode(true);
      ghost.classList.add('tarot-card--ghost');
      ghost.classList.remove('is-candidate');
      ghost.removeAttribute('aria-label');
      ghost.setAttribute('aria-hidden', 'true');
      ghost.tabIndex = -1;
      ghost.style.width = `${pending.width}px`;
      ghost.style.height = `${pending.height}px`;
      ghost.style.zIndex = '2147483000';
      // A body-level clone is below a modal dialog's native top layer.
      // Keep the loose paper in the same layer as its table instead.
      const ghostHost = root.closest('dialog') || root;
      ghostHost.append(ghost);
      pending.ghost = ghost;
      pending.ghostHost = ghostHost;
      pending.source.classList.add('is-drag-origin');
      root.classList.add('is-dragging');
    }
    event.preventDefault();
    positionGhost(pending, event.clientX, event.clientY);
    table.classList.toggle('is-drop-ready', Boolean(setPositionFromClient(
      event.clientX, event.clientY, pending.offsetX, pending.offsetY, pending.width, pending.height, pending.targetWidth, pending.targetHeight,
    )));
  }

  function clearPointer(suppress = false) {
    if (!pending) return;
    if (suppress || pending.started) {
      suppressClickUntil = performance.now() + 500;
      suppressClickId = pending.id;
    }
    pending.ghost?.remove();
    pending.source.classList.remove('is-drag-origin');
    try { pending.source.releasePointerCapture(pending.pointerId); } catch { /* Capture may already be released. */ }
    pending = null;
    root.classList.remove('is-dragging');
    table.classList.remove('is-drop-ready');
  }

  function endPointer(event) {
    if (!pending || pending.pointerId !== event.pointerId) return;
    if (!pending.started) {
      clearPointer();
      return;
    }
    event.preventDefault();
    const drag = pending;
    const position = setPositionFromClient(
      event.clientX, event.clientY, drag.offsetX, drag.offsetY, drag.width, drag.height, drag.targetWidth, drag.targetHeight,
    );
    clearPointer(true);
    if (!position) return;
    if (drag.kind === 'deck') drawCard(drag.id, position);
    else {
      const card = state.drawn.find(item => item.id === drag.id);
      if (!card) return;
      Object.assign(card, position, { z: nextZ() });
      const node = cardNode(card.id);
      if (node) positionCard(node, card);
      save();
    }
  }

  function handleClick(event) {
    const node = event.target.closest('.tarot-card');
    if (!node || !root.contains(node)) return;
    if (performance.now() < suppressClickUntil && node.dataset.cardId === suppressClickId) {
      event.preventDefault();
      event.stopPropagation();
      return;
    }
    if (node.dataset.kind !== 'placed') return;
    const card = state.drawn.find(item => item.id === node.dataset.cardId);
    if (!card) return;
    card.flipped = !card.flipped;
    card.z = nextZ();
    applyFace(node, card);
    node.style.zIndex = String(card.z);
    save();
    announce(card.flipped ? '牌面已翻开，保持正位。' : '牌已翻回背面。');
  }

  function handleKey(event) {
    suppressClickUntil = 0;
    suppressClickId = null;
    if (event.key === 'Escape') {
      if (pending) { clearPointer(true); event.preventDefault(); event.stopPropagation(); }
      else if (onClose) { onClose(); event.preventDefault(); event.stopPropagation(); }
      return;
    }
    const node = event.target.closest('.tarot-card');
    if (!node || !root.contains(node)) return;
    if (node.dataset.kind === 'deck' && (event.key === 'Enter' || event.key === ' ')) {
      event.preventDefault();
      drawCard(node.dataset.cardId, {
        x: 0.35 + Math.random() * 0.3,
        y: 0.35 + Math.random() * 0.3,
      }, true);
      return;
    }
    if (node.dataset.kind === 'deck') {
      const offsets = { ArrowLeft: -1, ArrowRight: 1, ArrowUp: -deckColumns, ArrowDown: deckColumns };
      const offset = offsets[event.key];
      if (offset) {
        event.preventDefault();
        const start = Number(node.dataset.slot);
        const direction = Math.sign(offset);
        let slot = start + offset;
        while (slot >= 0 && slot < state.order.length) {
          const target = [...deckTrack.children].find(card => Number(card.dataset.slot) === slot);
          if (target) { target.focus({ preventScroll: true }); break; }
          slot += direction;
        }
      }
      return;
    }
    if (node.dataset.kind !== 'placed') return;
    const movement = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[event.key];
    if (!movement) return;
    event.preventDefault();
    const card = state.drawn.find(item => item.id === node.dataset.cardId);
    if (!card) return;
    const step = event.shiftKey ? 0.1 : 0.025;
    card.x = clamp(card.x + movement[0] * step);
    card.y = clamp(card.y + movement[1] * step);
    card.z = nextZ();
    positionCard(node, card);
    save();
  }

  function reshuffle() {
    if (loading || !deck.length || destroyed) return;
    clearPointer(true);
    state = { version: 1, order: shuffled(deck.map(card => card.id)), drawn: [] };
    render();
    save();
    root.classList.remove('is-shuffling');
    requestAnimationFrame(() => { if (!destroyed) root.classList.add('is-shuffling'); });
    clearTimeout(shuffleTimer);
    shuffleTimer = setTimeout(() => root.classList.remove('is-shuffling'), 430);
    announce('已重新洗牌，所有牌均回到下方，保持正位。');
  }

  async function loadDeck() {
    if (destroyed || loading) return { ok: false, count: 0 };
    loading = true;
    root.classList.add('is-loading');
    shuffleButton.disabled = true;
    retryButton.hidden = true;
    try {
      const response = await fetch(deckURL, { signal, cache: 'force-cache' });
      if (!response.ok) throw new Error('Deck unavailable');
      const json = await response.json();
      const cards = Array.isArray(json) ? json : json.cards;
      if (!Array.isArray(cards) || !cards.length) throw new Error('Deck empty');
      const seen = new Set();
      deck = cards.map(card => {
        if (!card || typeof card.id !== 'string' || typeof card.src !== 'string' || seen.has(card.id)) throw new Error('Invalid deck');
        seen.add(card.id);
        const url = new URL(card.src, deckURL);
        if (url.origin !== deckURL.origin) throw new Error('Unexpected card origin');
        return { ...card, url: url.href };
      });
      byId = new Map(deck.map(card => [card.id, card]));
      restore();
      render();
      save();
      shuffleButton.disabled = false;
      announce(`牌组已准备好，共 ${deck.length} 张，解牌区保留 ${state.drawn.length} 张。`);
      return { ok: true, count: deck.length };
    } catch (error) {
      if (!destroyed && error.name !== 'AbortError') {
        retryButton.hidden = false;
        announce('牌组未能载入，可以选择重试载入牌组。');
      }
      return { ok: false, count: 0 };
    } finally {
      loading = false;
      root.classList.remove('is-loading');
    }
  }

  shuffleButton.addEventListener('click', reshuffle, { signal });
  retryButton.addEventListener('click', () => { loadPromise = loadDeck(); }, { signal });
  root.addEventListener('pointerdown', beginPointer, { signal });
  root.addEventListener('click', handleClick, { signal });
  root.addEventListener('keydown', handleKey, { signal });
  window.addEventListener('pointermove', movePointer, { passive: false, signal });
  window.addEventListener('pointerup', endPointer, { passive: false, signal });
  window.addEventListener('pointercancel', event => {
    if (pending?.pointerId === event.pointerId) clearPointer(true);
  }, { signal });
  window.addEventListener('blur', () => clearPointer(true), { signal });
  window.addEventListener('pagehide', save, { signal });
  const observer = typeof ResizeObserver !== 'undefined' ? new ResizeObserver(layout) : null;
  observer?.observe(root);
  observer?.observe(placedLayer);
  window.addEventListener('resize', layout, { signal });
  loadPromise = loadDeck();

  return {
    get ready() { return loadPromise; },
    shuffle: reshuffle,
    getState() { return JSON.parse(JSON.stringify(state)); },
    destroy() {
      if (destroyed) return;
      save();
      destroyed = true;
      clearPointer(true);
      clearTimeout(shuffleTimer);
      observer?.disconnect();
      controller.abort();
      root.remove();
    },
  };
}

export default mountTarot;
