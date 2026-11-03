import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { test } from 'node:test';
import vm from 'node:vm';

process.env.TZ = 'Asia/Singapore';

const scriptPath = new URL('../scriptable/mao-quote-card.js', import.meta.url);
const ARTICLE_URL = 'https://redwisdom.xyz/reading.html#001-%E6%B5%8B%E8%AF%95.md';

function quote(id, content, category, articleUrl = null) {
  return {
    id,
    content,
    source: '测试文章',
    date: '一九四四年',
    category,
    articleUrl,
    sourceMatch: articleUrl ? 'catalog-title' : 'unmatched',
  };
}

function payload(quotes) {
  return { version: 1, total: quotes.length, source: { project: 'redwisdom' }, quotes };
}

function expireApiCache(files) {
  for (const [path, text] of files) {
    let value;
    try { value = JSON.parse(text); } catch (_) { continue; }
    if (value && value.payload && Number.isFinite(value.savedAt)) {
      files.set(path, JSON.stringify({ ...value, savedAt: value.savedAt - 48 * 60 * 60 * 1000 }));
      return;
    }
  }
  throw new Error('API cache not found');
}

async function runWidget({ data, date = '2026-11-03T08:00:00Z', family = 'medium', parameter = '', files = new Map(), requestHandler } = {}) {
  const requests = [];
  const timeouts = [];
  const widgets = [];
  const previews = [];
  let completed = false;
  const epoch = new Date(date).getTime();

  class FixedDate extends Date {
    constructor(...args) {
      super(...(args.length ? args : [epoch]));
    }
    static now() { return epoch; }
  }

  class Container {
    constructor() { this.elements = []; }
    addText(value) {
      const item = { kind: 'text', value: String(value) };
      this.elements.push(item);
      return item;
    }
    addSpacer(value) { this.elements.push({ kind: 'spacer', value }); }
    addStack() {
      const stack = new Container();
      this.elements.push({ kind: 'stack', stack });
      return stack;
    }
    setPadding(...value) { this.padding = value; }
  }

  class ListWidget extends Container {
    async presentMedium() { previews.push('medium'); }
    async presentSmall() { previews.push('small'); }
    async presentLarge() { previews.push('large'); }
  }

  class Request {
    constructor(url) { this.url = url; }
    async loadJSON() {
      requests.push(this.url);
      timeouts.push(this.timeoutInterval ?? 60);
      if (requestHandler) return requestHandler(this.url, this.timeoutInterval ?? 60);
      return data;
    }
  }

  class Color {
    constructor(hex) { this.hex = hex; }
    static dynamic(light, dark) { return { light, dark }; }
  }

  const Font = new Proxy({}, { get: (_, name) => (size) => ({ name, size }) });
  const FileManager = {
    local: () => ({
      libraryDirectory: () => '/library',
      joinPath: (a, b) => `${a}/${b}`,
      fileExists: (path) => files.has(path),
      readString: (path) => files.get(path),
      writeString: (path, value) => files.set(path, value),
    }),
  };
  const Script = {
    setWidget: (widget) => widgets.push(widget),
    complete: () => { completed = true; },
  };

  const source = existsSync(scriptPath) ? readFileSync(scriptPath, 'utf8') : '';
  await vm.runInNewContext(`(async () => {\n${source}\n})()`, {
    Request, ListWidget, Color, Font, FileManager, Script, Date: FixedDate,
    config: { runsInWidget: true, widgetFamily: family },
    args: { widgetParameter: parameter },
    console,
  }, { filename: 'mao-quote-card.js', timeout: 2000 });

  const widget = widgets[0];
  function textValues(container) {
    if (!container) return [];
    return container.elements.flatMap((item) => item.kind === 'text' ? [item.value] : item.kind === 'stack' ? textValues(item.stack) : []);
  }
  return { widget, texts: textValues(widget), files, requests, timeouts, previews, completed };
}

test('同一天语录稳定，次日轮换时跳过重复正文', async () => {
  const data = payload([
    quote(1, '第一条语录', '思维方法'),
    quote(2, '第二条语录', '思维方法'),
    quote(3, '第一条语录', '思维方法'),
  ]);
  const first = await runWidget({ data, date: '2026-11-03T08:00:00Z' });
  const sameDay = await runWidget({ data, date: '2026-11-03T09:00:00Z' });
  const nextDay = await runWidget({ data, date: '2026-11-04T08:00:00Z' });
  const selected = (result) => result.texts.find((text) => ['第一条语录', '第二条语录'].includes(text));
  assert.ok(first.widget);
  assert.equal(selected(first), selected(sameDay));
  assert.notEqual(selected(first), selected(nextDay));
  assert.equal(first.completed, true);
});

test('组件参数按分类选择，且只为有文章链接的语录设置点击地址', async () => {
  const data = payload([
    quote(1, '甲类内容', '思维方法', ARTICLE_URL),
    quote(2, '乙类内容', '学习态度'),
  ]);
  const selected = await runWidget({ data, parameter: '思维方法' });
  assert.ok(selected.texts.includes('甲类内容'));
  assert.ok(!selected.texts.includes('乙类内容'));
  assert.equal(selected.widget.url, ARTICLE_URL);

  const unmatched = await runWidget({ data, parameter: '学习态度' });
  assert.ok(unmatched.texts.includes('乙类内容'));
  assert.equal(unmatched.widget.url, undefined);
});

test('在线获取后保存缓存，离线时仍显示旧数据', async () => {
  const files = new Map();
  const data = payload([quote(1, '可离线阅读的语录', '实践精神')]);
  const online = await runWidget({ data, files });
  assert.ok(online.texts.includes('可离线阅读的语录'));
  assert.ok(files.size > 0);

  const offline = await runWidget({
    files,
    date: '2026-11-07T08:00:00Z',
    requestHandler: async () => { throw new Error('offline'); },
  });
  assert.ok(offline.texts.includes('可离线阅读的语录'));
});

test('主地址失败时尝试备用地址', async () => {
  const data = payload([quote(1, '备用地址内容', '工作方法')]);
  const result = await runWidget({
    requestHandler: async (url) => {
      if (url.includes('raw.githubusercontent.com')) return data;
      throw new Error('pages failed');
    },
  });
  assert.ok(result.texts.includes('备用地址内容'));
  assert.equal(result.requests.length, 2);
  assert.match(result.requests[1], /raw\.githubusercontent\.com/);
});

test('两个地址均设置短超时，超时后显示旧缓存', async () => {
  const files = new Map();
  const data = payload([quote(1, '旧缓存中的语录', '工作方法')]);
  await runWidget({ data, files });

  const result = await runWidget({
    files,
    date: '2026-11-07T08:00:00Z',
    requestHandler: async (_url, timeout) => {
      if (timeout > 5) throw new Error('request would wait too long');
      throw new Error('timed out');
    },
  });
  assert.ok(result.texts.includes('旧缓存中的语录'));
  assert.equal(result.requests.length, 2);
  assert.ok(result.timeouts.every((seconds) => seconds <= 5), `timeouts: ${result.timeouts}`);
});

test('同一当地日期即使 API 更新并删除旧 ID，卡片仍显示已选语录', async () => {
  const files = new Map();
  const first = await runWidget({
    data: payload([quote(1, '当天原语录', '思维方法')]),
    files,
    date: '2026-11-03T08:00:00Z',
  });
  assert.ok(first.texts.includes('当天原语录'));
  expireApiCache(files);

  const refreshed = await runWidget({
    data: payload([quote(2, '接口更新后的语录', '思维方法')]),
    files,
    date: '2026-11-03T09:00:00Z',
  });
  assert.ok(refreshed.requests.length > 0);
  assert.ok(refreshed.texts.includes('当天原语录'));
  assert.ok(!refreshed.texts.includes('接口更新后的语录'));
});

test('每日选择按分类和组件尺寸分别保存，互不覆盖', async () => {
  const files = new Map();
  const date = '2026-11-03T08:00:00Z';
  const first = await runWidget({
    data: payload([quote(1, '小号甲类旧语录', '思维方法'), quote(2, '乙类旧语录', '学习态度')]),
    files, date, family: 'small', parameter: '思维方法',
  });
  assert.ok(first.texts.includes('小号甲类旧语录'));
  expireApiCache(files);

  const medium = await runWidget({
    data: payload([quote(3, '中号甲类新语录', '思维方法'), quote(4, '乙类新语录', '学习态度')]),
    files, date, family: 'medium', parameter: '思维方法',
  });
  assert.ok(medium.texts.includes('中号甲类新语录'));
  expireApiCache(files);

  const otherCategory = await runWidget({
    data: payload([quote(5, '乙类再次更新', '学习态度')]),
    files, date, family: 'small', parameter: '学习态度',
  });
  assert.ok(otherCategory.texts.includes('乙类再次更新'));

  const originalSlot = await runWidget({
    files, date, family: 'small', parameter: '思维方法',
  });
  assert.ok(originalSlot.texts.includes('小号甲类旧语录'));
});

test('当日选择文件损坏时仍能显示语录并恢复稳定选择', async () => {
  const files = new Map([['/library/mao-quote-card-selected-v1.json', '{损坏']]);
  const date = '2026-11-03T08:00:00Z';
  const first = await runWidget({ data: payload([quote(1, '损坏后首次语录', '实践精神')]), files, date });
  assert.ok(first.texts.includes('损坏后首次语录'));
  expireApiCache(files);
  const second = await runWidget({
    data: payload([quote(2, '损坏后新接口语录', '实践精神')]),
    files, date,
  });
  assert.ok(second.texts.includes('损坏后首次语录'));
});

test('无缓存且接口无效时显示可读错误卡片', async () => {
  const result = await runWidget({ data: { version: 1, quotes: [] } });
  assert.ok(result.widget);
  assert.match(result.texts.join(' '), /无法|失败|联网|稍后/);
  assert.equal(result.completed, true);
  assert.equal(result.widget.url, undefined);
});

test('小尺寸卡片可处理长语录，并安排下一次刷新', async () => {
  const data = payload([quote(1, '长'.repeat(160), '学习态度')]);
  const result = await runWidget({ data, family: 'small' });
  assert.ok(result.texts.some((text) => text.includes('长')));
  assert.ok(result.widget.refreshAfterDate instanceof Date);
  assert.ok(result.widget.refreshAfterDate.getTime() > new Date('2026-11-03T08:00:00Z').getTime());
});
