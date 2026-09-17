import { OrderWorkflow } from "./workflow";
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

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

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
