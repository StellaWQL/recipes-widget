/** Site-relative paths keep existing local books and fonts in place. */
const here = new URL('./', import.meta.url);
export const config = Object.freeze({
  homeUrl: new URL('../index.html', here).href,
  catalogUrl: 'https://api.github.com/repos/StellaWQL/recipes-widget/contents/data/books?ref=practice',
  fallbackUrl: new URL('data/catalog.json', here).href,
  localBooksBase: new URL('../data/books/', here).href,
  // Reuse the existing local Huiwen Mincho font (already subset by the site); v=2 busts the old cache.
  fontUrl: new URL('../assets/fonts/huiwen-mincho.woff2?v=2', here).href,
  defaultFontSize: 17,
  defaultScrollFontSize: 16,
  storageKey: 'raven.reader.room.v1',
  legacyStorageKey: 'raven.reader.v1',
});
