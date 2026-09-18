# OrderSystem

基于 Cloudflare Workers 的在线点单系统，支持菜品管理、购物车、订单处理、多角色权限（管理员/外卖员/用户）。

## 项目结构

```
├── src/                  # 后端代码
│   ├── index.js         # 主入口，路由和 API
│   └── workflow.js      # 订单工作流
├── html/                # 前端页面
│   ├── home.html        # 点单主页
│   ├── ordering.html    # 确认订单页
│   ├── login.html       # 登录页
│   ├── register.html    # 注册页
│   ├── admin-menu.html  # 管理员-菜品管理
│   ├── admin-orders.html # 管理员/外卖员-订单管理
│   └── admin-users.html # 管理员-用户管理
├── css/                 # 样式文件
│   └── auth.css         # 登录/注册页样式
├── js/                  # 前端脚本
│   ├── auth.js          # 登录/注册逻辑
│   ├── admin-menu.js    # 菜品管理逻辑
│   ├── admin-orders.js  # 订单管理逻辑
│   └── admin-users.js   # 用户管理逻辑
├── docs/                # 文档
│   ├── DATABASE_SETUP.md       # 数据库配置
│   ├── ORDER_MENU_SCHEMA.md    # 菜单数据模型
│   └── SUPABASE_AUTH_SCHEMA.md # 认证表结构
├── package.json
└── wrangler.jsonc       # Cloudflare Workers 配置
```

## 本地运行

```bash
npm install
npm run dev
```

创建订单：

```bash
curl -X POST http://localhost:8787/orders \
  -H 'content-type: application/json' \
  -d '{"orderId":"order-001","customerEmail":"user@example.com","amount":99.9}'
```

使用返回的 `instanceId` 查询状态：

```bash
curl 'http://localhost:8787/orders?instanceId=<instanceId>'
```

## 路由说明

| 路径 | 说明 |
|------|------|
| `/` | 点单主页 |
| `/ordering` | 确认订单页 |
| `/admin` | 管理员登录页 |
| `/admin/menu` | 菜品管理（需管理员权限） |
| `/admin/orders` | 订单管理（管理员/外卖员） |
| `/admin/users` | 用户管理（需管理员权限） |
| `/register` | 注册页 |

## 环境变量

| 变量 | 必填 | 说明 |
|------|------|------|
| `DATABASE_URL_DIRECT` | ✅ | PostgreSQL 连接字符串 |
| `ADMIN_SESSION_SECRET` | ❌ | Session 签名密钥，未配置时自动生成（Worker 重启后用户需重新登录） |

## 部署

```bash
npm run deploy
```

生产环境通过 `DATABASE_URL_DIRECT` 直连数据库，连接字符串不要写入代码或提交到 Git。使用 Wrangler Secret 配置：

```bash
printf '%s' 'postgresql://<user>:<password>@<host>:6543/postgres' | npx wrangler secret put DATABASE_URL_DIRECT
```

本地开发时，在 `.dev.vars` 中配置：

```bash
cat > .dev.vars <<'EOF'
DATABASE_URL_DIRECT=postgresql://<user>:<password>@<host>:6543/postgres
EOF
```

## 文档

- [数据库配置](docs/DATABASE_SETUP.md)
- [菜单数据模型](docs/ORDER_MENU_SCHEMA.md)
- [认证表结构](docs/SUPABASE_AUTH_SCHEMA.md)
