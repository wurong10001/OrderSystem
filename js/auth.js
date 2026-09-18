const form = document.querySelector("#auth-form");
const message = document.querySelector("#form-message");
const submitButton = document.querySelector("#submit-button");
const page = document.body.dataset.page;

function setMessage(text, type = "error") {
  message.textContent = text;
  message.className = `form-message ${type}`;
  message.hidden = !text;
}

function createSalt() {
  const bytes = new Uint8Array(16);
  crypto.getRandomValues(bytes);
  return [...bytes].map((byte) => byte.toString(16).padStart(2, "0")).join("");
}

function rotl(value, bits) {
  return ((value << bits) | (value >>> (32 - bits))) >>> 0;
}

function sm3(messageText) {
  const input = new TextEncoder().encode(messageText);
  const bitLength = input.length * 8;
  const paddedLength = (((input.length + 1 + 8 + 63) >> 6) << 6);
  const data = new Uint8Array(paddedLength);
  data.set(input);
  data[input.length] = 0x80;
  const view = new DataView(data.buffer);
  view.setUint32(paddedLength - 8, Math.floor(bitLength / 0x100000000));
  view.setUint32(paddedLength - 4, bitLength >>> 0);

  let [a, b, c, d, e, f, g, h] = [
    0x7380166f, 0x4914b2b9, 0x172442d7, 0xda8a0600,
    0xa96f30bc, 0x163138aa, 0xe38dee4d, 0xb0fb0e4e,
  ];
  const tj = (j) => (j < 16 ? 0x79cc4519 : 0x7a879d8a);
  const ff = (x, y, z, j) => (j < 16 ? x ^ y ^ z : (x & y) | (x & z) | (y & z));
  const gg = (x, y, z, j) => (j < 16 ? x ^ y ^ z : (x & y) | (~x & z));

  for (let offset = 0; offset < paddedLength; offset += 64) {
    const w = new Uint32Array(68);
    const w1 = new Uint32Array(64);
    for (let j = 0; j < 16; j++) w[j] = view.getUint32(offset + j * 4);
    for (let j = 16; j < 68; j++) {
      const x = w[j - 16] ^ w[j - 9] ^ rotl(w[j - 3], 15);
      w[j] = (x ^ rotl(x, 15) ^ rotl(x, 23)) ^ rotl(w[j - 13], 7) ^ w[j - 6];
    }
    for (let j = 0; j < 64; j++) w1[j] = w[j] ^ w[j + 4];

    let [aa, bb, cc, dd, ee, ffv, ggV, hh] = [a, b, c, d, e, f, g, h];
    for (let j = 0; j < 64; j++) {
      const ss1 = rotl((rotl(aa, 12) + ee + rotl(tj(j), j)) >>> 0, 7);
      const ss2 = ss1 ^ rotl(aa, 12);
      const tt1 = (ff(aa, bb, cc, j) + dd + ss2 + w1[j]) >>> 0;
      const tt2 = (gg(ee, ffv, ggV, j) + hh + ss1 + w[j]) >>> 0;
      [dd, cc, bb, aa] = [cc, rotl(bb, 9), aa, tt1];
      [hh, ggV, ffv, ee] = [ggV, rotl(ffv, 19), ee, (tt2 ^ rotl(tt2, 9) ^ rotl(tt2, 17)) >>> 0];
    }
    [a, b, c, d, e, f, g, h] = [
      a ^ aa, b ^ bb, c ^ cc, d ^ dd, e ^ ee, f ^ ffv, g ^ ggV, h ^ hh,
    ];
  }
  return [a, b, c, d, e, f, g, h]
    .map((value) => (value >>> 0).toString(16).padStart(8, "0"))
    .join("");
}

async function submitAuth(event) {
  event.preventDefault();
  setMessage("");
  const data = new FormData(form);
  const username = data.get("username").trim();
  const password = data.get("password");
  const confirmPassword = data.get("confirmPassword");

  if (!/^[\p{L}\p{N}_-]{3,32}$/u.test(username)) {
    setMessage("用户名需为 3-32 个字母、数字、下划线或连字符。");
    return;
  }
  if (password.length < 8) {
    setMessage("密码长度至少为 8 个字符。");
    return;
  }
  if (page === "register" && password !== confirmPassword) {
    setMessage("两次输入的密码不一致。");
    return;
  }

  submitButton.disabled = true;
  submitButton.textContent = page === "register" ? "注册中…" : "登录中…";
  try {
    let salt;
    if (page === "register") {
      salt = createSalt();
    } else {
      const saltResponse = await fetch(`/api/auth/salt?username=${encodeURIComponent(username)}`);
      const saltResult = await saltResponse.json().catch(() => ({}));
      if (!saltResponse.ok || !saltResult.salt) {
        throw new Error(saltResult.error || "用户名或密码错误。");
      }
      salt = saltResult.salt;
    }

    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 10000);

    const response = await fetch(`/api/auth/${page}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ username, salt, passwordHash: sm3(`${salt}:${password}`) }),
      signal: controller.signal,
    });
    clearTimeout(timeoutId);
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || "请求失败，请稍后重试。");

    if (page === "register") {
      setMessage("注册成功，即将前往登录页面。", "success");
      setTimeout(() => { window.location.href = "/admin"; }, 800);
    } else {
      setMessage("登录成功，正在跳转…", "success");
      const role = result.role || "user";
      const target = role === "admin" ? "/admin/menu" : (role === "delivery" ? "/admin/orders" : "/");
      setTimeout(() => { window.location.href = target; }, 400);
    }
  } catch (error) {
    if (error.name === "AbortError") {
      setMessage("请求超时，请检查网络后重试。");
    } else {
      setMessage(error.message);
    }
  } finally {
    submitButton.disabled = false;
    submitButton.textContent = page === "register" ? "注册" : "登录";
  }
}

form.addEventListener("submit", submitAuth);

document.querySelectorAll(".toggle-password").forEach((button) => {
  button.addEventListener("click", () => {
    const input = document.getElementById(button.dataset.target);
    const visible = input.type === "text";
    input.type = visible ? "password" : "text";
    button.textContent = visible ? "显示" : "隐藏";
    button.setAttribute("aria-label", `${visible ? "显示" : "隐藏"}密码`);
    button.setAttribute("aria-pressed", String(!visible));
  });
});
