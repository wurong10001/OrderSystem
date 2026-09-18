const userList = document.querySelector("#user-list");
const message = document.querySelector("#message");
const logoutLink = document.querySelector("#logout-link");

const ROLES = [
  { value: "user", label: "用户" },
  { value: "delivery", label: "外卖员" },
  { value: "admin", label: "管理员" }
];

let currentUser = null;

function showMessage(text, type = "error") {
  message.textContent = text;
  message.className = `message ${type}`;
  message.hidden = false;
  setTimeout(() => { message.hidden = true; }, 3000);
}

async function fetchCurrentUser() {
  try {
    const response = await fetch("/api/auth/me");
    if (!response.ok) throw new Error("未登录");
    const user = await response.json();
    return user.username;
  } catch (e) {
    window.location.href = "/admin";
    return null;
  }
}

async function fetchUsers() {
  try {
    const response = await fetch("/api/admin/users");
    if (!response.ok) {
      if (response.status === 401) {
        window.location.href = "/admin";
        return;
      }
      throw new Error("获取用户列表失败");
    }
    return await response.json();
  } catch (error) {
    userList.innerHTML = `<p style="color: #e74c3c; text-align: center;">${error.message}</p>`;
    return [];
  }
}

function getRoleLabel(role) {
  const found = ROLES.find(r => r.value === role);
  return found ? found.label : "用户";
}

function renderUsers(users) {
  if (!users.length) {
    userList.innerHTML = "<p style='text-align: center; color: #999;'>暂无用户</p>";
    return;
  }
  
  userList.innerHTML = users.map(user => {
    const isCurrentUser = user.username === currentUser;
    return `
      <div class="user-item" data-id="${user.id}">
        <div class="user-info">
          <span class="user-name">
            ${escapeHtml(user.username)}
            ${isCurrentUser ? '<span class="current-user-badge">当前用户</span>' : ''}
          </span>
          <span class="user-role-label">当前角色: ${getRoleLabel(user.role)}</span>
        </div>
        <select class="role-select" data-id="${user.id}" ${isCurrentUser ? 'disabled' : ''}>
          ${ROLES.map(r => `<option value="${r.value}" ${user.role === r.value ? 'selected' : ''}>${r.label}</option>`).join("")}
        </select>
      </div>
    `;
  }).join("");
}

function escapeHtml(text) {
  const div = document.createElement("div");
  div.textContent = text;
  return div.innerHTML;
}

async function updateRole(userId, role) {
  try {
    const response = await fetch(`/api/admin/users/${userId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ role })
    });
    
    if (!response.ok) {
      const result = await response.json().catch(() => ({}));
      throw new Error(result.error || "更新失败");
    }
    
    showMessage("权限已更新", "success");
    // Refresh list
    const users = await fetchUsers();
    renderUsers(users);
  } catch (error) {
    showMessage(error.message);
    // Revert select
    const select = document.querySelector(`.role-select[data-id="${userId}"]`);
    if (select) {
      const users = await fetchUsers();
      const user = users.find(u => u.id === userId);
      if (user) select.value = user.role;
    }
  }
}

async function logout() {
  await fetch("/api/admin/logout", { method: "POST" });
  window.location.href = "/admin";
}

async function init() {
  currentUser = await fetchCurrentUser();
  if (!currentUser) return;
  
  const users = await fetchUsers();
  renderUsers(users);
}

userList.addEventListener("change", async (e) => {
  if (e.target.classList.contains("role-select")) {
    const userId = e.target.dataset.id;
    const role = e.target.value;
    await updateRole(userId, role);
  }
});

logoutLink.addEventListener("click", (e) => {
  e.preventDefault();
  logout();
});

init();
