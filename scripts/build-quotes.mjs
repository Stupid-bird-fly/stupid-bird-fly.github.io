import { existsSync, mkdirSync, readFileSync, readdirSync, statSync, unlinkSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const args = process.argv.slice(2);
let sourceRoot;
let outputRoot = repoRoot;

for (let index = 0; index < args.length; index += 2) {
  const option = args[index];
  const value = args[index + 1];
  if (!value) throw new Error(`missing value for ${option}`);
  if (option === '--source') sourceRoot = path.resolve(value);
  else if (option === '--out') outputRoot = path.resolve(value);
  else throw new Error(`unknown option ${option}`);
}
if (!sourceRoot) throw new Error('usage: node scripts/build-quotes.mjs --source /path/to/redwisdom [--out /path/to/site]');

const dataRoot = path.join(sourceRoot, 'data');
const payload = JSON.parse(readFileSync(path.join(dataRoot, 'quotes.json'), 'utf8'));
const catalog = JSON.parse(readFileSync(path.join(dataRoot, 'catalog.json'), 'utf8'));

function requireString(value, label, allowEmpty = false) {
  if (typeof value !== 'string' || (!allowEmpty && !value.trim())) {
    throw new Error(`${label} must be ${allowEmpty ? 'a string' : 'a non-empty string'}`);
  }
  return value;
}

function safeFilename(value, label, extension) {
  requireString(value, label);
  if (value === '.' || value === '..' || value.includes('/') || value.includes('\\') || /[\x00-\x1f]/.test(value) || (extension && !value.endsWith(extension))) {
    throw new Error(`unsafe ${label}: ${value}`);
  }
  return value;
}

if (!Array.isArray(payload.quotes) || !payload.metadata || !Array.isArray(payload.metadata.categories)) {
  throw new Error('invalid quotes payload');
}
if (!Number.isInteger(payload.metadata.total) || payload.metadata.total !== payload.quotes.length) {
  throw new Error('metadata total does not match quotes');
}
const snapshotDate = requireString(payload.metadata.generated_at, 'metadata generated_at');
const categories = payload.metadata.categories.map((name) => safeFilename(name, 'category', null));
if (new Set(categories).size !== categories.length) throw new Error('duplicate metadata categories');
const categorySet = new Set(categories);

const articleByTitle = new Map();
const volumes = catalog?.volumes;
if (!volumes || typeof volumes !== 'object' || Array.isArray(volumes)) {
  throw new Error('invalid catalog volumes');
}
const volumeArticles = Object.values(volumes);
if (volumeArticles.length === 0) throw new Error('empty article catalog');
let articleCount = 0;
for (const articles of volumeArticles) {
  if (!Array.isArray(articles)) throw new Error('invalid catalog volume');
  for (const article of articles) {
    articleCount += 1;
    const title = requireString(article.title, 'article title');
    const filename = safeFilename(article.filename, 'article filename', '.md');
    const articlePath = path.join(dataRoot, 'articles', filename);
    if (!existsSync(articlePath)) {
      throw new Error(`missing article file: ${filename}`);
    }
    if (!statSync(articlePath).isFile()) throw new Error(`article is not a file: ${filename}`);
    // Repeated titles cannot identify one article unambiguously.
    articleByTitle.set(title, articleByTitle.has(title) ? null : filename);
  }
}
if (articleCount === 0) throw new Error('empty article catalog');

const seenIds = new Set();
const seenCategories = new Set();
const quotes = payload.quotes.map((item) => {
  if (!Number.isSafeInteger(item.id) || item.id < 1) throw new Error(`invalid quote id ${item.id}`);
  if (seenIds.has(item.id)) throw new Error(`duplicate quote id ${item.id}`);
  seenIds.add(item.id);

  const content = requireString(item.content, `quote ${item.id} content`);
  const source = requireString(item.source, `quote ${item.id} source`);
  const date = requireString(item.date, `quote ${item.id} date`, true);
  const category = requireString(item.category, `quote ${item.id} category`);
  if (!categorySet.has(category)) throw new Error(`metadata categories missing ${category}`);
  seenCategories.add(category);
  const filename = articleByTitle.get(source);
  return {
    id: item.id,
    content,
    source,
    date,
    category,
    articleUrl: filename ? `https://redwisdom.xyz/reading.html#${encodeURIComponent(filename)}` : null,
    sourceMatch: filename ? 'catalog-title' : 'unmatched',
  };
}).sort((a, b) => a.id - b.id);

for (const category of categories) {
  if (!seenCategories.has(category)) throw new Error(`metadata categories contains unused ${category}`);
}

const apiRoot = path.join(outputRoot, 'api/v1');
const quoteRoot = path.join(apiRoot, 'quotes');
const categoryRoot = path.join(apiRoot, 'categories');
mkdirSync(quoteRoot, { recursive: true });
mkdirSync(categoryRoot, { recursive: true });

for (const folder of [quoteRoot, categoryRoot]) {
  for (const entry of readdirSync(folder, { withFileTypes: true })) {
    if (entry.name.endsWith('.json') && !entry.isDirectory()) unlinkSync(path.join(folder, entry.name));
  }
}

function writeJSON(filename, value) {
  writeFileSync(filename, `${JSON.stringify(value, null, 2)}\n`);
}

writeJSON(path.join(apiRoot, 'quotes.json'), {
  version: 1,
  total: quotes.length,
  source: { project: 'redwisdom', snapshotDate },
  quotes,
});

const categoryItems = categories.map((name) => {
  const selected = quotes.filter((quote) => quote.category === name);
  writeJSON(path.join(categoryRoot, `${name}.json`), {
    version: 1,
    category: name,
    total: selected.length,
    quotes: selected,
  });
  return { name, count: selected.length, url: `/api/v1/categories/${encodeURIComponent(name)}.json` };
});
writeJSON(path.join(apiRoot, 'categories.json'), {
  version: 1,
  total: categoryItems.length,
  categories: categoryItems,
});

for (const quote of quotes) {
  writeJSON(path.join(quoteRoot, `${quote.id}.json`), { version: 1, quote });
}

process.stdout.write(`Generated ${quotes.length} quotes and ${categoryItems.length} categories in ${apiRoot}\n`);
