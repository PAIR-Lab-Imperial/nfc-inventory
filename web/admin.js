const apiBaseUrl = window.NFC_INVENTORY_CONFIG?.apiBaseUrl?.replace(/\/$/, "");
const storageKey = "pair-lab-admin-session";
const adminApp = document.querySelector("#admin-app");
const placeholderPhotoUrl = new URL("./assets/equipment-placeholder.svg", window.location.href).href;

let currentData = null;
let currentSummary = null;
let activeView = "equipment";

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

document.addEventListener("error", (event) => {
  if (!(event.target instanceof HTMLImageElement) || !event.target.matches("[data-equipment-photo]")) return;
  if (event.target.src !== placeholderPhotoUrl) event.target.src = placeholderPhotoUrl;
}, true);

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

function formatDate(value) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium" }).format(date);
}

function equipmentView(data) {
  return `
    <section class="management-section" data-view-panel="equipment">
      <div class="management-heading">
        <div><p class="eyebrow">Inventory records</p><h2>Equipment and bundles</h2></div>
        <button class="primary-button" type="button" id="add-equipment">Add equipment</button>
      </div>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>Photo</th><th>Asset</th><th>Equipment</th><th>Category</th><th>Type</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${data.equipment.map((item) => `
              <tr>
                <td><img data-equipment-photo src="${escapeHtml(item.photoUrl || placeholderPhotoUrl)}" alt="" loading="lazy"></td>
                <td><span class="asset-code">${escapeHtml(item.assetCode)}</span></td>
                <td><strong>${escapeHtml(item.name)}</strong>${item.model ? `<small>${escapeHtml(item.model)}</small>` : ""}</td>
                <td>${escapeHtml(item.category)}</td>
                <td>${escapeHtml(item.itemType === "bundle" ? `Bundle (${item.components.length})` : "Individual")}</td>
                <td><span class="admin-status status-${escapeHtml(item.lifecycleStatus)}">${escapeHtml(item.lifecycleStatus)}</span></td>
                <td><button class="secondary-button compact-button" type="button" data-edit-equipment="${escapeHtml(item.assetCode)}">Edit</button></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function membersView(data) {
  return `
    <section class="management-section" data-view-panel="members" hidden>
      <div class="management-heading">
        <div><p class="eyebrow">People</p><h2>Lab members</h2></div>
        <button class="primary-button" type="button" id="add-member">Add member</button>
      </div>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>Username</th><th>Display name</th><th>State</th><th>Notes</th><th></th></tr></thead>
          <tbody>
            ${data.members.map((member) => `
              <tr>
                <td><span class="asset-code">${escapeHtml(member.username)}</span></td>
                <td><strong>${escapeHtml(member.displayName)}</strong></td>
                <td><span class="admin-status ${member.active ? "status-active" : "status-retired"}">${member.active ? "Active" : "Inactive"}</span></td>
                <td>${escapeHtml(member.notes || "—")}</td>
                <td><button class="secondary-button compact-button" type="button" data-edit-member="${escapeHtml(member.username)}">Edit</button></td>
              </tr>
            `).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function labelsView(data) {
  const activeLabels = new Map(data.labels.filter((label) => label.status === "active").map((label) => [label.assetCode, label]));
  return `
    <section class="management-section" data-view-panel="labels" hidden>
      <div class="management-heading">
        <div><p class="eyebrow">NFC associations</p><h2>Active labels</h2></div>
        <p>New scan URLs are shown once. Program the sticker before closing the result.</p>
      </div>
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>Asset</th><th>Equipment</th><th>Label hint</th><th>Created</th><th></th></tr></thead>
          <tbody>
            ${data.equipment.map((item) => {
              const label = activeLabels.get(item.assetCode);
              return `
                <tr>
                  <td><span class="asset-code">${escapeHtml(item.assetCode)}</span></td>
                  <td><strong>${escapeHtml(item.name)}</strong></td>
                  <td>${label ? `…${escapeHtml(label.tokenHint)}` : "No active label"}</td>
                  <td>${label ? escapeHtml(formatDate(label.createdAt)) : "—"}</td>
                  <td><button class="secondary-button compact-button" type="button" data-replace-label="${escapeHtml(item.assetCode)}">${label ? "Replace label" : "Create label"}</button></td>
                </tr>
              `;
            }).join("")}
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function renderDashboard(message = "") {
  const { admin, summary } = currentSummary;
  document.title = "Administrator dashboard · PAIR Lab Equipment";
  adminApp.innerHTML = `
    <section class="admin-heading">
      <div><p class="eyebrow">Administrator</p><h1>Inventory management</h1><p>Signed in as ${escapeHtml(admin.username)}.</p></div>
      <button class="secondary-button" id="admin-logout" type="button">Sign out</button>
    </section>
    ${message ? `<p class="admin-message admin-page-message" role="status">${escapeHtml(message)}</p>` : ""}
    <dl class="admin-summary" aria-label="Inventory administration summary">
      ${summaryCard("Equipment", summary.equipmentCount)}
      ${summaryCard("Active members", summary.activeMemberCount)}
      ${summaryCard("Active NFC labels", summary.activeLabelCount)}
      ${summaryCard("Open checkouts", summary.openCheckoutCount)}
      ${summaryCard("Reservations", summary.activeReservationCount)}
      ${summaryCard("Categories", summary.categoryCount)}
    </dl>
    <nav class="admin-tabs" aria-label="Administration modules">
      <button type="button" data-admin-view="equipment">Equipment</button>
      <button type="button" data-admin-view="members">Members</button>
      <button type="button" data-admin-view="labels">NFC labels</button>
    </nav>
    ${equipmentView(currentData)}
    ${membersView(currentData)}
    ${labelsView(currentData)}
    <dialog class="admin-dialog" id="admin-dialog"></dialog>
  `;
  bindDashboardEvents();
  showView(activeView);
}

function showView(view) {
  activeView = view;
  document.querySelectorAll("[data-view-panel]").forEach((panel) => { panel.hidden = panel.dataset.viewPanel !== view; });
  document.querySelectorAll("[data-admin-view]").forEach((button) => { button.classList.toggle("active", button.dataset.adminView === view); });
}

function field(label, name, value = "", attributes = "") {
  return `<label><span>${label}</span><input name="${name}" value="${escapeHtml(value ?? "")}" ${attributes}></label>`;
}

function componentRow(component = {}) {
  return `
    <fieldset class="component-editor">
      <div class="component-editor-heading"><strong>Bundle component</strong><button type="button" class="text-button" data-remove-component>Remove</button></div>
      <div class="admin-field-grid">
        ${field("Component name", "componentName", component.name, "required maxlength=150")}
        ${field("Quantity", "componentQuantity", component.quantity ?? 1, "required type=number min=1 max=1000")}
        ${field("Manufacturer", "componentManufacturer", component.manufacturer, "maxlength=150")}
        ${field("Model", "componentModel", component.model, "maxlength=150")}
        ${field("Serial number", "componentSerialNumber", component.serialNumber, "maxlength=200")}
        ${field("Photo URL", "componentPhotoUrl", component.photoUrl || placeholderPhotoUrl, "required type=url maxlength=2000")}
      </div>
      <label class="check-field"><input name="componentRequired" type="checkbox" ${component.requiredOnReturn === false ? "" : "checked"}><span>Required on return</span></label>
      <label><span>Notes</span><textarea name="componentNotes" rows="2" maxlength="500">${escapeHtml(component.notes || "")}</textarea></label>
    </fieldset>
  `;
}

function openEquipmentDialog(item = null) {
  const dialog = document.querySelector("#admin-dialog");
  const categoryOptions = currentData.categories.map((category) => `<option value="${escapeHtml(category.name)}" ${item?.category === category.name ? "selected" : ""}>${escapeHtml(category.name)} (${escapeHtml(category.assetCodePrefix)})</option>`).join("");
  dialog.innerHTML = `
    <form method="dialog" id="equipment-form" class="admin-edit-form">
      <div class="dialog-heading"><div><p class="eyebrow">Equipment record</p><h2>${item ? `Edit ${escapeHtml(item.assetCode)}` : "Add equipment"}</h2></div><button class="icon-button" type="button" data-close-dialog aria-label="Close">×</button></div>
      <div class="admin-field-grid">
        ${field("Asset code", "assetCode", item?.assetCode, `${item ? "readonly" : "required"} maxlength=20 pattern="[A-Za-z][A-Za-z0-9]{1,7}-[0-9]{3,6}"`)}
        ${field("Equipment name", "name", item?.name, "required maxlength=150")}
        <label><span>Category</span><select name="category" required>${categoryOptions}</select></label>
        <label><span>Type</span><select name="itemType" required><option value="individual" ${item?.itemType !== "bundle" ? "selected" : ""}>Individual</option><option value="bundle" ${item?.itemType === "bundle" ? "selected" : ""}>Bundle</option></select></label>
        ${field("Manufacturer", "manufacturer", item?.manufacturer, "maxlength=150")}
        ${field("Model", "model", item?.model, "maxlength=150")}
        ${field("Serial number", "serialNumber", item?.serialNumber, "maxlength=200")}
        ${field("Location", "location", item?.location, "maxlength=200")}
        <label><span>Condition</span><select name="condition"><option value="">Unknown / not recorded</option>${["good", "fair", "damaged", "unknown"].map((value) => `<option value="${value}" ${item?.condition === value ? "selected" : ""}>${value}</option>`).join("")}</select></label>
        <label><span>Lifecycle status</span><select name="lifecycleStatus" required>${["active", "maintenance", "missing", "retired"].map((value) => `<option value="${value}" ${item?.lifecycleStatus === value || (!item && value === "active") ? "selected" : ""}>${value}</option>`).join("")}</select></label>
        ${field("Purchase date", "purchaseDate", item?.purchaseDate, "type=date")}
        ${field("Purchase price", "purchasePrice", item?.purchasePrice, "type=number min=0 step=0.01")}
        ${field("Currency", "currency", item?.currency || "GBP", 'maxlength=3 pattern="[A-Za-z]{3}"')}
        ${field("Supplier", "supplier", item?.supplier, "maxlength=200")}
        ${field("Photo URL", "photoUrl", item?.photoUrl || placeholderPhotoUrl, "required type=url maxlength=2000")}
      </div>
      <label><span>Public specifications</span><textarea name="publicSpecifications" rows="3" maxlength="2000">${escapeHtml(item?.publicSpecifications || "")}</textarea></label>
      <label><span>Public notes</span><textarea name="publicNotes" rows="3" maxlength="1000">${escapeHtml(item?.publicNotes || "")}</textarea></label>
      <label><span>Administrator notes</span><textarea name="adminNotes" rows="3" maxlength="2000">${escapeHtml(item?.adminNotes || "")}</textarea></label>
      <section id="components-section" ${item?.itemType === "bundle" ? "" : "hidden"}>
        <div class="component-section-heading"><h3>Bundle contents</h3><button class="secondary-button compact-button" type="button" id="add-component">Add component</button></div>
        <div id="components-editor">${(item?.components || []).map(componentRow).join("")}</div>
      </section>
      <p class="form-error" id="admin-form-error" role="alert" hidden></p>
      <div class="dialog-actions"><button class="secondary-button" type="button" data-close-dialog>Cancel</button><button class="primary-button" type="submit">Save equipment</button></div>
    </form>
  `;
  const form = dialog.querySelector("#equipment-form");
  const componentSection = dialog.querySelector("#components-section");
  const componentEditor = dialog.querySelector("#components-editor");
  const typeSelect = form.elements.namedItem("itemType");
  typeSelect.addEventListener("change", () => { componentSection.hidden = typeSelect.value !== "bundle"; });
  dialog.querySelector("#add-component").addEventListener("click", () => { componentEditor.insertAdjacentHTML("beforeend", componentRow()); });
  dialog.addEventListener("click", (event) => {
    if (event.target.matches("[data-remove-component]")) event.target.closest(".component-editor").remove();
  });
  dialog.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => dialog.close()));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const formData = new FormData(form);
    const components = [...form.querySelectorAll(".component-editor")].map((row) => ({
      name: row.querySelector('[name="componentName"]').value,
      quantity: Number(row.querySelector('[name="componentQuantity"]').value),
      manufacturer: row.querySelector('[name="componentManufacturer"]').value,
      model: row.querySelector('[name="componentModel"]').value,
      serialNumber: row.querySelector('[name="componentSerialNumber"]').value,
      photoUrl: row.querySelector('[name="componentPhotoUrl"]').value,
      requiredOnReturn: row.querySelector('[name="componentRequired"]').checked,
      notes: row.querySelector('[name="componentNotes"]').value,
    }));
    const payload = {
      assetCode: formData.get("assetCode"), name: formData.get("name"), category: formData.get("category"),
      itemType: formData.get("itemType"), manufacturer: formData.get("manufacturer"), model: formData.get("model"),
      serialNumber: formData.get("serialNumber"), location: formData.get("location"), condition: formData.get("condition"),
      lifecycleStatus: formData.get("lifecycleStatus"), purchaseDate: formData.get("purchaseDate"),
      purchasePrice: formData.get("purchasePrice"), currency: formData.get("currency"), supplier: formData.get("supplier"),
      photoUrl: formData.get("photoUrl"), publicSpecifications: formData.get("publicSpecifications"),
      publicNotes: formData.get("publicNotes"), adminNotes: formData.get("adminNotes"),
      components: formData.get("itemType") === "bundle" ? components : [],
    };
    await submitAdminForm(form, async () => {
      await apiRequest(item ? `/api/v1/admin/equipment/${encodeURIComponent(item.assetCode)}` : "/api/v1/admin/equipment", {
        method: item ? "PUT" : "POST", body: payload, authenticated: true,
      });
      dialog.close();
      await loadDashboard(item ? `${item.assetCode} was updated.` : `${payload.assetCode.toUpperCase()} was created.`);
    });
  });
  dialog.showModal();
}

function openMemberDialog(member = null) {
  const dialog = document.querySelector("#admin-dialog");
  dialog.innerHTML = `
    <form method="dialog" id="member-form" class="admin-edit-form narrow-form">
      <div class="dialog-heading"><div><p class="eyebrow">Member record</p><h2>${member ? "Edit member" : "Add member"}</h2></div><button class="icon-button" type="button" data-close-dialog aria-label="Close">×</button></div>
      ${field("Username", "username", member?.username, `${member ? "readonly" : "required"} maxlength=80 pattern="[A-Za-z0-9._-]+"`)}
      ${field("Display name", "displayName", member?.displayName, "required maxlength=150")}
      <label class="check-field"><input name="active" type="checkbox" ${member?.active === false ? "" : "checked"}><span>Active member</span></label>
      <label><span>Notes</span><textarea name="notes" rows="3" maxlength="1000">${escapeHtml(member?.notes || "")}</textarea></label>
      <p class="form-error" id="admin-form-error" role="alert" hidden></p>
      <div class="dialog-actions"><button class="secondary-button" type="button" data-close-dialog>Cancel</button><button class="primary-button" type="submit">Save member</button></div>
    </form>
  `;
  const form = dialog.querySelector("#member-form");
  dialog.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => dialog.close()));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const formData = new FormData(form);
    const payload = { username: formData.get("username"), displayName: formData.get("displayName"), active: form.elements.active.checked, notes: formData.get("notes") };
    await submitAdminForm(form, async () => {
      await apiRequest(member ? `/api/v1/admin/members/${encodeURIComponent(member.username)}` : "/api/v1/admin/members", {
        method: member ? "PUT" : "POST", body: payload, authenticated: true,
      });
      dialog.close();
      await loadDashboard(member ? `${member.username} was updated.` : `${payload.username} was added.`);
    });
  });
  dialog.showModal();
}

function openLabelDialog(assetCode) {
  const dialog = document.querySelector("#admin-dialog");
  const hasActive = currentData.labels.some((label) => label.assetCode === assetCode && label.status === "active");
  dialog.innerHTML = `
    <form method="dialog" id="label-form" class="admin-edit-form narrow-form">
      <div class="dialog-heading"><div><p class="eyebrow">NFC label</p><h2>${hasActive ? "Replace" : "Create"} ${escapeHtml(assetCode)} label</h2></div><button class="icon-button" type="button" data-close-dialog aria-label="Close">×</button></div>
      <p class="dialog-copy">${hasActive ? "The existing association will be retired immediately." : "A new association will be created."} The full scan URL is displayed only after creation.</p>
      <label><span>Label note</span><textarea name="notes" rows="3" maxlength="500" placeholder="For example: replacement after sticker detached"></textarea></label>
      <p class="form-error" id="admin-form-error" role="alert" hidden></p>
      <div class="dialog-actions"><button class="secondary-button" type="button" data-close-dialog>Cancel</button><button class="primary-button" type="submit">Generate scan URL</button></div>
    </form>
  `;
  const form = dialog.querySelector("#label-form");
  dialog.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => dialog.close()));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    await submitAdminForm(form, async () => {
      const formData = new FormData(form);
      const { label } = await apiRequest("/api/v1/admin/labels", { method: "POST", body: { assetCode, notes: formData.get("notes") }, authenticated: true });
      dialog.innerHTML = `
        <section class="admin-edit-form narrow-form">
          <div class="dialog-heading"><div><p class="eyebrow">Generated</p><h2>Program this NFC label</h2></div></div>
          <p class="dialog-copy">Write this complete URL to the sticker for <strong>${escapeHtml(assetCode)}</strong>. It cannot be recovered later.</p>
          <label><span>NFC scan URL</span><textarea id="generated-label-url" rows="4" readonly>${escapeHtml(label.scanUrl)}</textarea></label>
          <div class="dialog-actions"><button class="secondary-button" type="button" id="copy-label-url">Copy URL</button><button class="primary-button" type="button" id="finish-label">Done</button></div>
        </section>
      `;
      dialog.querySelector("#copy-label-url").addEventListener("click", async (event) => {
        await navigator.clipboard.writeText(label.scanUrl);
        event.currentTarget.textContent = "Copied";
      });
      dialog.querySelector("#finish-label").addEventListener("click", async () => { dialog.close(); await loadDashboard(`${assetCode} now has a new active NFC label.`); });
    });
  });
  dialog.showModal();
}

async function submitAdminForm(form, action) {
  const submit = form.querySelector('[type="submit"]');
  const errorMessage = form.querySelector("#admin-form-error");
  submit.disabled = true;
  errorMessage.hidden = true;
  try {
    await action();
  } catch (error) {
    errorMessage.textContent = error instanceof Error ? error.message : "The change could not be saved.";
    errorMessage.hidden = false;
    submit.disabled = false;
  }
}

function bindDashboardEvents() {
  document.querySelector("#admin-logout").addEventListener("click", () => {
    window.sessionStorage.removeItem(storageKey);
    currentData = null;
    currentSummary = null;
    renderLogin("You have signed out.");
  });
  document.querySelectorAll("[data-admin-view]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.adminView)));
  document.querySelector("#add-equipment").addEventListener("click", () => openEquipmentDialog());
  document.querySelectorAll("[data-edit-equipment]").forEach((button) => button.addEventListener("click", () => openEquipmentDialog(currentData.equipment.find((item) => item.assetCode === button.dataset.editEquipment))));
  document.querySelector("#add-member").addEventListener("click", () => openMemberDialog());
  document.querySelectorAll("[data-edit-member]").forEach((button) => button.addEventListener("click", () => openMemberDialog(currentData.members.find((member) => member.username === button.dataset.editMember))));
  document.querySelectorAll("[data-replace-label]").forEach((button) => button.addEventListener("click", () => openLabelDialog(button.dataset.replaceLabel)));
}

async function loadDashboard(message = "") {
  try {
    [currentSummary, currentData] = await Promise.all([
      apiRequest("/api/v1/admin/summary", { authenticated: true }),
      apiRequest("/api/v1/admin/data", { authenticated: true }),
    ]);
    renderDashboard(message);
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
