import { STORAGE_KEY } from './config.js';
import { widgetState }  from './state.js';

export function saveLayout(board) {
  const data = [];
  board.querySelectorAll('.widget').forEach((el) => {
    const bodyHidden = el.querySelector('.w-body')?.classList.contains('hidden');
    data.push({
      id:        el.dataset.id,
      type:      el.dataset.type,
      x:         el.offsetLeft,
      y:         el.offsetTop,
      w:         el.offsetWidth,
      h:         el.offsetHeight,
      minimized: !!bodyHidden,
      state:     widgetState.get(el.dataset.id) || {},
    });
  });
  localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
}

export function loadLayout() {
  const raw = localStorage.getItem(STORAGE_KEY);
  return raw ? JSON.parse(raw) : null;
}

export function resetLayout() {
  localStorage.removeItem(STORAGE_KEY);
}
