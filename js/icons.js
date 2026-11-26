const shapes={
  refresh:'<path d="M19 7a8 8 0 1 0 1 8M19 3v5h-5"/>',
  external:'<path d="M14 4h6v6M20 4l-9 9M11 5H5v15h15v-6"/>',
  book:'<path d="M12 5c-3-2-6-2-9-1v15c3-1 6-1 9 1 3-2 6-2 9-1V4c-3-1-6-1-9 1Z"/><path d="M12 5v15"/>',
  tarot:'<rect x="6" y="3" width="13" height="18" rx="1"/><path d="M3 17V3h11M12.5 7l1.2 3.6 3.8.2-3 2.3.9 3.7-2.9-2.1-3 2.1.9-3.7-3-2.3 3.9-.2Z"/>',
  recipe:'<path d="M3 14a9 9 0 0 1 18 0H3ZM2 17h20M12 5V3M10 3h4"/>',
  movie:'<path d="M3 3h18v18H3zM3 6c4 1 6 5 6 9L3 21M21 6c-4 1-6 5-6 9l6 6M9 15c2 1 4 1 6 0"/>',
  inspiration:'<path d="M3 6h18v14H3zM3 6l9 7 9-7M3 20l7-8M21 20l-7-8"/>',
  city:'<path d="M3 21V11h5V6l4-3 4 3v5h5v10H3ZM8 21V11h8v10M11 21v-5h2v5M4 7V4M19 7V4"/>',
  close:'<path d="m6 6 12 12M18 6 6 18"/>'
};
export function icon(name){return `<svg viewBox="0 0 24 24" aria-hidden="true">${shapes[name]||shapes.book}</svg>`;}
