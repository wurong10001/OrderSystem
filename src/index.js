import { OrderWorkflow } from "./workflow";
import postgres from "postgres";
import loginHtml from "../html/login.html";
import registerHtml from "../html/register.html";
import authCss from "../css/auth.css";
import authJs from "../js/auth.js";

export { OrderWorkflow };

function assetResponse(content, contentType) {
  return new Response(content, {
    headers: { "Content-Type": `${contentType}; charset=UTF-8` },
  });
}

function database(env) {
  const connectionString = env.DATABASE_URL?.connectionString;
  if (!connectionString) {
    throw new Error("DATABASE_URL Hyperdrive binding is not configured");
  }
  return postgres(connectionString, { prepare: false, max: 1 });
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
    /^[\p{L}\p{N}_-]{3,32}$/u.test(body.username) &&
    /^[0-9a-f]{32}$/i.test(body.salt) &&
    /^[0-9a-f]{64}$/i.test(body.passwordHash);
}

function parseCookies(request) {
  return Object.fromEntries((request.headers.get("Cookie") || "").split(";").filter(Boolean).map((part) => {
    const index = part.indexOf("=");
    return [part.slice(0, index).trim(), decodeURIComponent(part.slice(index + 1).trim())];
  }));
}

function base64Url(value) {
  return btoa(String.fromCharCode(...new Uint8Array(value))).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

async function signSession(payload, secret) {
  const payloadBytes = new TextEncoder().encode(JSON.stringify(payload));
  const encoded = base64Url(payloadBytes);
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["sign", "verify"]);
  const signature = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(encoded));
  return `${encoded}.${base64Url(signature)}`;
}

async function validSession(request, env) {
  const token = parseCookies(request).ordersystem_admin;
  const secret = env.ADMIN_SESSION_SECRET;
  if (!token || !secret) return false;
  const [encoded, signature] = token.split(".");
  if (!encoded || !signature) return false;
  const key = await crypto.subtle.importKey("raw", new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" }, false, ["verify"]);
  const expected = Uint8Array.from(atob(signature.replace(/-/g, "+").replace(/_/g, "/") + "=="), (char) => char.charCodeAt(0));
  const valid = await crypto.subtle.verify("HMAC", key, expected, new TextEncoder().encode(encoded));
  if (!valid) return false;
  const payload = JSON.parse(new TextDecoder().decode(Uint8Array.from(
    atob(encoded.replace(/-/g, "+").replace(/_/g, "/") + "=="), (char) => char.charCodeAt(0),
  )));
  return payload.exp > Date.now() && typeof payload.username === "string";
}

function adminCookie(token, maxAge = 86400) {
  return `ordersystem_admin=${encodeURIComponent(token)}; Max-Age=${maxAge}; Path=/; HttpOnly; Secure; SameSite=Strict`;
}

async function menuPage(env) {
  const sql = database(env);
  try {
    const [settings] = await sql`select store_name from public.store_settings where id = 1`;
    const items = await sql`
      select id, name, description, price
      from public.menu_items
      where active = true
      order by sort_order, id
    `;
    const lines = [`${settings?.store_name || "点单菜单"}`, "====================", ""];
    if (!items.length) lines.push("暂无在售菜品");
    for (const item of items) {
      lines.push(`${item.id}. ${item.name}  ¥${Number(item.price).toFixed(2)}`);
      if (item.description) lines.push(`   ${item.description}`);
    }
    lines.push("", "提交订单：POST /api/orders");
    return new Response(lines.join("\n"), { headers: { "Content-Type": "text/plain; charset=UTF-8" } });
  } finally {
    await sql.end({ timeout: 1 });
  }
}

async function adminRequest(request, env, pathname) {
  const sql = database(env);
  try {
    if (pathname === "/api/admin/login" && request.method === "POST") {
      const body = await jsonBody(request);
      const [settings] = await sql`
        select admin_username, admin_password_hash
        from public.store_settings where id = 1
      `;
      if (!settings || body?.username !== settings.admin_username ||
          body?.passwordHash?.toLowerCase() !== settings.admin_password_hash.toLowerCase()) {
        return Response.json({ error: "用户名或密码错误。" }, { status: 401 });
      }
      if (!env.ADMIN_SESSION_SECRET) {
        return Response.json({ error: "ADMIN_SESSION_SECRET 未配置。" }, { status: 503 });
      }
      const token = await signSession({ username: settings.admin_username, exp: Date.now() + 86400000 }, env.ADMIN_SESSION_SECRET);
      return new Response(JSON.stringify({ ok: true }), {
        status: 200, headers: { "Content-Type": "application/json", "Set-Cookie": adminCookie(token) },
      });
    }

    if (pathname === "/api/admin/logout" && request.method === "POST") {
      return new Response(JSON.stringify({ ok: true }), {
        headers: { "Content-Type": "application/json", "Set-Cookie": adminCookie("", 0) },
      });
    }

    if (!await validSession(request, env)) {
      return Response.json({ error: "需要管理员登录。" }, { status: 401 });
    }

    if (pathname === "/api/admin/settings" && request.method === "PUT") {
      const body = await jsonBody(request);
      if (!body || typeof body.storeName !== "string" || typeof body.adminUsername !== "string" ||
          !body.storeName.trim() || !/^[\p{L}\p{N}_-]{3,32}$/u.test(body.adminUsername)) {
        return Response.json({ error: "店名或管理员用户名无效。" }, { status: 400 });
      }
      await sql`
        update public.store_settings
        set store_name = ${body.storeName.trim()}, admin_username = ${body.adminUsername.trim()}, updated_at = now()
        where id = 1
      `;
      return Response.json({ ok: true });
    }

    if (pathname === "/api/admin/menu" && request.method === "GET") {
      return Response.json(await sql`select * from public.menu_items order by sort_order, id`);
    }

    if (pathname === "/api/admin/menu" && request.method === "POST") {
      const body = await jsonBody(request);
      if (!body || typeof body.name !== "string" || !Number.isFinite(Number(body.price)) || Number(body.price) < 0) {
        return Response.json({ error: "菜品名称和价格无效。" }, { status: 400 });
      }
      const [item] = await sql`
        insert into public.menu_items (name, description, price, sort_order, active)
        values (${body.name.trim()}, ${body.description || null}, ${Number(body.price)}, ${Number(body.sortOrder) || 0}, ${body.active !== false})
        returning *
      `;
      return Response.json(item, { status: 201 });
    }

    const itemMatch = pathname.match(/^\/api\/admin\/menu\/(\d+)$/);
    if (itemMatch && request.method === "PATCH") {
      const body = await jsonBody(request);
      const [item] = await sql`
        update public.menu_items
        set name = coalesce(${body?.name?.trim() || null}, name),
            description = coalesce(${body?.description ?? null}, description),
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
        insert into public.orders (customer_name, total_amount) values (${body.customerName || null}, ${total}) returning id
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
      if (!username || !/^[\p{L}\p{N}_-]{3,32}$/u.test(username)) {
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
        select password_hash
        from public.app_users
        where username_normalized = ${body.username.trim().toLowerCase()}
        limit 1
      `;
      if (!user || user.password_hash.toLowerCase() !== body.passwordHash.toLowerCase()) {
        return Response.json({ error: "用户名或密码错误。" }, { status: 401 });
      }
      return Response.json({ ok: true });
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
      if (url.pathname.startsWith("/api/admin/")) {
        try {
          return await adminRequest(request, env, url.pathname);
        } catch (error) {
          console.error("Admin request failed", error);
          return Response.json({ error: "服务暂时不可用，请稍后重试。" }, { status: 503 });
        }
      }
      if (request.method === "GET" && url.pathname === "/menu") {
        try {
          return await menuPage(env);
        } catch (error) {
          console.error("Menu request failed", error);
          return Response.json({ error: "菜单暂时不可用，请稍后重试。" }, { status: 503 });
        }
      }
      if (request.method === "POST" && url.pathname === "/api/orders") {
        try {
          return await createOrder(request, env);
        } catch (error) {
          console.error("Order request failed", error);
          return Response.json({ error: "订单暂时无法提交，请稍后重试。" }, { status: 503 });
        }
      }
    }

    if (request.method === "GET" && url.pathname === "/") {
      return assetResponse(loginHtml, "text/html");
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
