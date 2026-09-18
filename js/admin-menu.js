const menuList = document.querySelector("#menu-list");
const modal = document.querySelector("#item-modal");
const itemForm = document.querySelector("#item-form");
const modalTitle = document.querySelector("#modal-title");
const addItemBtn = document.querySelector("#add-item-btn");
const cancelBtn = document.querySelector("#cancel-btn");
const logoutBtn = document.querySelector("#logout-btn");

// Attributes modals
const attrsModal = document.querySelector("#attrs-modal");
const attrsList = document.querySelector("#attrs-list");
const attrsItemName = document.querySelector("#attrs-item-name");
const addAttrBtn = document.querySelector("#add-attr-btn");
const closeAttrsBtn = document.querySelector("#close-attrs-btn");
const addAttrModal = document.querySelector("#add-attr-modal");
const attrForm = document.querySelector("#attr-form");
const cancelAttrBtn = document.querySelector("#cancel-attr-btn");
const addOptionModal = document.querySelector("#add-option-modal");
const optionForm = document.querySelector("#option-form");
const cancelOptionBtn = document.querySelector("#cancel-option-btn");

let editingId = null;
let currentMenuItemId = null;
let currentAttributeId = null;

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
        <div class="menu-item-name">${escapeHtml(item.name)}</div>
        ${item.description ? `<div class="menu-item-desc">${escapeHtml(item.description)}</div>` : ""}
        <div class="menu-item-price">¥${Number(item.price).toFixed(2)}</div>
        <span class="menu-item-status ${item.active ? "active" : "inactive"}">${item.active ? "上架" : "下架"}</span>
      </div>
      <div class="menu-item-actions">
        <button class="btn-attrs" data-id="${item.id}" data-name="${escapeHtml(item.name)}">属性</button>
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
  document.querySelector("#item-image").value = item?.image_url || "";
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

// Attributes functions
async function openAttrsModal(menuItemId, itemName) {
  currentMenuItemId = menuItemId;
  attrsItemName.textContent = itemName;
  attrsModal.hidden = false;
  await loadAttributes();
}

function closeAttrsModal() {
  attrsModal.hidden = true;
  currentMenuItemId = null;
}

async function loadAttributes() {
  const response = await fetch(`/api/admin/menu/attributes?menuItemId=${currentMenuItemId}`);
  if (!response.ok) {
    attrsList.innerHTML = "<p style='color:#e74c3c;'>加载属性失败</p>";
    return;
  }
  const attributes = await response.json();
  
  if (!attributes.length) {
    attrsList.innerHTML = "<p style='color:#999;'>暂无属性，点击「添加属性」开始配置</p>";
    return;
  }
  
  attrsList.innerHTML = attributes.map(attr => `
    <div class="attr-item" data-id="${attr.id}">
      <div class="attr-header">
        <span class="attr-name">${escapeHtml(attr.name)}</span>
        <div>
          ${attr.required ? '<span class="attr-required">必选</span>' : ''}
          <button class="btn-delete" data-attr-id="${attr.id}" style="padding:4px 8px;font-size:12px;">删除</button>
        </div>
      </div>
      <div class="attr-options">
        ${attr.options && attr.options.length ? attr.options.map(opt => `
          <span class="attr-option">
            ${escapeHtml(opt.value)}
            ${opt.priceAdjustment > 0 ? ` +¥${Number(opt.priceAdjustment).toFixed(0)}` : ''}
          </span>
        `).join('') : '<span style="color:#999;font-size:13px;">暂无选项</span>'}
        <button class="btn-edit" data-attr-id="${attr.id}" style="padding:4px 8px;font-size:12px;margin-left:8px;">添加选项</button>
      </div>
    </div>
  `).join("");
}

function openAddAttrModal() {
  addAttrModal.hidden = false;
}

function closeAddAttrModal() {
  addAttrModal.hidden = true;
  attrForm.reset();
}

async function addAttribute(data) {
  const response = await fetch("/api/admin/menu/attributes", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      menuItemId: currentMenuItemId,
      name: data.name,
      required: data.required,
      sortOrder: 0
    }),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || "添加属性失败");
  }
  return response.json();
}

async function deleteAttribute(attrId) {
  if (!confirm("确定要删除这个属性吗？")) return;
  const response = await fetch(`/api/admin/menu/attributes/${attrId}`, { method: "DELETE" });
  if (!response.ok) {
    throw new Error("删除属性失败");
  }
}

function openAddOptionModal(attrId) {
  currentAttributeId = attrId;
  addOptionModal.hidden = false;
}

function closeAddOptionModal() {
  addOptionModal.hidden = true;
  optionForm.reset();
  currentAttributeId = null;
}

async function addOption(data) {
  const response = await fetch("/api/admin/menu/attribute-options", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      attributeId: currentAttributeId,
      value: data.value,
      priceAdjustment: data.priceAdjustment || 0,
      sortOrder: 0
    }),
  });
  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new Error(result.error || "添加选项失败");
  }
  return response.json();
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
    imageUrl: document.querySelector("#item-image").value.trim() || null,
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
  if (event.target.classList.contains("btn-delete") && !event.target.dataset.attrId) {
    const id = event.target.dataset.id;
    try {
      await deleteItem(id);
      const items = await fetchMenu();
      renderMenu(items);
    } catch (error) {
      alert(error.message);
    }
  }
  if (event.target.classList.contains("btn-attrs")) {
    const id = event.target.dataset.id;
    const name = event.target.dataset.name;
    openAttrsModal(id, name);
  }
});

// Attributes event listeners
attrsList.addEventListener("click", async (event) => {
  if (event.target.classList.contains("btn-delete") && event.target.dataset.attrId) {
    const attrId = event.target.dataset.attrId;
    try {
      await deleteAttribute(attrId);
      await loadAttributes();
    } catch (error) {
      alert(error.message);
    }
  }
  if (event.target.classList.contains("btn-edit") && event.target.dataset.attrId) {
    const attrId = event.target.dataset.attrId;
    openAddOptionModal(attrId);
  }
});

addAttrBtn.addEventListener("click", openAddAttrModal);
closeAttrsBtn.addEventListener("click", closeAttrsModal);
cancelAttrBtn.addEventListener("click", closeAddAttrModal);

attrForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = {
    name: document.querySelector("#attr-name").value.trim(),
    required: document.querySelector("#attr-required").checked,
  };
  try {
    await addAttribute(data);
    closeAddAttrModal();
    await loadAttributes();
  } catch (error) {
    alert(error.message);
  }
});

cancelOptionBtn.addEventListener("click", closeAddOptionModal);

optionForm.addEventListener("submit", async (event) => {
  event.preventDefault();
  const data = {
    value: document.querySelector("#option-value").value.trim(),
    priceAdjustment: parseFloat(document.querySelector("#option-price").value) || 0,
  };
  try {
    await addOption(data);
    closeAddOptionModal();
    await loadAttributes();
  } catch (error) {
    alert(error.message);
  }
});

addItemBtn.addEventListener("click", () => openModal());
cancelBtn.addEventListener("click", closeModal);
logoutBtn.addEventListener("click", logout);

init();
