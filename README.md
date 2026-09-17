# OrderSystem

这是一个基于 Cloudflare Workers Workflows 的订单处理模板。Workflow 会依次校验订单、预留订单、等待下游系统稳定并发送确认通知；每个步骤都能持久化状态，并可配置自动重试。

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

## 部署

```bash
npm run deploy
```

将 `src/workflow.js` 中的示例步骤替换为真实的支付、库存和通知服务调用。生产环境中建议通过 Wrangler secrets 配置 API 凭据，不要把密钥写入代码或 `wrangler.jsonc`。