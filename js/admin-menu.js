const menuList = document.querySelector("#menu-list");
const modal = document.querySelector("#item-modal");
const itemForm = document.querySelector("#item-form");
const modalTitle = document.querySelector("#modal-title");
const addItemBtn = document.querySelector("#add-item-btn");
const cancelBtn = document.querySelector("#cancel-btn");
const logoutBtn = document.querySelector("#logout-btn");

let editingId = null;

async function fetchMenu() {
  const response = await fetch("/api/admin/menu");
  if (!response.ok) {
    if (response.status === 401) {
      window.location.href = "/admin";
      return;
    }
    throw new Error("获取菜单失败");
  }
  return response.json();
}

function renderMenu(items) {
  if (!items.length) {
    menuList.innerHTML = "<p class=\"empty\">暂无菜品</p>";
    return;
  }
  menuList.innerHTML = items.map(item => `
    <div class="menu-item" data-id="${item.id}">
      <div class="menu-item-info">
        <strong>${escapeHtml(item.name)}</strong>
        <span class="price">¥${Number(item.price).toFixed(2)}</span>
        ${item.description ? `<p class="desc">${escapeHtml(item.description)}</p>` : ""}
        <span class="status ${item.active ? "active" : "inactive"}">${item.active ? "上架" : "下架"}</span>
      </div>
      <div class="menu-item-actions">
        <button class="btn-edit" data-id="${item.id}">编辑</button>
        <button class="btn-delete" data-id="${item.id}">删除</button>
      </div>
    </div>
  `).join("");
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

function openModal(item = null) {
  editingId = item?.id || null;
  modalTitle.textContent = item ? "编辑菜品" : "添加菜品";
  document.querySelector("#item-name").value = item?.name || "";
  document.querySelector("#item-description").value = item?.description || "";
  document.querySelector("#item-price").value = item?.price || "";
  document.querySelector("#item-sort").value = item?.sort_order || 0;
  document.querySelector("#item-active").checked = item?.active !== false;
  modal.hidden = false;
}

function closeModal() {
  modal.hidden = true;
  itemForm.reset();
  editingId = null;
}

async function saveItem(data) {
  const url = editingId ? `/api/admin/menu/${editingId}` : "/api/admin/menu";
  const method = editingId ? "PATCH" : "POST";
  const response = await fetch(url, {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(data),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || "保存失败");
  }
  return response.json();
}

async function deleteItem(id) {
  if (!confirm("确定要删除这个菜品吗？")) return;
  const response = await fetch(`/api/admin/menu/${id}`, { method: "DELETE" });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || "删除失败");
  }
}

async function logout() {
  await fetch("/api/admin/logout", { method: "POST" });
  window.location.href = "/admin";
}

async function init() {
  try {
    const items = await fetchMenu();
    renderMenu(items);
  } catch (error) {
    menuList.innerHTML = `<p class="error">${error.message}</p>`;
  }
}

itemForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = {
    name: document.querySelector("#item-name").value.trim(),
    description: document.querySelector("#item-description").value.trim() || null,
    price: parseFloat(document.querySelector("#item-price").value),
    sortOrder: parseInt(document.querySelector("#item-sort").value) || 0,
    active: document.querySelector("#item-active").checked,
  };
  try {
    await saveItem(data);
    closeModal();
    const items = await fetchMenu();
    renderMenu(items);
  } catch (error) {
    alert(error.message);
  }
});

menuList.addEventListener("click", async (event) => {
  if (event.target.classList.contains("btn-edit")) {
    const id = event.target.dataset.id;
    const items = await fetchMenu();
    const item = items.find(i => i.id == id);
    if (item) openModal(item);
  }
  if (event.target.classList.contains("btn-delete")) {
    const id = event.target.dataset.id;
    try {
      await deleteItem(id);
      const items = await fetchMenu();
      renderMenu(items);
    } catch (error) {
      alert(error.message);
    }
  }
});

addItemBtn.addEventListener("click", () => openModal());
cancelBtn.addEventListener("click", closeModal);
logoutBtn.addEventListener("click", logout);

init();
