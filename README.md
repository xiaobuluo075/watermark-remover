# 水印去除工具 🎨

基于 Cloudflare Pages + Cloudflare Worker 的在线图片去水印工具。

当前架构：
- **前端：** Cloudflare Pages
- **API / 登录：** Cloudflare Worker
- **数据存储：** Cloudflare D1
- **图像处理：** ClipDrop Cleanup API

## 当前功能

- 上传图片（JPG / PNG / WEBP）
- 鼠标拖拽框选水印区域（支持多选、撤销）
- 一键 AI 去除水印
- Google 登录（Worker 架构）
- 记录登录用户的去水印使用日志（D1）

## 项目结构

```text
watermark-remover/
├── frontend/
│   ├── index.html       # Pages 前端
│   └── test-mask.html
├── worker/
│   ├── index.js         # Worker API + Google OAuth
│   └── wrangler.toml    # Worker 配置
├── schema.sql           # D1 表结构
├── REQUIREMENTS.md
└── README.md
```

## Cloudflare 侧部署思路

### Pages
部署 `frontend/` 目录。

### Worker
Worker 负责以下接口：
- `POST /cleanup`
- `GET /auth/google`
- `GET /auth/google/callback`
- `GET /auth/user`
- `GET /auth/logout`

### D1
D1 用来存：
- 用户信息
- 使用日志

## 部署步骤

## 1. 准备 Google OAuth

在 Google Cloud Console 创建 OAuth 2.0 Client：

- **Authorized redirect URI** 填：
  `https://api.watermaskremover.shop/auth/google/callback`

> 推荐把 Worker 绑定到 `api.watermaskremover.shop`，这样 Pages 主站和 Worker API 属于同一主域名，登录 Cookie 更稳定，不容易被浏览器当成第三方 Cookie 拦掉。

## 2. 创建 D1 数据库

```bash
wrangler d1 create watermark-remover
```

把返回的 `database_id` 填进 `worker/wrangler.toml`：

```toml
[[d1_databases]]
binding = "DB"
database_name = "watermark-remover"
database_id = "你的 D1 database_id"
```

然后执行初始化：

```bash
wrangler d1 execute watermark-remover --file=./schema.sql
```

## 3. 配置 Worker secrets

进入 `worker/` 目录后执行：

```bash
wrangler secret put CLIPDROP_API_KEY
wrangler secret put GOOGLE_CLIENT_ID
wrangler secret put GOOGLE_CLIENT_SECRET
wrangler secret put SESSION_SECRET
```

说明：
- `SESSION_SECRET` 建议使用一段长随机字符串
- 不要把这些值写死到代码仓库里

## 4. 检查 Worker vars

`worker/wrangler.toml` 里需要确认：

```toml
[vars]
APP_BASE_URL = "https://watermaskremover.shop"
GOOGLE_REDIRECT_URI = "https://api.watermaskremover.shop/auth/google/callback"
```

同时建议在 Cloudflare 里把 Worker 绑定到：
- `api.watermaskremover.shop/*`

## 5. 部署 Worker

```bash
cd worker
wrangler deploy
```

## 6. 部署 Pages 前端

可以用 GitHub 自动部署，也可以手动：

```bash
wrangler pages deploy ../frontend
```

## 7. 验证

### 页面
- `https://watermaskremover.shop`

### Worker
- `https://watermark-remover-worker.xiaobuluo075.workers.dev/auth/user`

### 检查项
- 页面右上角是否显示 Google 登录按钮
- 点击登录后是否能走 Google OAuth
- 登录后是否显示头像、姓名、退出按钮
- 去水印是否仍可正常使用

## 当前实现说明

### 登录状态
当前 Worker 使用 **签名 Cookie Session**：
- 登录成功后，Worker 生成签名 session cookie
- 前端通过 `/auth/user` 读取当前登录状态
- `/auth/logout` 清除 session cookie

### 为什么这样做
这是为了先把登录体系从旧 Node/Express 服务迁到 Cloudflare 架构里，避免主站继续依赖单独服务器。

## 后续可继续增强

- 给 Worker 绑定自定义 API 域名
- 增加用户每日调用次数限制
- 增加使用历史页面
- 增加付费额度体系
- 把 session 从签名 cookie 升级为服务端 session 存储（如果后面需求变复杂）

## 注意事项

1. Pages 和 Worker 是两条部署链路，部署时都要确认最新版本已发布。
2. 如果页面打开正常但没有登录按钮，优先检查 Pages 是否部署了最新 `frontend/index.html`。
3. 如果点击 Google 登录报错，优先检查：
   - Google redirect URI 是否一致
   - Worker secrets 是否已配置
   - `APP_BASE_URL` / `GOOGLE_REDIRECT_URI` 是否正确
4. 如果去水印失效，优先检查 Worker secret `CLIPDROP_API_KEY`。
