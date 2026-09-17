# Supabase 用户认证表配置

本文档用于当前项目的用户名/密码认证功能。数据库连接字符串、密码和其他密钥不要写入仓库。

## 1. 创建用户表

在 Supabase 控制台打开 **SQL Editor**，执行：

```sql
create table public.app_users (
  id uuid primary key default gen_random_uuid(),

  username varchar(32) not null,
  username_normalized varchar(32) not null,

  salt char(32) not null,
  password_hash char(64) not null,

  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),

  constraint app_users_username_length
    check (char_length(username) between 3 and 32),

  constraint app_users_username_normalized_length
    check (char_length(username_normalized) between 3 and 32),

  constraint app_users_salt_format
    check (salt ~ '^[0-9a-fA-F]{32}$'),

  constraint app_users_password_hash_format
    check (password_hash ~ '^[0-9a-fA-F]{64}$')
);

create unique index app_users_username_normalized_idx
  on public.app_users (username_normalized);
```

## 2. 字段说明

| 前端字段 | 数据库字段 | 说明 |
| --- | --- | --- |
| `username` | `username` | 用户输入的原始用户名 |
| `username.toLowerCase()` | `username_normalized` | 用于忽略大小写查询和防止重复注册 |
| `salt` | `salt` | 16 字节随机盐，保存为 32 位十六进制字符串 |
| `passwordHash` | `password_hash` | SM3 输出，保存为 64 位十六进制字符串 |

## 3. 注册接口需要保存的数据

当前前端向 `POST /api/auth/register` 提交：

```json
{
  "username": "demo_user",
  "salt": "0123456789abcdef0123456789abcdef",
  "passwordHash": "64位十六进制SM3结果"
}
```

服务端保存：

```text
username            = 用户输入
username_normalized = username.toLowerCase()
salt                = 请求中的 salt
password_hash       = 请求中的 passwordHash
```

注册时应依赖 `username_normalized` 的唯一索引处理重复用户名，而不是只在前端判断。

## 4. 登录接口查询

`GET /api/auth/salt?username=...` 应按规范化用户名查询盐：

```sql
select id, username, salt, password_hash
from public.app_users
where username_normalized = lower($1)
limit 1;
```

登录页面拿到盐后计算：

```text
SM3(salt + ":" + 用户输入的密码)
```

然后向 `POST /api/auth/login` 提交用户名和计算出的 `passwordHash`。服务端必须使用数据库中的 `salt` 和 `password_hash` 完成校验，并在失败时统一返回“用户名或密码错误”，避免暴露用户是否存在。

登录成功后，服务端应通过安全、仅服务端可读取的 Cookie 或其他服务端会话机制建立会话；不要把数据库密码或 `password_hash` 返回给浏览器。

## 5. RLS 和密钥安全

启用 RLS：

```sql
alter table public.app_users enable row level security;
```

不要创建允许匿名客户端直接读取、插入、更新或删除 `app_users` 的 RLS policy。认证查询和写入应由 Worker 后端通过数据库连接完成，Supabase 数据库连接字符串只能配置在服务端 Secret 中，不能放进 HTML 或浏览器 JavaScript。

## 6. 安全注意事项

- SM3 是国密哈希算法，不是可逆加密算法。
- 当前前端协议会提交 `SM3(salt + ":" + password)`，因此必须全程使用 HTTPS。
- 更高安全要求下，建议服务端接收密码后使用服务端生成的盐，并采用适合密码存储的慢速 KDF（例如 Argon2id、scrypt 或 bcrypt）再次处理；不要仅依赖快速哈希。
- 如果数据库连接字符串或密码曾经公开，应立即在 Supabase 控制台轮换凭据，并重新配置 Worker Secret。
