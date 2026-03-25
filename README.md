# 水印去除工具 🎨

基于 AI 的在线图片水印去除工具，全程不存储图片，保护隐私。

## 功能

- 上传图片（JPG / PNG / WEBP）
- 鼠标拖拽框选水印区域（支持多选、撤销）
- 一键 AI 去除水印
- 自动下载处理结果

## 技术栈

- **前端：** 纯 HTML + Canvas + Vanilla JS → Cloudflare Pages
- **后端：** Cloudflare Workers
- **AI API：** ClipDrop Cleanup API

## 部署步骤

### 1. 获取 ClipDrop API Key

前往 https://clipdrop.co/apis 注册并获取 API Key（免费 100 次/月）

### 2. 部署 Cloudflare Worker

```bash
cd worker
npm install -g wrangler
wrangler login
wrangler secret put CLIPDROP_API_KEY   # 粘贴你的 API Key
wrangler deploy
```

部署成功后记录 Worker URL，格式类似：`https://watermark-remover-worker.xxx.workers.dev`

### 3. 更新前端 Worker URL

编辑 `frontend/index.html`，将第 `WORKER_URL` 那行改为你的 Worker 地址：

```js
const WORKER_URL = 'https://watermark-remover-worker.xxx.workers.dev/cleanup';
```

### 4. 部署前端到 Cloudflare Pages

```bash
wrangler pages deploy frontend/
```

或在 Cloudflare Dashboard 连接 GitHub 仓库，指定 `frontend/` 为根目录。

## 项目结构

```
watermark-remover/
├── frontend/
│   └── index.html       # 前端页面
├── worker/
│   ├── index.js         # Cloudflare Worker
│   └── wrangler.toml    # Worker 配置
├── REQUIREMENTS.md      # 需求文档
└── README.md
```
