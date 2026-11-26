const store = new Map();

export const widgetState = {
  get(id)  { return store.get(id); },
  set(id, v) { store.set(id, v); },
  has(id) { return store.has(id); },
  delete(id) { store.delete(id); },
  keys()  { return store.keys(); },
  clear() { store.clear(); },
};
