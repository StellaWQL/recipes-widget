/** Read the original repository CSV files without changing their string fields. */
export function parseCSV(input) {
  const text = String(input).replace(/^\uFEFF/, '');
  const rows = [];
  let row = [], field = '', quoted = false, closed = false, started = false;
  const finishRow = () => {
    if (started || row.length || field.length) rows.push([...row, field]);
    row = []; field = ''; closed = false; started = false;
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; }
        else { quoted = false; closed = true; }
      } else field += char;
    } else if (char === ',') {
      row.push(field); field = ''; closed = false; started = true;
    } else if (char === '\r' || char === '\n') {
      finishRow();
      if (char === '\r' && text[i + 1] === '\n') i++;
    } else if (char === '"' && !field.length && !closed) {
      quoted = true; started = true;
    } else {
      if (closed || char === '"') throw new Error('Invalid CSV quotation.');
      field += char; started = true;
    }
  }
  if (quoted) throw new Error('Unclosed CSV field.');
  finishRow();
  const headers = rows.shift() || [];
  return rows.map(values => {
    if (values.length !== headers.length) throw new Error('CSV column count does not match its header.');
    return Object.fromEntries(headers.map((header, i) => [header, values[i]]));
  });
}

export async function loadWidgetData(name, {
  fetcher = fetch,
  baseURL = new URL('../data/', import.meta.url),
} = {}) {
  const csvFile = { recipes: 'atk_recipes_all.csv', movies: 'movies.csv' }[name];
  if (csvFile) {
    let csvText;
    try {
      const response = await fetcher(new URL(csvFile, baseURL), { cache: 'no-cache' });
      if (!response.ok) throw new Error(`${name} CSV ${response.status}`);
      csvText = await response.text();
    } catch { /* Keep the bundled snapshot available when the CSV cannot be fetched. */ }
    if (csvText !== undefined) return parseCSV(csvText);
  }
  const response = await fetcher(new URL(`${name}.json`, baseURL));
  if (!response.ok) throw new Error(`${name} ${response.status}`);
  return response.json();
}
