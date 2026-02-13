# n8n-nodes-thordata

极简的 n8n 社区节点，用于集成 Thordata 云端 HTTP API（搜索、通用抓取、智能抓取）。

## 功能

- **Search Engine（搜索）**：调用 Thordata SERP API，支持 Google、Bing、Yandex
- **Universal Scrape（通用抓取）**：调用 Web Unlocker API，抓取任意网页（支持 JS 渲染、HTML/PNG 输出）
- **Smart Scrape（智能抓取）**：封装 Unlocker + 自然语言指令，便于后续 LLM 节点做结构化提取

## 安装

### 在 n8n 中安装

1. 打开 n8n → **Settings** → **Community Nodes**
2. 点击 **Install**
3. 输入包名：`n8n-nodes-thordata`

### 本地开发

```bash
npm install
npm run build
```

## 配置凭据

在 n8n 中创建 **Thordata API** 凭据，需要填写：

### 必需字段

- **Scraper Token**（必需）：用于 SERP API 和 Web Unlocker API
  - 获取位置：[Dashboard → My Account](https://dashboard.thordata.com/account-settings)

### 可选字段

- **Public Token**（可选）：用于 Web Scraper API 的 Authorization Bearer token
  - 获取位置：[Dashboard → Web Scraper → API 配置页](https://dashboard.thordata.com/web-scraper/details/3/api)
  - 仅在使用 Web Scraper API 时需要

- **Public Key**（可选）：用于管理 API（查询余额、任务状态等）
  - 获取位置：[Dashboard → My Account](https://dashboard.thordata.com/account-settings)
  - 仅在使用管理 API 时需要

**注意**：当前版本的三个 operation（Search Engine、Universal Scrape、Smart Scrape）**只需要 Scraper Token**。Public Token 和 Public Key 是为未来扩展预留的。

## 使用示例

### 1. 搜索（Search Engine）

- **Operation**: `Search Engine`
- **Query**: `latest AI trends`
- **Engine**: `google` / `bing` / `yandex`
- **Max Results**: `10`

返回结构化的搜索结果 JSON。

### 2. 通用抓取（Universal Scrape）

- **Operation**: `Universal Scrape`
- **URL**: `https://example.com`
- **Render JavaScript**: `true`（推荐开启，处理动态网站）
- **Output Format**: `HTML` 或 `Screenshot (PNG)`

返回抓取后的 HTML 内容或 PNG 截图。

### 3. 智能抓取（Smart Scrape）

- **Operation**: `Smart Scrape`
- **URL**: `https://example.com/product`
- **Instructions**: `Extract product name, price, and main features`

返回包含 `url`、`instructions`、`raw`（HTML）的结构化数据，可接后续 LLM 节点做智能提取。

## API 端点

本节点直接调用 Thordata 官方 HTTP API：

- **搜索**: `https://scraperapi.thordata.com/request`
- **抓取**: `https://webunlocker.thordata.com/request`

详细 API 文档：https://doc.thordata.com

## 错误处理

节点已内置错误处理：
- 参数验证（必填字段检查）
- URL 自动补全（自动添加 https:// 前缀）
- API 错误信息友好展示
- 网络超时处理（5 分钟）

## 开发

```bash
# 构建
npm run build

# 监听模式
npm run dev
```

## 许可证

MIT