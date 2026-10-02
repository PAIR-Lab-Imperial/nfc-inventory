const apiBaseUrl = window.NFC_INVENTORY_CONFIG?.apiBaseUrl?.replace(/\/$/, "");
const storageKey = "pair-lab-admin-session";
const adminApp = document.querySelector("#admin-app");

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function getToken() {
  return window.sessionStorage.getItem(storageKey);
}

async function apiRequest(path, { method = "GET", body = null, authenticated = false } = {}) {
  if (!apiBaseUrl) throw new Error("The inventory API has not been configured.");
  const headers = { Accept: "application/json" };
  if (body) headers["Content-Type"] = "application/json";
  if (authenticated) {
    const token = getToken();
    if (!token) throw new Error("Administrator sign-in is required.");
    headers.Authorization = `Bearer ${token}`;
  }
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method,
    headers,
    body: body ? JSON.stringify(body) : null,
  });
  const result = await response.json().catch(() => null);
  if (!response.ok) {
    const error = new Error(result?.error?.message || `Administrator request failed (HTTP ${response.status}).`);
    error.status = response.status;
    throw error;
  }
  return result;
}

function renderLogin(message = "") {
  document.title = "Administrator sign in · PAIR Lab Equipment";
  adminApp.innerHTML = `
    <section class="admin-login-card" aria-labelledby="admin-login-title">
      <p class="eyebrow">Restricted access</p>
      <h1 id="admin-login-title">Administrator sign in</h1>
      <p class="admin-intro">Use the administrator username and password. Member reservations do not require this account.</p>
      ${message ? `<p class="admin-message" role="status">${escapeHtml(message)}</p>` : ""}
      <form id="admin-login-form" class="admin-form">
        <label><span>Administrator username</span><input name="username" type="text" autocomplete="username" maxlength="100" required></label>
        <label><span>Password</span><input name="password" type="password" autocomplete="current-password" maxlength="500" required></label>
        <p id="admin-login-error" class="form-error" role="alert" hidden></p>
        <button id="admin-login-button" class="primary-button" type="submit">Sign in</button>
      </form>
      <p class="security-note">The session is kept only in this browser tab and expires after four hours.</p>
    </section>
  `;

  const form = document.querySelector("#admin-login-form");
  const button = document.querySelector("#admin-login-button");
  const errorMessage = document.querySelector("#admin-login-error");
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const data = new FormData(form);
    button.disabled = true;
    button.textContent = "Signing in…";
    errorMessage.hidden = true;
    try {
      const { session } = await apiRequest("/api/v1/admin/login", {
        method: "POST",
        body: { username: data.get("username"), password: data.get("password") },
      });
      window.sessionStorage.setItem(storageKey, session.token);
      form.reset();
      await loadDashboard();
    } catch (error) {
      errorMessage.textContent = error instanceof Error ? error.message : "Sign-in failed.";
      errorMessage.hidden = false;
      button.disabled = false;
      button.textContent = "Sign in";
    }
  });
}

function summaryCard(label, value) {
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function renderDashboard({ admin, summary }) {
  document.title = "Administrator dashboard · PAIR Lab Equipment";
  adminApp.innerHTML = `
    <section class="admin-heading">
      <div><p class="eyebrow">Administrator</p><h1>Inventory overview</h1><p>Signed in as ${escapeHtml(admin.username)}.</p></div>
      <button class="secondary-button" id="admin-logout" type="button">Sign out</button>
    </section>
    <dl class="admin-summary" aria-label="Inventory administration summary">
      ${summaryCard("Equipment", summary.equipmentCount)}
      ${summaryCard("Active members", summary.activeMemberCount)}
      ${summaryCard("Active NFC labels", summary.activeLabelCount)}
      ${summaryCard("Open checkouts", summary.openCheckoutCount)}
      ${summaryCard("Current or upcoming reservations", summary.activeReservationCount)}
      ${summaryCard("Categories", summary.categoryCount)}
    </dl>
    <section class="admin-panels">
      <article>
        <p class="eyebrow">Purchasing</p>
        <h2>Equipment proposals</h2>
        <dl class="proposal-summary">
          <div><dt>Proposed</dt><dd>${escapeHtml(summary.proposals.proposed)}</dd></div>
          <div><dt>Ordered</dt><dd>${escapeHtml(summary.proposals.ordered)}</dd></div>
          <div><dt>Received</dt><dd>${escapeHtml(summary.proposals.received)}</dd></div>
        </dl>
      </article>
      <article>
        <p class="eyebrow">Next controls</p>
        <h2>Management modules</h2>
        <p>Equipment editing, member maintenance, NFC replacement, import/export and backups will be added here behind this same administrator session.</p>
      </article>
    </section>
  `;
  document.querySelector("#admin-logout").addEventListener("click", () => {
    window.sessionStorage.removeItem(storageKey);
    renderLogin("You have signed out.");
  });
}

async function loadDashboard() {
  try {
    const result = await apiRequest("/api/v1/admin/summary", { authenticated: true });
    renderDashboard(result);
  } catch (error) {
    if (error?.status === 401) window.sessionStorage.removeItem(storageKey);
    renderLogin(error?.status === 401 ? "Your administrator session expired. Sign in again." : error.message);
  }
}

if (getToken()) {
  loadDashboard();
} else {
  renderLogin();
}
