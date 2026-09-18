import { WorkflowEntrypoint } from "cloudflare:workers";

export class OrderWorkflow extends WorkflowEntrypoint {
  async run(event, step) {
    const order = await step.do("validate order", async () => {
      const { orderId, customerEmail, amount } = event.payload;

      if (!orderId || !customerEmail || !Number.isFinite(amount) || amount <= 0) {
        throw new Error("orderId, customerEmail and a positive amount are required");
      }

      return { orderId, customerEmail, amount };
    });

    await step.do(
      "reserve order",
      { retries: { limit: 3, delay: "5 seconds", backoff: "exponential" } },
      async () => {
        // Replace this example with a call to your payment or inventory service.
        return { orderId: order.orderId, reserved: true };
      },
    );

    await step.sleep("allow downstream systems to settle", "5 seconds");

    await step.do(
      "send confirmation",
      { retries: { limit: 3, delay: "10 seconds", backoff: "exponential" } },
      async () => {
        // Replace this example with your email or notification provider.
        return { recipient: order.customerEmail, sent: true };
      },
    );

    return {
      orderId: order.orderId,
      status: "completed",
      processedAt: new Date().toISOString(),
    };
  }
}
