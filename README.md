# Model Status Edge

参考 [WizisCool/model-status](https://github.com/WizisCool/model-status) 思路重做的 Cloudflare 原生版本：

- 前端部署到 Cloudflare Pages
- 后端 API 和定时任务运行在 Cloudflare Worker
- 数据库存储使用 D1

它保留了原项目最关键的能力：

- 公开状态页
- 管理后台
- 上游模型目录同步
- 基于真实请求的模型探测
- 历史可用率与延迟聚合
- 定时巡检

## 项目结构

```text
apps/
  web/       React + Vite Pages 前端
  worker/    Cloudflare Worker API + Cron + D1 migration
packages/
  shared/    前后端共享类型
scripts/
  deploy-cloudflare.mjs
```

## 一键部署

### 1. 安装依赖

```bash
npm install
```

### 2. 准备环境变量

需要在终端里提供以下变量：

- `CLOUDFLARE_ACCOUNT_ID`
- `ADMIN_PASSWORD`
- `SESSION_SECRET`

可选变量：

- `CF_PROJECT_NAME`
- `CF_WORKER_NAME`
- `CF_D1_NAME`
- `CF_PAGES_PROJECT_NAME`
- `ADMIN_USERNAME`
- `APP_ORIGIN`
- `EXTRA_ALLOWED_ORIGINS`

默认规则：

- `CF_PROJECT_NAME` 默认使用仓库目录名
- `CF_WORKER_NAME` 默认 `${CF_PROJECT_NAME}-api`
- `CF_D1_NAME` 默认 `${CF_PROJECT_NAME}-db`
- `CF_PAGES_PROJECT_NAME` 默认 `CF_PROJECT_NAME`
- `ADMIN_USERNAME` 默认 `admin`
- `APP_ORIGIN` 默认 `https://${CF_PAGES_PROJECT_NAME}.pages.dev`

### 3. 登录 Wrangler

```bash
npx wrangler login
```

### 4. 执行部署

PowerShell:

```powershell
$env:CLOUDFLARE_ACCOUNT_ID="your-account-id"
$env:ADMIN_PASSWORD="change-me-now"
$env:SESSION_SECRET="replace-with-a-long-random-string"
npm run deploy:cloudflare
```

这个脚本会自动完成：

1. 生成 Worker 配置
2. 创建 D1 数据库并绑定到 Worker
3. 执行 D1 migration
4. 部署 Worker
5. 用部署后的 Worker URL 构建前端
6. 创建 Pages 项目
7. 部署 Pages 静态资源

## 本地开发

### Worker

1. 复制本地变量模板

```powershell
Copy-Item apps/worker/.dev.vars.example apps/worker/.dev.vars
```

2. 初始化本地 D1

```bash
npm run migrate:local --workspace @model-status/worker
```

3. 启动 Worker

```bash
npm run dev:worker
```

### Web

另开一个终端运行：

```bash
npm run dev:web
```

Vite 已经内置把 `/api` 代理到本地 Worker，所以前端开发时不需要手动处理跨域。

## 管理后台使用方式

1. 打开 `/admin`
2. 使用 `ADMIN_USERNAME` 和 `ADMIN_PASSWORD` 登录
3. 配置一个或多个 OpenAI 兼容上游
4. 点击 `Sync catalog`
5. 点击 `Run probe`

配置项说明：

- `API base URL` 例如 `https://api.openai.com/v1`
- `Models URL` 通常是 `https://api.openai.com/v1/models`
- `New API key` 只有在新增或轮换 key 时才需要填写

## 已验证命令

```bash
npm run typecheck
npm run build
```

## 说明

- Admin 登录使用 Worker secret，不在 D1 内存储管理员密码
- 上游 API key 会持久化到 D1，便于多上游和后台管理
- 定时任务每分钟触发一次，由 Worker 按 D1 中的配置判断当前是否需要执行 catalog sync 或 probe
