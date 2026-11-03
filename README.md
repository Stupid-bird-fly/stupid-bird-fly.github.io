# 毛泽东语录接口与 Scriptable 卡片

本项目提供可由 GitHub Pages 发布的只读 JSON 文件，以及一份可直接粘贴进 Scriptable 的 iOS 桌面卡片脚本。数据来自本地 `redwisdom` 项目的 `data/quotes.json`，生成时还会读取 `data/catalog.json`，为能按文章标题匹配的语录附上阅读页链接。

## JSON 接口

以下路径均为静态文件；发布到 GitHub Pages 后才有在线地址。[GitHub Pages 官方文档](https://docs.github.com/en/pages/getting-started-with-github-pages/creating-a-github-pages-site)说明它发布静态文件，不运行服务端语言。因此这里不提供写入、查询参数筛选、服务端随机或实时更新。

| 路径 | 内容 |
| --- | --- |
| `/api/v1/quotes.json` | 全部语录、总数和数据来源信息 |
| `/api/v1/categories.json` | 分类名称、数量和分类文件地址 |
| `/api/v1/categories/<分类名>.json` | 指定分类的语录；中文分类名在 URL 中需编码 |
| `/api/v1/quotes/<ID>.json` | 单条语录 |

语录字段为 `id`、`content`、`source`、`date`、`category`、`articleUrl` 和 `sourceMatch`。`sourceMatch` 为 `catalog-title` 时，`articleUrl` 指向 `redwisdom` 的**文章页**；为 `unmatched` 时，`articleUrl` 为 `null`。文章标题匹配不等于语录正文已逐字核实，也不提供段落级定位。

## Scriptable 卡片

1. 将 [`scriptable/mao-quote-card.js`](scriptable/mao-quote-card.js) 复制到 Scriptable，保存为脚本。
2. 在 iOS 桌面添加 Scriptable 小组件，选择此脚本。推荐中号；小号和大号也可使用。
3. 如需限定分类，在小组件参数中填写 `categories.json` 所列的**完整分类名称**，例如 `思维方法`。留空表示全部分类。

脚本优先请求 `https://yuanit.vip/api/v1/quotes.json`，失败后尝试 GitHub Raw 地址。脚本按设备的本地日期选取当天语录，同一天保持稳定；使用本地缓存，在网络暂时不可用时继续显示上次成功获取的数据。首次运行且网络不可用时会显示错误卡片。小号组件优先轮换较短的语录；想看到更多长句可使用中号或大号。组件刷新时间由 iOS 决定，不能保证午夜立即换卡。[Scriptable 文档](https://docs.scriptable.app/listwidget/)也说明 `refreshAfterDate` 只表示最早可刷新时间。

## 更新数据与验证

需要 Node.js，未使用 npm 依赖。将 `--source` 指向本地 `redwisdom` 仓库根目录：

```sh
node scripts/build-quotes.mjs --source /path/to/redwisdom
node --test tests/*.test.mjs
```

生成器会重新写入 `api/v1/` 下的语录 JSON 文件。源数据目前有 181 条、26 个分类；其中 158 条能按标题匹配目录，23 条没有对应文章链接，1 条缺日期，另有 1 组重复正文。保留这些源记录，接口不将它们标记为已经校对。[Red Wisdom](https://redwisdom.xyz/) 的正文文本仍处于校对中；正式引用请与权威版本核对。上游仓库未提供这些中文语录的独立授权说明，公开再分发前请确认使用权限。

## 发布检查

更新数据后需要提交并发布生成的 JSON 文件。确认 GitHub Pages 的发布源包含仓库根目录的 `api/`，再访问 `https://yuanit.vip/api/v1/quotes.json` 检查 JSON 响应。仓库的 `CNAME` 指向 `yuanit.vip`；如果以后更换域名，应同步修改脚本中的主地址。2026-11-03 验证时，该自定义域名的 HTTPS 请求返回了与本地相同的 JSON。
