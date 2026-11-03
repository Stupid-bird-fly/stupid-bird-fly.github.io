// 毛泽东语录卡片：将本文件完整复制到 Scriptable 新脚本中即可使用。
// 桌面组件的 Parameter 可填写分类名称，例如「思维方法」；留空显示全部分类。

const API_URLS = [
  'https://stupid-bird-fly.github.io/api/v1/quotes.json',
  'https://raw.githubusercontent.com/Stupid-bird-fly/stupid-bird-fly.github.io/main/api/v1/quotes.json',
];
const CACHE_FILE = 'mao-quote-card-cache-v1.json';
const SELECTED_PREFIX = 'mao-quote-card-selected-v2';
const CACHE_AGE_MS = 24 * 60 * 60 * 1000;

function isValidQuote(quote) {
  return quote && Number.isInteger(quote.id) && quote.id > 0 &&
    typeof quote.content === 'string' && quote.content.trim() &&
    typeof quote.source === 'string' && quote.source.trim() &&
    typeof quote.date === 'string' &&
    typeof quote.category === 'string' && quote.category.trim() &&
    (quote.sourceMatch === 'catalog-title' || quote.sourceMatch === 'unmatched') &&
    (quote.articleUrl === null ||
      (typeof quote.articleUrl === 'string' && quote.articleUrl.startsWith('https://'))) &&
    (quote.sourceMatch !== 'unmatched' || quote.articleUrl === null);
}

function isValidPayload(data) {
  return data && data.version === 1 && Array.isArray(data.quotes) &&
    data.quotes.length > 0 && data.total === data.quotes.length &&
    data.quotes.every(isValidQuote);
}

function readCachedQuotes(manager, path) {
  try {
    if (!manager.fileExists(path)) return null;
    const cache = JSON.parse(manager.readString(path));
    return isValidPayload(cache.payload) && Number.isFinite(cache.savedAt) ? cache : null;
  } catch (_) {
    return null;
  }
}

async function loadQuotes(now) {
  const manager = FileManager.local();
  const path = manager.joinPath(manager.libraryDirectory(), CACHE_FILE);
  const cached = readCachedQuotes(manager, path);
  if (cached && now.getTime() >= cached.savedAt && now.getTime() - cached.savedAt < CACHE_AGE_MS) {
    return cached.payload;
  }

  for (const url of API_URLS) {
    try {
      const request = new Request(url);
      request.timeoutInterval = 5;
      const payload = await request.loadJSON();
      if (!isValidPayload(payload)) continue;
      try {
        manager.writeString(path, JSON.stringify({ savedAt: now.getTime(), payload }));
      } catch (_) {
        // 写缓存失败不妨碍显示本次取得的内容。
      }
      return payload;
    } catch (_) {
      // 尝试下一个地址；两处都失败后使用上次缓存。
    }
  }
  return cached ? cached.payload : null;
}

function dailyQuote(quotes, category, family, now) {
  const byCategory = category ? quotes.filter((quote) => quote.category === category) : quotes;
  const seen = new Set();
  const unique = byCategory
    .slice()
    .sort((a, b) => a.id - b.id)
    .filter((quote) => {
      const content = quote.content.trim();
      if (seen.has(content)) return false;
      seen.add(content);
      return true;
    });
  if (!unique.length) return null;

  const preferredLength = family === 'small' ? 48 : family === 'medium' ? 100 : 180;
  const shortEnough = unique.filter((quote) => quote.content.length <= preferredLength);
  const candidates = shortEnough.length ? shortEnough : unique;
  const dayNumber = Math.floor(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000);
  return candidates[dayNumber % candidates.length];
}

function selectionFileName(category, family) {
  let first = 2166136261;
  let second = 5381;
  for (let index = 0; index < category.length; index += 1) {
    const code = category.charCodeAt(index);
    first = Math.imul(first ^ code, 16777619);
    second = Math.imul(second ^ code, 2246822519);
  }
  const firstHex = ('00000000' + (first >>> 0).toString(16)).slice(-8);
  const secondHex = ('00000000' + (second >>> 0).toString(16)).slice(-8);
  return `${SELECTED_PREFIX}-${family}-${firstHex}${secondHex}.json`;
}

function dailySelection(now, category, family) {
  const dateKey = `${now.getFullYear()}-${('0' + (now.getMonth() + 1)).slice(-2)}-${('0' + now.getDate()).slice(-2)}`;
  let manager;
  let path;
  let quote = null;
  try {
    manager = FileManager.local();
    path = manager.joinPath(manager.libraryDirectory(), selectionFileName(category, family));
    if (manager.fileExists(path)) {
      const saved = JSON.parse(manager.readString(path));
      if (saved.version === 2 && saved.date === dateKey && isValidQuote(saved.quote)) quote = saved.quote;
    }
  } catch (_) {
    quote = null;
  }

  return {
    quote,
    save(selected) {
      if (!manager || !path) return;
      try {
        manager.writeString(path, JSON.stringify({ version: 2, date: dateKey, quote: selected }));
      } catch (_) {
        // 选择记录无法写入时，仍显示本次选出的语录。
      }
    },
  };
}

function nextRefresh(now, hasQuote) {
  if (!hasQuote) return new Date(now.getTime() + 30 * 60 * 1000);
  return new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1, 0, 15);
}

function palette() {
  return {
    paper: Color.dynamic(new Color('#F7F1E8'), new Color('#211C1A')),
    ink: Color.dynamic(new Color('#2C2520'), new Color('#F4EEE5')),
    red: Color.dynamic(new Color('#982C2C'), new Color('#F0A5A5')),
    muted: Color.dynamic(new Color('#64564B'), new Color('#C9BDB2')),
  };
}

function baseWidget(family, colors) {
  const widget = new ListWidget();
  widget.backgroundColor = colors.paper;
  widget.setPadding(family === 'small' ? 14 : 20, family === 'small' ? 14 : 22,
    family === 'small' ? 14 : 20, family === 'small' ? 14 : 22);
  return widget;
}

function errorWidget(now, family, title, detail) {
  const colors = palette();
  const widget = baseWidget(family, colors);
  const heading = widget.addText('毛泽东语录');
  heading.font = Font.semiboldSystemFont(13);
  heading.textColor = colors.red;
  widget.addSpacer();
  const message = widget.addText(title);
  message.font = Font.semiboldSystemFont(17);
  message.textColor = colors.ink;
  message.lineLimit = 2;
  widget.addSpacer(8);
  const hint = widget.addText(detail);
  hint.font = Font.systemFont(13);
  hint.textColor = colors.muted;
  hint.lineLimit = 2;
  widget.refreshAfterDate = nextRefresh(now, false);
  return widget;
}

function renderQuote(quote, family, now) {
  const colors = palette();
  const widget = baseWidget(family, colors);
  const header = widget.addText('毛泽东语录  ·  ' + quote.category);
  header.font = Font.semiboldSystemFont(family === 'small' ? 12 : 13);
  header.textColor = colors.red;
  header.lineLimit = 1;
  widget.addSpacer(family === 'small' ? 8 : 12);

  const maxVisible = family === 'small' ? 62 : family === 'medium' ? 130 : 220;
  const content = quote.content.length > maxVisible
    ? quote.content.slice(0, maxVisible - 1) + '…'
    : quote.content;
  const body = widget.addText(content);
  body.font = Font.mediumSystemFont(family === 'small' ? 18 : family === 'medium' ? 20 : 23);
  body.textColor = colors.ink;
  body.lineLimit = family === 'small' ? 5 : family === 'medium' ? 4 : 7;
  body.minimumScaleFactor = family === 'small' ? 0.9 : 0.85;

  widget.addSpacer();
  const source = widget.addText('— ' + quote.source);
  source.font = Font.systemFont(family === 'small' ? 12 : 13);
  source.textColor = colors.muted;
  source.lineLimit = 1;
  if (family !== 'small' && quote.date) {
    const date = widget.addText(quote.date);
    date.font = Font.systemFont(12);
    date.textColor = colors.muted;
    date.lineLimit = 1;
  }
  if (quote.articleUrl) widget.url = quote.articleUrl;
  widget.refreshAfterDate = nextRefresh(now, true);
  return widget;
}

const now = new Date();
const family = ['small', 'medium', 'large', 'extraLarge'].includes(config.widgetFamily)
  ? config.widgetFamily : 'medium';
const category = typeof args.widgetParameter === 'string' ? args.widgetParameter.trim() : '';
let widget;
try {
  const selection = dailySelection(now, category, family);
  if (selection.quote) {
    widget = renderQuote(selection.quote, family, now);
  } else {
    const data = await loadQuotes(now);
    if (!data) {
      widget = errorWidget(now, family, '暂时无法获取语录', '请联网打开脚本再试');
    } else {
      const quote = dailyQuote(data.quotes, category, family, now);
      if (quote) selection.save(quote);
      widget = quote
        ? renderQuote(quote, family, now)
        : errorWidget(now, family, '没有找到这个分类', '请检查组件的 Parameter');
    }
  }
} catch (_) {
  widget = errorWidget(now, family, '暂时无法获取语录', '请稍后再试');
}

Script.setWidget(widget);
try {
  if (!config.runsInWidget) await widget.presentMedium();
} finally {
  Script.complete();
}
