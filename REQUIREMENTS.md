# 水印去除网站 - 需求文档

## 项目概述

一个基于 AI 的在线图片水印去除工具，用户上传图片后手动框选水印区域，系统调用 AI API 自动去除水印并提供下载。全程不存储用户图片，保护隐私。

---

## 功能需求

### 核心流程

1. 用户上传图片（支持 JPG / PNG / WEBP）
2. 图片在浏览器中展示，用户用鼠标框选水印区域
3. 点击"去除水印"按钮，前端生成 mask 图并发送到后端
4. 后端调用 ClipDrop Cleanup API 处理图片
5. 处理完成后，用户可直接下载结果图片
6. **全程不存储任何图片**

### 功能细节

- 支持多次框选（可叠加多个水印区域）
- 支持撤销上一次框选
- 支持清空所有框选重新来过
- 处理中显示 loading 状态
- 处理失败给出友好错误提示

---

## 技术方案

### 前端

- **技术栈：** 纯 HTML + Canvas + Vanilla JS（无框架依赖）
- **部署：** Cloudflare Pages（免费静态托管）
- **核心逻辑：**
  - 用 Canvas 渲染上传的图片
  - 鼠标拖拽绘制选区（红色半透明矩形）
  - 生成黑白 mask 图（选区为白色，其余为黑色）
  - 将原图 + mask 以 multipart/form-data 发送到 Worker

### 后端

- **技术栈：** Cloudflare Workers（JavaScript）
- **部署：** Cloudflare Workers（免费额度：10万次/天）
- **核心逻辑：**
  - 接收前端请求（原图 + mask）
  - 转发到 ClipDrop Cleanup API
  - 返回处理后的图片给前端
  - 处理 CORS

### 水印去除 API

- **服务：** ClipDrop Cleanup API
- **文档：** https://clipdrop.co/apis/docs/cleanup
- **请求方式：** POST multipart/form-data
- **参数：**
  - `image_file`：原始图片（二进制）
  - `mask_file`：mask 图（白色=需去除区域，黑色=保留区域）
- **免费额度：** 100 次/月
- **付费方案：** 按量计费

---

## 项目结构

```
watermark-remover/
├── frontend/
│   └── index.html          # 前端页面（上传、框选、下载）
├── worker/
│   ├── index.js            # Cloudflare Worker 代码
│   └── wrangler.toml       # Worker 配置文件
├── REQUIREMENTS.md         # 本需求文档
└── README.md               # 项目说明
```

---

## 部署方案

### Cloudflare Worker（后端）

1. 安装 Wrangler CLI：`npm install -g wrangler`
2. 登录：`wrangler login`
3. 配置 ClipDrop API Key（环境变量）：`wrangler secret put CLIPDROP_API_KEY`
4. 部署：`wrangler deploy`

### Cloudflare Pages（前端）

1. 在 Cloudflare Dashboard 创建 Pages 项目
2. 连接 GitHub 仓库，指定 `frontend/` 为构建目录
3. 或直接用 `wrangler pages deploy frontend/`

---

## 环境变量

| 变量名 | 说明 | 配置位置 |
|--------|------|----------|
| `CLIPDROP_API_KEY` | ClipDrop API 密钥 | Cloudflare Worker Secret |

---

## 非功能需求

- **隐私：** 图片仅在内存中处理，不落盘，不记录
- **性能：** 前端压缩图片至合理尺寸再上传（建议最大 2048px）
- **兼容性：** 支持主流现代浏览器（Chrome / Firefox / Safari / Edge）
- **响应式：** 基本适配移动端

---

## 里程碑

| 阶段 | 内容 | 状态 |
|------|------|------|
| 1 | 需求确认 + 仓库创建 | ✅ 完成 |
| 2 | 前端页面开发 | 🔲 待开发 |
| 3 | Cloudflare Worker 开发 | 🔲 待开发 |
| 4 | 联调测试 | 🔲 待开发 |
| 5 | 部署上线 | 🔲 待开发 |
