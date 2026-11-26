import { saveLayout } from './storage.js';
import { BOARD_PAD_TOP, WIN_PAD_BOTTOM, DRAG_THRESHOLD } from './config.js';

let zTop = 10;
const uid = () => 'w_' + Math.random().toString(36).slice(2, 9);

export function createWidget(board, { type, title, x = 120, y = 120, w = null, h = null, state = {} }) {
  const id = uid();
  const root = document.createElement('div');
  root.className = 'widget resizable';
  root.tabIndex = 0;
  root.style.left = x + 'px';
  root.style.top  = y + 'px';
  if (w) root.style.width  = w + 'px';
  if (h) root.style.height = h + 'px';
  root.dataset.id   = id;
  root.dataset.type = type;
  root.style.zIndex = ++zTop;

  root.innerHTML = `
    <div class="w-header" data-draghandle>
      <div class="w-title" data-title>${title}</div>
    </div>
    <div class="w-body"></div>
    <div class="w-footer"></div>
  `;

  const header  = root.querySelector('[data-draghandle]');
  const titleEl = root.querySelector('[data-title]');
  const body    = root.querySelector('.w-body');

  let drag = { on: false, dx: 0, dy: 0, moved: false, sx: 0, sy: 0 };

  header.addEventListener('mousedown', (e) => {
    drag.on = true;
    drag.moved = false;
    header.style.cursor = 'grabbing';
    root.style.zIndex = ++zTop;
    drag.dx = e.clientX - root.offsetLeft;
    drag.dy = e.clientY - root.offsetTop;
    drag.sx = e.clientX;
    drag.sy = e.clientY;
    e.preventDefault();
  });

  const onMove = (e) => {
    if (!drag.on) return;
    const nx = Math.max(0, Math.min(window.innerWidth  - root.offsetWidth,  e.clientX - drag.dx));
    const ny = Math.max(BOARD_PAD_TOP, Math.min(window.innerHeight - WIN_PAD_BOTTOM, e.clientY - drag.dy));
    if (Math.hypot(e.clientX - drag.sx, e.clientY - drag.sy) > DRAG_THRESHOLD) drag.moved = true;
    root.style.left = nx + 'px';
    root.style.top  = ny + 'px';
  };

  const onUp = () => {
    if (!drag.on) return;
    drag.on = false;
    header.style.cursor = 'grab';
    saveLayout(board);
  };

  window.addEventListener('mousemove', onMove);
  window.addEventListener('mouseup', onUp);

  titleEl.addEventListener('click', () => {
    if (!drag.moved) {
      root.remove();
      window.removeEventListener('mousemove', onMove);
      window.removeEventListener('mouseup', onUp);
      saveLayout(board);
    }
  });

  root.addEventListener('dblclick', () => { root.style.zIndex = ++zTop; });

  const ro = new ResizeObserver(() => saveLayout(board));
  ro.observe(root);

  board.appendChild(root);
  return { id, root, body, state };
}
