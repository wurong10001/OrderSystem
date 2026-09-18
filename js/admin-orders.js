const orderList = document.querySelector("#order-list");
const message = document.querySelector("#message");
const roleHint = document.querySelector("#role-hint");
const logoutLink = document.querySelector("#logout-link");

const STATUS_LABEL = {
  pending: "待接单",
  accepted: "已接单",
  completed: "已完成",
};

let currentRole = "user";

function showMessage(text, type = "error") {
  message.textContent = text;
  message.className = `message ${type}`;
  message.hidden = false;
  setTimeout(() => { message.hidden = true; }, 3000);
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text == null ? "" : String(text);
  return div.innerHTML;
}

function formatTime(value) {
  if (!value) return "";
  const d = new Date(value);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("zh-CN", { hour12: false });
}

async function fetchMe() {
  const response = await fetch("/api/auth/me");
  if (!response.ok) {
    window.location.href = "/admin";
    return null;
  }
  return response.json();
}

async function fetchOrders() {
  const response = await fetch("/api/orders");
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    if (response.status === 401) {
      window.location.href = "/admin";
      return [];
    }
    throw new Error(result.error || "获取订单失败");
  }
  return response.json();
}

function renderOrders(orders) {
  if (!orders.length) {
    orderList.innerHTML = '<p class="empty">暂无订单</p>';
    return;
  }

  orderList.innerHTML = orders.map((order) => {
    const items = Array.isArray(order.items) ? order.items : [];
    const itemsText = items.length
      ? items.map((i) => `${escapeHtml(i.name)} x${Number(i.quantity)}`).join("、")
      : "（无明细）";
    const statusClass = order.status === "accepted" || order.status === "completed" ? order.status : "";
    const canAccept = order.status === "pending";

    return `
      <div class="order-card" data-id="${order.id}">
        <div class="order-head">
          <span class="order-id">订单 #${order.id}</span>
          <span class="order-status ${statusClass}">${escapeHtml(STATUS_LABEL[order.status] || order.status || "未知")}</span>
        </div>
        <div class="order-meta">
          ${order.customer_name ? `顾客：${escapeHtml(order.customer_name)}　` : ""}
          下单时间：${formatTime(order.created_at)}
        </div>
        <div class="order-items">${itemsText}</div>
        <div class="order-total">合计 ¥${Number(order.total_amount || 0).toFixed(2)}</div>
        ${canAccept ? `
          <div class="order-actions">
            <button class="btn-accept" data-id="${order.id}">接单</button>
          </div>
        ` : ""}
      </div>
    `;
  }).join("");
}

async function acceptOrder(orderId) {
  try {
    const response = await fetch(`/api/orders/${orderId}/accept`, { method: "PATCH" });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "接单失败");
    showMessage("接单成功", "success");
    const orders = await fetchOrders();
    renderOrders(orders);
  } catch (error) {
    showMessage(error.message);
  }
}

async function logout() {
  await fetch("/api/auth/logout", { method: "POST" });
  window.location.href = "/admin";
}

async function init() {
  const me = await fetchMe();
  if (!me) return;
  currentRole = me.role || "user";
  roleHint.textContent = currentRole === "admin"
    ? "当前身份：管理员（可查看全部订单）"
    : currentRole === "delivery"
      ? "当前身份：外卖员（仅显示自己接的单）"
      : `当前身份：${me.username}`;

  try {
    const orders = await fetchOrders();
    renderOrders(orders);
  } catch (error) {
    orderList.innerHTML = `<p class="empty" style="color:#e74c3c;">${escapeHtml(error.message)}</p>`;
  }
}

orderList.addEventListener("click", (event) => {
  const btn = event.target.closest(".btn-accept");
  if (btn) acceptOrder(btn.dataset.id);
});

logoutLink.addEventListener("click", (event) => {
  event.preventDefault();
  logout();
});

init();
