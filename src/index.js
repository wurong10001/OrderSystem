import { OrderWorkflow } from "./workflow";

export { OrderWorkflow };

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (request.method === "GET" && url.pathname === "/") {
      return new Response("Hello World");
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
