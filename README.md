# Model Status worker

[![Deploy to Cloudflare](https://deploy.workers.cloudflare.com/button)](https://deploy.workers.cloudflare.com/?url=https://github.com/essesoul/model-status-worker)

基于 Cloudflare Worker + D1 的模型状态面板，前端、API 和定时任务都运行在同一个 Worker 中。

## 本地开发

```bash
npm install
npm run migrate:local
npm run dev
```

首次执行 `npm run dev` 时，如果本地没有 `.dev.vars`，会自动根据 `.dev.vars.example` 创建，并使用默认密码 `admin123`。

启动后访问：

- `http://127.0.0.1:8787/`
- `http://127.0.0.1:8787/admin`

默认后台账号：

- 用户名：`admin`
- 密码：`admin123`

## 部署到 Cloudflare

可直接点击上方 `Deploy to Cloudflare`，或者使用下面的方式手动部署。

先准备环境变量：

必填：

- `CLOUDFLARE_ACCOUNT_ID`
- `ADMIN_PASSWORD`
- `SESSION_SECRET`

可选：

- `CF_PROJECT_NAME`
- `CF_WORKER_NAME`
- `CF_D1_NAME`
- `ADMIN_USERNAME`
- `APP_ORIGIN`
- `EXTRA_ALLOWED_ORIGINS`

```bash
npx wrangler login
npm install
npm run deploy:cloudflare
```

部署脚本会自动构建前端、创建并绑定 D1、执行 migration，并发布 Worker。

## 常用命令

```bash
npm run dev
npm run migrate:local
npm run build
npm run typecheck
```

## 参考项目

- [WizisCool/model-status](https://github.com/WizisCool/model-status)
