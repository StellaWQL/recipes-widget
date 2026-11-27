/** Change only these paths when transplanting into a different repository layout. */
const here = new URL('./', import.meta.url);
export const config = Object.freeze({
  homeUrl: new URL('../index.html', here).href,
  catalogUrl: 'https://api.github.com/repos/StellaWQL/recipes-widget/contents/data/books?ref=practice',
  fallbackUrl: new URL('data/catalog.json', here).href,
  localBooksBase: new URL('../data/books/', here).href,
  // Reuse the existing 23 MB full Huiwen Mincho font instead of shipping it twice.
  fontUrl: new URL('../assets/fonts/huiwen-mincho.woff2?v=3', here).href,
  ornamentUrl: new URL('assets/props.png', here).href,
  defaultFontSize: 22,
  storageKey: 'raven.reader.room.v1',
  legacyStorageKey: 'raven.reader.v1',
});
