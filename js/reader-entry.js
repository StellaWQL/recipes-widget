/**
 * Reader entry only. The existing v17 app, city data and theatre art stay in place.
 * This classic script is loaded before app.js so only reader clicks are captured.
 */
(() => {
  'use strict';
  const script = document.currentScript;
  if (!script?.src) return;
  const siteRoot = new URL('../', script.src);
  const readerPage = new URL('reader-room/index.html', siteRoot);
  const query = new URLSearchParams(location.search);
  const bookNames = ['book', 'bookUrl', 'epub', 'epubUrl'];
  const catalogNames = ['catalog', 'catalogUrl', 'booksCatalog'];

  function firstPresent(names) {
    const name = names.find(candidate => query.has(candidate));
    return name === undefined ? null : { name, value: query.get(name) || '' };
  }

  function destination() {
    const next = new URL(readerPage.href);
    for (const [name, aliases] of [['book', bookNames], ['catalog', catalogNames]]) {
      const parameter = firstPresent(aliases);
      if (!parameter) continue;
      // Resolve a relative old root-page URL before moving into reader-room/.
      // Keep explicit catalog= empty: it intentionally disables the remote source.
      let value = parameter.value;
      if (value) {
        try { value = new URL(value, location.href).href; } catch { /* The reader reports an invalid URL. */ }
      }
      next.searchParams.set(name, value);
    }
    if (query.has('local')) next.searchParams.set('local', query.get('local') || '');
    return next.href;
  }

  const directReaderPage = script.hasAttribute('data-reader-redirect');
  const readerRoute = location.hash.toLowerCase() === '#reader'
    || !!firstPresent(bookNames) || query.has('local');
  if (directReaderPage || readerRoute) {
    location.replace(destination());
    return;
  }

  document.addEventListener('click', event => {
    const button = event.target?.closest?.('button');
    if (!button || button.disabled) return;

    const theatreBook = button.matches('#theatre [data-tool="reader"], #tool-dialog [data-tool="reader"]');
    // Verified v15 directory markup: mountDirectory creates this exact reading item.
    // Deliberately do not match arbitrary buttons by their text or position.
    const directoryBook = button.matches('#tool-content .directory-sheet .directory-tools > button.directory-button[aria-label="阅读"]')
      && document.querySelector('#tool-dialog')?.dataset.tool === 'directory';
    if (!theatreBook && !directoryBook) return;

    event.preventDefault();
    event.stopImmediatePropagation();
    location.assign(destination());
  }, { capture: true });
})();
