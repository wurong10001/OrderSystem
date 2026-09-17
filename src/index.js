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
