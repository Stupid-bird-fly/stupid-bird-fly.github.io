import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import test from 'node:test';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const script = path.join(repoRoot, 'scripts/build-quotes.mjs');

function fixture() {
  const root = mkdtempSync(path.join(tmpdir(), 'mao-quotes-'));
  const source = path.join(root, 'redwisdom');
  const output = path.join(root, 'site');
  mkdirSync(path.join(source, 'data/articles'), { recursive: true });
  mkdirSync(output);

  const quotes = {
    quotes: [
      { id: 2, content: '未收录的句子。', source: '目录外篇目', date: '', category: '学习' },
      { id: 1, content: '先调查。', source: '文章甲', date: '一九三〇年', category: '实践' },
      { id: 3, content: '未收录的句子。', source: '目录外篇目', date: '', category: '学习' },
    ],
    metadata: { total: 3, categories: ['实践', '学习'], generated_at: '2026-01-29' },
  };
  const catalog = { volumes: { 第一卷: [{ title: '文章甲', filename: '001-文章甲.md' }] } };
  writeFileSync(path.join(source, 'data/quotes.json'), JSON.stringify(quotes));
  writeFileSync(path.join(source, 'data/catalog.json'), JSON.stringify(catalog));
  writeFileSync(path.join(source, 'data/articles/001-文章甲.md'), '# 文章甲');

  return { root, source, output, quotes, catalog };
}

function build(source, output) {
  const result = spawnSync(process.execPath, [script, '--source', source, '--out', output], {
    cwd: repoRoot,
    encoding: 'utf8',
  });
  if (result.status !== 0) throw new Error(result.stderr.trim());
  return result.stdout;
}

function json(output, filename) {
  return JSON.parse(readFileSync(path.join(output, 'api/v1', filename), 'utf8'));
}

test('emits list, category and detail files with honest article links', () => {
  const { source, output } = fixture();
  build(source, output);

  const all = json(output, 'quotes.json');
  assert.equal(all.version, 1);
  assert.equal(all.total, 3);
  assert.deepEqual(all.source, { project: 'redwisdom', snapshotDate: '2026-01-29' });
  assert.deepEqual(all.quotes.map((quote) => quote.id), [1, 2, 3]);
  assert.deepEqual(all.quotes[0], {
    id: 1,
    content: '先调查。',
    source: '文章甲',
    date: '一九三〇年',
    category: '实践',
    articleUrl: 'https://redwisdom.xyz/reading.html#001-%E6%96%87%E7%AB%A0%E7%94%B2.md',
    sourceMatch: 'catalog-title',
  });
  assert.equal(all.quotes[1].articleUrl, null);
  assert.equal(all.quotes[1].sourceMatch, 'unmatched');
  assert.equal(all.quotes[1].date, '');
  assert.equal(all.quotes[1].content, all.quotes[2].content);

  assert.deepEqual(json(output, 'quotes/2.json'), { version: 1, quote: all.quotes[1] });
  assert.deepEqual(json(output, 'categories/学习.json'), {
    version: 1,
    category: '学习',
    total: 2,
    quotes: [all.quotes[1], all.quotes[2]],
  });
  assert.deepEqual(json(output, 'categories.json'), {
    version: 1,
    total: 2,
    categories: [
      { name: '实践', count: 1, url: '/api/v1/categories/%E5%AE%9E%E8%B7%B5.json' },
      { name: '学习', count: 2, url: '/api/v1/categories/%E5%AD%A6%E4%B9%A0.json' },
    ],
  });
});

test('regeneration is deterministic and removes only stale generated JSON files', () => {
  const { source, output } = fixture();
  build(source, output);
  const api = path.join(output, 'api/v1');
  const first = readFileSync(path.join(api, 'quotes.json'));
  const detail = readFileSync(path.join(api, 'quotes/1.json'));
  writeFileSync(path.join(api, 'quotes/999.json'), '{}');
  writeFileSync(path.join(api, 'quotes/notes.txt'), 'keep me');
  writeFileSync(path.join(api, 'categories/旧分类.json'), '{}');

  build(source, output);
  assert.deepEqual(readFileSync(path.join(api, 'quotes.json')), first);
  assert.deepEqual(readFileSync(path.join(api, 'quotes/1.json')), detail);
  assert.deepEqual(readdirSync(path.join(api, 'quotes')).sort(), ['1.json', '2.json', '3.json', 'notes.txt']);
  assert.deepEqual(readdirSync(path.join(api, 'categories')).sort(), ['学习.json', '实践.json']);
});

test('rejects duplicate IDs and metadata/category inconsistencies before touching output', () => {
  const { source, output, quotes } = fixture();
  quotes.quotes[2].id = 2;
  writeFileSync(path.join(source, 'data/quotes.json'), JSON.stringify(quotes));
  assert.throws(() => build(source, output), /duplicate quote id 2/);
  assert.equal(readdirSync(output).length, 0);

  quotes.quotes[2].id = 3;
  quotes.metadata.categories = ['实践'];
  writeFileSync(path.join(source, 'data/quotes.json'), JSON.stringify(quotes));
  assert.throws(() => build(source, output), /categories.*学习/);
  assert.equal(readdirSync(output).length, 0);
});

test('rejects unsafe or missing article filenames', () => {
  const { source, output, catalog } = fixture();
  catalog.volumes.第一卷[0].filename = '../other.md';
  writeFileSync(path.join(source, 'data/catalog.json'), JSON.stringify(catalog));
  assert.throws(() => build(source, output), /unsafe article filename/);

  catalog.volumes.第一卷[0].filename = 'missing.md';
  writeFileSync(path.join(source, 'data/catalog.json'), JSON.stringify(catalog));
  assert.throws(() => build(source, output), /missing article file/);
});

test('rejects a directory named like a Markdown article', () => {
  const { source, output, catalog } = fixture();
  catalog.volumes.第一卷[0].filename = 'folder.md';
  writeFileSync(path.join(source, 'data/catalog.json'), JSON.stringify(catalog));
  mkdirSync(path.join(source, 'data/articles/folder.md'));

  assert.throws(() => build(source, output), /article is not a file/);
  assert.deepEqual(readdirSync(output), []);
});

test('rejects an array or empty article catalog before writing any output', () => {
  const { source, output, catalog } = fixture();
  const catalogPath = path.join(source, 'data/catalog.json');

  catalog.volumes = [];
  writeFileSync(catalogPath, JSON.stringify(catalog));
  assert.throws(() => build(source, output), /invalid catalog volumes/);
  assert.deepEqual(readdirSync(output), []);

  catalog.volumes = {};
  writeFileSync(catalogPath, JSON.stringify(catalog));
  assert.throws(() => build(source, output), /empty article catalog/);
  assert.deepEqual(readdirSync(output), []);

  catalog.volumes = { 第一卷: [] };
  writeFileSync(catalogPath, JSON.stringify(catalog));
  assert.throws(() => build(source, output), /empty article catalog/);
  assert.deepEqual(readdirSync(output), []);
});

test('committed redwisdom snapshot keeps 181 quotes, including 23 unmatched sources', () => {
  const all = json(repoRoot, 'quotes.json');
  assert.equal(all.total, 181);
  assert.equal(all.quotes.filter((quote) => quote.sourceMatch === 'catalog-title').length, 158);
  assert.equal(all.quotes.filter((quote) => quote.sourceMatch === 'unmatched').length, 23);
  assert.equal(all.quotes.find((quote) => quote.id === 85).date, '');
});
