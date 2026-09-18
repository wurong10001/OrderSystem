import { OrderWorkflow } from "./workflow";
import postgres from "postgres";
import homeHtml from "../html/home.html";
import loginHtml from "../html/login.html";
import registerHtml from "../html/register.html";
import adminMenuHtml from "../html/admin-menu.html";
import orderingHtml from "../html/ordering.html";
import adminUsersHtml from "../html/admin-users.html";
import adminOrdersHtml from "../html/admin-orders.html";
import authCss from "../css/auth.css";
import authJs from "../js/auth.js";
import adminMenuJs from "../js/admin-menu.js";
import adminUsersJs from "../js/admin-users.js";
import adminOrdersJs from "../js/admin-orders.js";

export { OrderWorkflow };

const USERNAME_PATTERN = /^[\p{L}\p{N}_-]{3,32}$/u;
const IDENTIFIER_PATTERN = /^[\p{L}\p{N}_-]{1,64}$/u;
const SESSION_COOKIE = "ordersystem_admin";
const SESSION_MAX_AGE = 86400;

// 运行时生成的 session secret（如果未配置环境变量）
let _runtimeSecret = null;

function generateSecret() {
  const bytes = new Uint8Array(32);
  crypto.getRandomValues(bytes);
  return Array.from(bytes)
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

function getSessionSecret(env) {
  // 优先使用环境变量
  if (env.ADMIN_SESSION_SECRET) {
    return env.ADMIN_SESSION_SECRET;
  }
  // 否则使用运行时生成的（注意：Worker 重启后会失效，所有用户需要重新登录）
  if (!_runtimeSecret) {
    _runtimeSecret = generateSecret();
    console.warn('ADMIN_SESSION_SECRET 未配置，使用运行时生成的临时密钥。Worker 重启后所有用户需要重新登录。');
  }
  return _runtimeSecret;
}

function assetResponse(content, contentType) {
  return new Response(content, {
    headers: { "Content-Type": `${contentType}; charset=UTF-8` },
  });
}

function jsonResponse(body, status = 200, headers = {}) {
  return Response.json(body, { status, headers });
}

function database(env) {
  const connectionString = env.DATABASE_URL || env.DATABASE_URL_DIRECT;
  if (!connectionString) {
    throw new Error("数据库未配置：请设置 DATABASE_URL 环境变量");
  }
  return postgres(connectionString, {
    prepare: false,
    fetch_types: false,
    max: 1,
    idle_timeout: 10,
    connect_timeout: 10,
  });
}

async function jsonBody(request) {
  try {
    return await request.json();
  } catch {
    return null;
  }
}

function validCredentials(body) {
  return body &&
    typeof body.username === "string" &&
    typeof body.salt === "string" &&
    typeof body.passwordHash === "string" &&
    USERNAME_PATTERN.test(body.username) &&
    /^[0-9a-f]{32}$/i.test(body.salt) &&
    /^[0-9a-f]{64}$/i.test(body.passwordHash);
}

function parseCookies(request) {
  return Object.fromEntries((request.headers.get("Cookie") || "")
    .split(";")
    .filter(Boolean)
    .map((part) => {
      const index = part.indexOf("=");
      return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
    }));
}

function base64Url(value) {
  return btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function decodeBase64Url(value) {
  const normalized = value.replace(/-/g, "+").replace(/_/g, "/");
  return atob(normalized + "=".repeat((4 - normalized.length % 4) % 4));
}

async function signSession(payload, secret) {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const encoded = base64Url(payloadBytes);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encoded));
  return `${encoded}.${base64Url(signature)}`;
}

async function readSession(request, env) {
  const token = parseCookies(request)[SESSION_COOKIE];
  const secret = getSessionSecret(env);
  if (!token || !secret) return null;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return null;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const expected = Uint8Array.from(decodeBase64Url(signature), (char) => char.charCodeAt(0));
  const valid = await crypto.subtle.verify("HMAC", key, expected, new TextEncoder().encode(encoded));
  if (!valid) return null;
  let payload;
  try {
    payload = JSON.parse(new TextDecoder().decode(
      Uint8Array.from(decodeBase64Url(encoded), (char) => char.charCodeAt(0)),
    ));
  } catch {
    return null;
  }
  if (!(payload.exp > Date.now()) || typeof payload.username !== "string") return null;
  return payload;
}

async function validSession(request, env) {
  const payload = await readSession(request, env);
  return !!payload && payload.permission === 1;
}

function adminCookie(token, maxAge = SESSION_MAX_AGE) {
  return `${SESSION_COOKIE}=${encodeURIComponent(token)}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

async function adminRequest(request, env, pathname) {
  const sql = database(env);
  try {
    if (pathname === "/api/admin/login" && request.method === "POST") {
      const body = await jsonBody(request);
      const [user] = await sql`
        select username, password_hash, permission
        from public.app_users
        where username_normalized = ${body?.username?.trim().toLowerCase() || ""}
          and permission = 1
        limit 1
      `;
      if (!user || body?.passwordHash?.toLowerCase() !== user.password_hash.toLowerCase()) {
        return Response.json({ error: "用户名或密码错误。" }, { status: 401 });
      }
      const secret = getSessionSecret(env);
      const token = await signSession({ username: user.username, permission: user.permission, exp: Date.now() + SESSION_MAX_AGE * 1000 }, secret);
      return jsonResponse({ ok: true }, 200, { "Set-Cookie": adminCookie(token) });
    }

    if (pathname === "/api/admin/logout" && request.method === "POST") {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json", "Set-Cookie": adminCookie("", 0) },
      });
    }

    if (!await validSession(request, env)) {
      return Response.json({ error: "需要管理员登录。" }, { status: 401 });
    }

    if (pathname === "/api/admin/settings" && request.method === "GET") {
      const [settings] = await sql`select store_name from public.store_settings where id = 1`;
      return Response.json(settings || { store_name: "" });
    }

    if (pathname === "/api/admin/settings" && request.method === "PUT") {
      const body = await jsonBody(request);
      if (!body || typeof body.storeName !== "string" || !body.storeName.trim()) {
        return Response.json({ error: "店名无效。" }, { status: 400 });
      }
      await sql`
        update public.store_settings
        set store_name = ${body.storeName.trim()}, updated_at = now()
        where id = 1
      `;
      return Response.json({ ok: true });
    }

    if (pathname === "/api/admin/menu" && request.method === "GET") {
      return Response.json(await sql`select * from public.menu_items order by sort_order, id`);
    }

    if (pathname === "/api/admin/menu" && request.method === "POST") {
      const body = await jsonBody(request);
      if (!body || typeof body.name !== "string" || !body.name.trim() ||
          typeof body.itemCode !== "string" || !IDENTIFIER_PATTERN.test(body.itemCode.trim()) ||
          !Number.isFinite(Number(body.price)) || Number(body.price) < 0 ||
          !Array.isArray(body.flavors) || body.flavors.some((flavor) => typeof flavor !== "string" || !flavor.trim())) {
        return Response.json({ error: "专属 ID、菜品名称、价格或口味选项无效。" }, { status: 400 });
      }
      try {
        const [item] = await sql`
          insert into public.menu_items (item_code, name, description, flavors, price, sort_order, active)
          values (${body.itemCode.trim()}, ${body.name.trim()}, ${body.description?.trim() || null},
            ${body.flavors.map((flavor) => flavor.trim())}, ${Number(body.price)},
            ${Number(body.sortOrder) || 0}, ${body.active !== false})
          returning *
        `;
        return Response.json(item, { status: 201 });
      } catch (error) {
        if (error?.code === "23505") return Response.json({ error: "专属 ID 已存在。" }, { status: 409 });
        throw error;
      }
    }

    const itemMatch = pathname.match(/^\/api\/admin\/menu\/(\d+)$/);
    if (itemMatch && request.method === "PATCH") {
      const body = await jsonBody(request);
      if (body?.itemCode !== undefined &&
          (typeof body.itemCode !== "string" || !IDENTIFIER_PATTERN.test(body.itemCode.trim()))) {
        return Response.json({ error: "专属 ID 无效。" }, { status: 400 });
      }
      const [item] = await sql`
        update public.menu_items
        set item_code = coalesce(${body?.itemCode?.trim() || null}, item_code),
            name = coalesce(${body?.name?.trim() || null}, name),
            description = coalesce(${body?.description ?? null}, description),
            flavors = coalesce(${Array.isArray(body?.flavors) ? body.flavors.map((flavor) => String(flavor).trim()).filter(Boolean) : null}, flavors),
            price = coalesce(${Number.isFinite(Number(body?.price)) ? Number(body.price) : null}, price),
            sort_order = coalesce(${Number.isFinite(Number(body?.sortOrder)) ? Number(body.sortOrder) : null}, sort_order),
            active = coalesce(${typeof body?.active === "boolean" ? body.active : null}, active),
            updated_at = now()
        where id = ${Number(itemMatch[1])}
        returning *
      `;
      return item ? Response.json(item) : Response.json({ error: "菜品不存在。" }, { status: 404 });
    }

    if (itemMatch && request.method === "DELETE") {
      await sql`delete from public.menu_items where id = ${Number(itemMatch[1])}`;
      return Response.json({ ok: true });
    }

    // Menu item attributes API
    if (pathname === "/api/admin/menu/attributes" && request.method === "GET") {
      const menuItemId = new URL(request.url).searchParams.get("menuItemId");
      if (!menuItemId) {
        return Response.json({ error: "缺少菜品ID" }, { status: 400 });
      }
      const attributes = await sql`
        select a.*, 
          coalesce(
            json_agg(
              json_build_object('id', o.id, 'value', o.value, 'priceAdjustment', o.price_adjustment, 'sortOrder', o.sort_order)
              order by o.sort_order
            ) filter (where o.id is not null), '[]'
          ) as options
        from public.menu_item_attributes a
        left join public.menu_item_attribute_options o on o.attribute_id = a.id
        where a.menu_item_id = ${Number(menuItemId)}
        group by a.id, a.name, a.required, a.sort_order, a.menu_item_id, a.created_at
        order by a.sort_order
      `;
      return Response.json(attributes);
    }

    if (pathname === "/api/admin/menu/attributes" && request.method === "POST") {
      const body = await jsonBody(request);
      if (!body || !body.menuItemId || !body.name?.trim()) {
        return Response.json({ error: "缺少必要参数" }, { status: 400 });
      }
      const [attr] = await sql`
        insert into public.menu_item_attributes (menu_item_id, name, required, sort_order)
        values (${Number(body.menuItemId)}, ${body.name.trim()}, ${body.required || false}, ${Number(body.sortOrder) || 0})
        returning *
      `;
      return Response.json(attr, { status: 201 });
    }

    const attrMatch = pathname.match(/^\/api\/admin\/menu\/attributes\/(\d+)$/);
    if (attrMatch && request.method === "DELETE") {
      await sql`delete from public.menu_item_attributes where id = ${Number(attrMatch[1])}`;
      return Response.json({ ok: true });
    }

    // Menu item attribute options API
    if (pathname === "/api/admin/menu/attribute-options" && request.method === "POST") {
      const body = await jsonBody(request);
      if (!body || !body.attributeId || !body.value?.trim()) {
        return Response.json({ error: "缺少必要参数" }, { status: 400 });
      }
      const [option] = await sql`
        insert into public.menu_item_attribute_options (attribute_id, value, price_adjustment, sort_order)
        values (${Number(body.attributeId)}, ${body.value.trim()}, ${Number(body.priceAdjustment) || 0}, ${Number(body.sortOrder) || 0})
        returning *
      `;
      return Response.json(option, { status: 201 });
    }

    const optionMatch = pathname.match(/^\/api\/admin\/menu\/attribute-options\/(\d+)$/);
    if (optionMatch && request.method === "DELETE") {
      await sql`delete from public.menu_item_attribute_options where id = ${Number(optionMatch[1])}`;
      return Response.json({ ok: true });
    }

    // User management APIs
    if (pathname === "/api/admin/users" && request.method === "GET") {
      const users = await sql`
        select id, username, role, permission
        from public.app_users
        order by created_at desc
      `;
      return Response.json(users);
    }

    const userMatch = pathname.match(/^\/api\/admin\/users\/([a-f0-9-]+)$/);
    if (userMatch && request.method === "PATCH") {
      const body = await jsonBody(request);
      const targetUserId = userMatch[1];
      
      // Get current user from session (signature already verified)
      const payload = await readSession(request, env);
      if (!payload) {
        return Response.json({ error: "需要管理员登录。" }, { status: 401 });
      }
      
      // Prevent modifying own permissions
      const [currentUser] = await sql`
        select id from public.app_users where username_normalized = ${payload.username.toLowerCase()}
      `;
      
      if (currentUser && currentUser.id === targetUserId) {
        return Response.json({ error: "不能修改自己的权限" }, { status: 403 });
      }

      // Validate role
      const validRoles = ["user", "delivery", "admin"];
      if (!body || !validRoles.includes(body.role)) {
        return Response.json({ error: "无效的角色" }, { status: 400 });
      }

      const permission = body.role === "admin" ? 1 : 0;
      
      const [user] = await sql`
        update public.app_users
        set role = ${body.role}, permission = ${permission}, updated_at = now()
        where id = ${targetUserId}
        returning id, username, role, permission
      `;
      
      return user ? Response.json(user) : Response.json({ error: "用户不存在" }, { status: 404 });
    }

    return Response.json({ error: "Not found" }, { status: 404 });
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function createOrder(request, env) {
  const body = await jsonBody(request);
  if (!body || !Array.isArray(body.items) || !body.items.length) {
    return Response.json({ error: "订单至少需要一道菜品。" }, { status: 400 });
  }
  const sql = database(env);
  try {
    const ids = body.items.map((item) => Number(item.id)).filter(Number.isInteger);
    const menu = await sql`select id, name, price from public.menu_items where active = true and id = any(${ids})`;
    const byId = new Map(menu.map((item) => [item.id, item]));
    const orderItems = body.items.map((item) => ({ menu: byId.get(Number(item.id)), quantity: Number(item.quantity) }));
    if (orderItems.some((item) => !item.menu || !Number.isInteger(item.quantity) || item.quantity < 1 || item.quantity > 99)) {
      return Response.json({ error: "订单中的菜品或数量无效。" }, { status: 400 });
    }
    const total = orderItems.reduce((sum, item) => sum + Number(item.menu.price) * item.quantity, 0);
    const [order] = await sql.begin(async (tx) => {
      const [created] = await tx`
        insert into public.orders (customer_name, total_amount, status) 
        values (${body.customerName || null}, ${total}, 'pending') 
        returning id
      `;
      for (const item of orderItems) {
        await tx`insert into public.order_items (order_id, menu_item_id, item_name, unit_price, quantity)
          values (${created.id}, ${item.menu.id}, ${item.menu.name}, ${item.menu.price}, ${item.quantity})`;
      }
      return [created];
    });
    return Response.json({ orderId: order.id, total }, { status: 201 });
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function authRequest(request, env, pathname) {
  const sql = database(env);
  try {
    if (pathname === "/api/auth/salt" && request.method === "GET") {
      const username = new URL(request.url).searchParams.get("username")?.trim();
      if (!username || !USERNAME_PATTERN.test(username)) {
        return Response.json({ error: "用户名或密码错误。" }, { status: 400 });
      }

      const [user] = await sql`
        select salt
        from public.app_users
        where username_normalized = ${username.toLowerCase()}
        limit 1
      `;
      if (!user) {
        return Response.json({ error: "用户名或密码错误。" }, { status: 401 });
      }
      return Response.json({ salt: user.salt });
    }

    if (pathname === "/api/auth/register" && request.method === "POST") {
      const body = await jsonBody(request);
      if (!validCredentials(body)) {
        return Response.json({ error: "注册信息无效。" }, { status: 400 });
      }

      try {
        await sql`
          insert into public.app_users
            (username, username_normalized, salt, password_hash)
          values
            (${body.username.trim()}, ${body.username.trim().toLowerCase()},
             ${body.salt.toLowerCase()}, ${body.passwordHash.toLowerCase()})
        `;
      } catch (error) {
        if (error?.code === "23505") {
          return Response.json({ error: "用户名已存在。" }, { status: 409 });
        }
        throw error;
      }
      return Response.json({ ok: true }, { status: 201 });
    }

    if (pathname === "/api/auth/login" && request.method === "POST") {
      const body = await jsonBody(request);
      if (!validCredentials(body)) {
        return Response.json({ error: "用户名或密码错误。" }, { status: 401 });
      }

      const [user] = await sql`
        select id, username, password_hash, role, permission
        from public.app_users
        where username_normalized = ${body.username.trim().toLowerCase()}
        limit 1
      `;
      if (!user || user.password_hash.toLowerCase() !== body.passwordHash.toLowerCase()) {
        return Response.json({ error: "用户名或密码错误。" }, { status: 401 });
      }

      const role = user.role || "user";
      const secret = getSessionSecret(env);
      const token = await signSession({
        userId: user.id,
        username: user.username,
        role,
        permission: user.permission ?? 0,
        exp: Date.now() + SESSION_MAX_AGE * 1000,
      }, secret);

      return jsonResponse({ ok: true, role, username: user.username }, 200, {
        "Set-Cookie": adminCookie(token),
      });
    }

    if (pathname === "/api/auth/me" && request.method === "GET") {
      const payload = await readSession(request, env);
      if (!payload) return Response.json({ error: "未登录。" }, { status: 401 });
      return Response.json({ username: payload.username, role: payload.role || "user", permission: payload.permission ?? 0 });
    }

    if (pathname === "/api/auth/logout" && request.method === "POST") {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json", "Set-Cookie": adminCookie("", 0) },
      });
    }

    return null;
  } finally {
    await sql.end({ timeout: 1 });
  }
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname.startsWith("/api/auth/")) {
      try {
        const response = await authRequest(request, env, url.pathname);
        if (response) return response;
      } catch (error) {
        console.error("Authentication request failed", error);
        return Response.json({ error: "服务暂时不可用，请稍后重试。" }, { status: 503 });
      }
    }

    if (url.pathname.startsWith("/api/admin/")) {
      try {
        return await adminRequest(request, env, url.pathname);
      } catch (error) {
        console.error("Admin request failed", error);
        return Response.json({ error: "服务暂时不可用，请稍后重试。" }, { status: 503 });
      }
    }

    if (request.method === "GET" && url.pathname === "/") {
      return assetResponse(homeHtml, "text/html");
    }

    if (request.method === "GET" && (url.pathname === "/menu" || url.pathname === "/ordering")) {
      return assetResponse(orderingHtml, "text/html");
    }

    if (request.method === "POST" && url.pathname === "/api/orders") {
      try {
        return await createOrder(request, env);
      } catch (error) {
        console.error("Order request failed", error);
        return Response.json({ error: "订单暂时无法提交，请稍后重试。" }, { status: 503 });
      }
    }

    if (request.method === "GET" && url.pathname === "/admin") {
      return assetResponse(loginHtml, "text/html");
    }

    if (request.method === "GET" && url.pathname === "/admin/menu") {
      if (!await validSession(request, env)) return Response.redirect(new URL("/admin", request.url), 302);
      return assetResponse(adminMenuHtml, "text/html");
    }

    if (request.method === "GET" && url.pathname === "/admin/users") {
      if (!await validSession(request, env)) return Response.redirect(new URL("/admin", request.url), 302);
      return assetResponse(adminUsersHtml, "text/html");
    }

    // Orders page: accessible to admin and delivery roles
    if (request.method === "GET" && url.pathname === "/admin/orders") {
      const session = await readSession(request, env);
      if (!session || (session.permission !== 1 && session.role !== "delivery")) {
        return Response.redirect(new URL("/admin", request.url), 302);
      }
      return assetResponse(adminOrdersHtml, "text/html");
    }

    if (request.method === "GET" && url.pathname === "/register") {
      return assetResponse(registerHtml, "text/html");
    }

    if (request.method === "GET" && url.pathname === "/css/auth.css") {
      return assetResponse(authCss, "text/css");
    }

    if (request.method === "GET" && url.pathname === "/js/auth.js") {
      return assetResponse(authJs, "text/javascript");
    }

    if (request.method === "GET" && url.pathname === "/js/admin-menu.js") {
      return assetResponse(adminMenuJs, "text/javascript");
    }

    if (request.method === "GET" && url.pathname === "/js/admin-users.js") {
      return assetResponse(adminUsersJs, "text/javascript");
    }

    if (request.method === "GET" && url.pathname === "/js/admin-orders.js") {
      return assetResponse(adminOrdersJs, "text/javascript");
    }

    if (request.method === "GET" && url.pathname === "/ordering") {
      return assetResponse(orderingHtml, "text/html");
    }

    if (request.method === "GET" && url.pathname === "/api/menu/items") {
      try {
        const sql = database(env);
        const items = await sql`
          select id, name, description, price, image_url, sort_order
          from public.menu_items
          where active = true
          order by sort_order, id
        `;
        
        // Fetch attributes for all items
        const itemIds = items.map(i => i.id);
        const attributes = itemIds.length > 0 ? await sql`
          select a.id, a.menu_item_id, a.name, a.required, a.sort_order,
            coalesce(
              json_agg(
                json_build_object('id', o.id, 'value', o.value, 'priceAdjustment', o.price_adjustment, 'sortOrder', o.sort_order)
                order by o.sort_order
              ) filter (where o.id is not null), '[]'
            ) as options
          from public.menu_item_attributes a
          left join public.menu_item_attribute_options o on o.attribute_id = a.id
          where a.menu_item_id = any(${itemIds})
          group by a.id, a.menu_item_id, a.name, a.required, a.sort_order
          order by a.sort_order
        ` : [];
        
        await sql.end({ timeout: 1 });
        
        // Group attributes by menu_item_id
        const attrsByItem = {};
        for (const attr of attributes) {
          if (!attrsByItem[attr.menu_item_id]) attrsByItem[attr.menu_item_id] = [];
          attrsByItem[attr.menu_item_id].push({
            id: attr.id,
            name: attr.name,
            required: attr.required,
            options: attr.options
          });
        }
        
        const result = items.map(item => ({
          ...item,
          attributes: attrsByItem[item.id] || []
        }));
        
        return Response.json(result);
      } catch (error) {
        console.error("Menu items fetch failed", error);
        return Response.json({ error: "菜单暂时不可用" }, { status: 503 });
      }
    }

    if (request.method === "GET" && url.pathname === "/api/store/settings") {
      try {
        const sql = database(env);
        const [settings] = await sql`select store_name from public.store_settings where id = 1`;
        await sql.end({ timeout: 1 });
        return Response.json(settings || { store_name: "点单菜单" });
      } catch (error) {
        return Response.json({ store_name: "点单菜单" });
      }
    }

    if (url.pathname === "/api/orders" && request.method === "GET") {
      try {
        const sql = database(env);
        const session = await readSession(request, env);

        const isAdmin = !!session && session.permission === 1;
        const isDelivery = !!session && session.role === "delivery";
        const userId = session?.userId || null;

        if (!session || (!isAdmin && !isDelivery)) {
          await sql.end({ timeout: 1 });
          return Response.json({ error: "需要登录，且角色为管理员或外卖员。" }, { status: 401 });
        }

        let orders;
        if (isAdmin) {
          // Admin sees all orders
          orders = await sql`
            select o.*, 
              (select json_agg(json_build_object('name', oi.item_name, 'price', oi.unit_price, 'quantity', oi.quantity))
               from public.order_items oi where oi.order_id = o.id) as items
            from public.orders o
            order by o.created_at desc
            limit 100
          `;
        } else {
          // Delivery person sees only their assigned orders
          orders = await sql`
            select o.*,
              (select json_agg(json_build_object('name', oi.item_name, 'price', oi.unit_price, 'quantity', oi.quantity))
               from public.order_items oi where oi.order_id = o.id) as items
            from public.orders o
            where o.delivery_user_id = ${userId}
            order by o.created_at desc
            limit 100
          `;
        }
        
        await sql.end({ timeout: 1 });
        return Response.json(orders);
      } catch (error) {
        console.error("Orders fetch failed", error);
        return Response.json({ error: "获取订单失败" }, { status: 503 });
      }
    }

    if (url.pathname.match(/^\/api\/orders\/(\d+)\/accept$/) && request.method === "PATCH") {
      try {
        const sql = database(env);
        const session = await readSession(request, env);

        if (!session) {
          await sql.end({ timeout: 1 });
          return Response.json({ error: "需要登录" }, { status: 401 });
        }

        const isDelivery = session.role === "delivery";
        const isAdmin = session.permission === 1;
        if (!isDelivery && !isAdmin) {
          await sql.end({ timeout: 1 });
          return Response.json({ error: "只有外卖员可以接单。" }, { status: 403 });
        }

        const orderId = Number(url.pathname.match(/^\/api\/orders\/(\d+)\/accept$/)[1]);
        const userId = session.userId;

        const [order] = await sql`
          update public.orders
          set delivery_user_id = ${userId}, status = 'accepted', updated_at = now()
          where id = ${orderId} and (delivery_user_id is null or delivery_user_id = ${userId})
          returning *
        `;

        await sql.end({ timeout: 1 });
        
        if (!order) {
          return Response.json({ error: "订单不存在或已被接单" }, { status: 404 });
        }
        
        return Response.json(order);
      } catch (error) {
        console.error("Order accept failed", error);
        return Response.json({ error: "接单失败" }, { status: 503 });
      }
    }

    if (request.method === "POST" && url.pathname === "/orders") {
      let payload;

      try {
        payload = await request.json();
      } catch {
        return Response.json({ error: "Request body must be valid JSON" }, { status: 400 });
      }

      const instance = await env.ORDER_WORKFLOW.create({ params: payload });
      return Response.json({ instanceId: instance.id }, { status: 202 });
    }

    if (request.method === "GET" && url.pathname === "/orders") {
      const instanceId = url.searchParams.get("instanceId");
      if (!instanceId) {
        return Response.json({ error: "instanceId is required" }, { status: 400 });
      }

      const instance = await env.ORDER_WORKFLOW.get(instanceId);
      return Response.json(await instance.status());
    }

    return Response.json(
      {
        error: "Not found",
        usage: {
          start: "POST /orders",
          status: "GET /orders?instanceId=<id>",
        },
      },
      { status: 404 },
    );
  },
};
