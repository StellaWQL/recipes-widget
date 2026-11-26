const QS = (k, fb = null) => {
  const v = new URLSearchParams(location.search).get(k);
  return v ? decodeURIComponent(v) : fb;
};

export const GH = {
  user:   QS('gh_user')   || 'StellaWQL',
  repo:   QS('gh_repo')   || 'recipes-widget',
  branch: QS('gh_branch') || 'practice',
  path:   QS('gh_path')   || 'data/books',
};

export const STORAGE_KEY  = 'widgets.layout.v1';
export const ZSTACK_START = 10;
export const BOARD_PAD_TOP = 48;
export const WIN_PAD_BOTTOM = 40;
export const DRAG_THRESHOLD = 4;
export const DEFAULT_POS = { recipe: { x: 120, y: 140 }, movie: { x: 520, y: 120 }, drawer: { x: 820, y: 160 }, read: { x: 920, y: 140 } };
export const DEFAULT_SIZE = 360;
