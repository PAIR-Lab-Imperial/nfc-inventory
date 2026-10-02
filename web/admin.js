import { buildInventoryWorkbook } from "./xlsx-export.js";
import { matchesAdminFilters } from "./admin-filters.js?v=0.12.0";

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

function formatDateTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? value : new Intl.DateTimeFormat("en-GB", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function localDateTimeValue(value) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.valueOf())) return "";
  const local = new Date(date.valueOf() - date.getTimezoneOffset() * 60_000);
  return local.toISOString().slice(0, 16);
}

const availabilityLabels = Object.freeze({
  free: "Available",
  reserved: "Reserved",
  in_use: "In use",
  not_unboxed: "Not yet unboxed",
});

function filterOptions(options) {
  return options.map(({ value, label }) => `<option value="${escapeHtml(value)}">${escapeHtml(label)}</option>`).join("");
}

function adminFilterBar(scope, { placeholder, selects = [] }) {
  return `
    <div class="admin-filter-bar" data-admin-filters="${escapeHtml(scope)}">
      <label class="admin-filter-search"><span>Search</span><input type="search" data-filter-key="search" placeholder="${escapeHtml(placeholder)}" autocomplete="off"></label>
      ${selects.map((select) => `
        <label><span>${escapeHtml(select.label)}</span><select data-filter-key="${escapeHtml(select.key)}"><option value="">${escapeHtml(select.allLabel)}</option>${filterOptions(select.options)}</select></label>
      `).join("")}
      <button class="secondary-button compact-button admin-filter-clear" type="button" data-filter-clear>Clear filters</button>
      <p class="admin-filter-count" data-filter-count aria-live="polite"></p>
    </div>
  `;
}

function downloadFile(contents, filename, type) {
  const blob = contents instanceof Blob ? contents : new Blob([contents], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  document.body.append(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function exportDateStamp() {
  return new Date().toISOString().slice(0, 10);
}

function equipmentView(data) {
  const activeItems = data.equipment.filter((item) => item.lifecycleStatus === "active");
  const lifecycleExceptions = data.equipment.filter((item) => item.lifecycleStatus !== "active");
  const categories = [...new Set(activeItems.map((item) => item.category))].sort((left, right) => left.localeCompare(right, "en-GB"));
  return `
    <section class="management-section" data-view-panel="equipment">
      <div class="management-heading">
        <div><p class="eyebrow">Operational inventory</p><h2>Active equipment and bundles</h2></div>
        <button class="primary-button" type="button" id="add-equipment">Add equipment</button>
      </div>
      ${adminFilterBar("equipment", {
        placeholder: "Asset code, equipment, model or category",
        selects: [
          { label: "Category", key: "category", allLabel: "All categories", options: categories.map((category) => ({ value: category, label: category })) },
          { label: "Type", key: "type", allLabel: "All types", options: [{ value: "individual", label: "Individual" }, { value: "bundle", label: "Bundle" }] },
          { label: "Availability", key: "availability", allLabel: "Any availability", options: Object.entries(availabilityLabels).map(([value, label]) => ({ value, label })) },
        ],
      })}
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>Photo</th><th>Asset</th><th>Equipment</th><th>Category</th><th>Type</th><th>Availability</th><th></th></tr></thead>
          <tbody>
            ${activeItems.map((item) => `
              <tr data-filter-row="equipment" data-search="${escapeHtml([item.assetCode, item.name, item.manufacturer, item.model, item.category].filter(Boolean).join(" "))}" data-category="${escapeHtml(item.category)}" data-type="${escapeHtml(item.itemType)}" data-availability="${escapeHtml(item.availability)}">
                <td><img data-equipment-photo src="${escapeHtml(item.photoUrl || placeholderPhotoUrl)}" alt="" loading="lazy"></td>
                <td><span class="asset-code">${escapeHtml(item.assetCode)}</span></td>
                <td><strong>${escapeHtml(item.name)}</strong>${item.model ? `<small>${escapeHtml(item.model)}</small>` : ""}</td>
                <td>${escapeHtml(item.category)}</td>
                <td>${escapeHtml(item.itemType === "bundle" ? `Bundle (${item.components.length})` : "Individual")}</td>
                <td><span class="admin-status status-${escapeHtml(item.availability)}">${escapeHtml(availabilityLabels[item.availability] || item.availability)}</span>${item.currentUser ? `<small>${escapeHtml(item.currentUser)}${item.availabilityUntil ? ` · until ${escapeHtml(formatDateTime(item.availabilityUntil))}` : ""}</small>` : ""}</td>
                <td><div class="table-actions"><button class="secondary-button compact-button" type="button" data-edit-availability="${escapeHtml(item.assetCode)}">Availability</button><button class="secondary-button compact-button" type="button" data-edit-equipment="${escapeHtml(item.assetCode)}">Edit record</button></div></td>
              </tr>
            `).join("")}
            <tr data-filter-empty="equipment" ${activeItems.length ? "hidden" : ""}><td colspan="7" class="empty-table-cell">No active equipment matches these filters.</td></tr>
          </tbody>
        </table>
      </div>
      <section class="lifecycle-exceptions" aria-labelledby="lifecycle-exceptions-title">
        <div class="management-heading">
          <div><p class="eyebrow">Lifecycle exceptions</p><h3 id="lifecycle-exceptions-title">Maintenance, missing and retired</h3></div>
        </div>
        ${lifecycleExceptions.length ? `
          <div class="admin-table-wrap">
            <table class="admin-table">
              <thead><tr><th>Asset</th><th>Equipment</th><th>Category</th><th>Lifecycle</th><th></th></tr></thead>
              <tbody>
                ${lifecycleExceptions.map((item) => `
                  <tr>
                    <td><span class="asset-code">${escapeHtml(item.assetCode)}</span></td>
                    <td><strong>${escapeHtml(item.name)}</strong>${item.model ? `<small>${escapeHtml(item.model)}</small>` : ""}</td>
                    <td>${escapeHtml(item.category)}</td>
                    <td><span class="admin-status status-${escapeHtml(item.lifecycleStatus)}">${escapeHtml(item.lifecycleStatus)}</span></td>
                    <td><button class="secondary-button compact-button" type="button" data-edit-equipment="${escapeHtml(item.assetCode)}">Edit</button></td>
                  </tr>
                `).join("")}
              </tbody>
            </table>
          </div>
        ` : `<p class="empty-lifecycle-message">No lifecycle exceptions.</p>`}
      </section>
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
      ${adminFilterBar("members", {
        placeholder: "Username, display name or notes",
        selects: [{ label: "State", key: "state", allLabel: "Any state", options: [{ value: "active", label: "Active" }, { value: "inactive", label: "Inactive" }] }],
      })}
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>Username</th><th>Display name</th><th>State</th><th>Notes</th><th></th></tr></thead>
          <tbody>
            ${data.members.map((member) => `
              <tr data-filter-row="members" data-search="${escapeHtml([member.username, member.displayName, member.notes].filter(Boolean).join(" "))}" data-state="${member.active ? "active" : "inactive"}">
                <td><span class="asset-code">${escapeHtml(member.username)}</span></td>
                <td><strong>${escapeHtml(member.displayName)}</strong></td>
                <td><span class="admin-status ${member.active ? "status-active" : "status-retired"}">${member.active ? "Active" : "Inactive"}</span></td>
                <td>${escapeHtml(member.notes || "—")}</td>
                <td><button class="secondary-button compact-button" type="button" data-edit-member="${escapeHtml(member.username)}">Edit</button></td>
              </tr>
            `).join("")}
            <tr data-filter-empty="members" ${data.members.length ? "hidden" : ""}><td colspan="5" class="empty-table-cell">No members match these filters.</td></tr>
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
        <p>Stored scan URLs can be viewed, copied and included in the protected operational export.</p>
      </div>
      ${adminFilterBar("labels", {
        placeholder: "Asset code, equipment or label hint",
        selects: [{
          label: "Programming",
          key: "programming",
          allLabel: "Any programming state",
          options: [
            { value: "written", label: "Written" },
            { value: "not_written", label: "Not written" },
            { value: "no_label", label: "No active label" },
          ],
        }],
      })}
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>Asset</th><th>Equipment</th><th>Label hint</th><th>Created</th><th>Programming</th><th></th></tr></thead>
          <tbody>
            ${data.equipment.map((item) => {
              const label = activeLabels.get(item.assetCode);
              return `
                <tr data-filter-row="labels" data-search="${escapeHtml([item.assetCode, item.name, item.model, label?.tokenHint].filter(Boolean).join(" "))}" data-programming="${label ? (label.writtenAt ? "written" : "not_written") : "no_label"}">
                  <td><span class="asset-code">${escapeHtml(item.assetCode)}</span></td>
                  <td><strong>${escapeHtml(item.name)}</strong></td>
                  <td>${label ? `…${escapeHtml(label.tokenHint)}` : "No active label"}</td>
                  <td>${label ? escapeHtml(formatDate(label.createdAt)) : "—"}</td>
                  <td>${label ? `<span class="admin-status ${label.writtenAt ? "status-written" : "status-not-written"}">${label.writtenAt ? "Written" : "Not written"}</span>${label.writtenAt ? `<small>${escapeHtml(formatDateTime(label.writtenAt))}${label.writtenBy ? ` · ${escapeHtml(label.writtenBy)}` : ""}</small>` : ""}` : "—"}</td>
                  <td>
                    ${label?.scanUrl ? `<button class="secondary-button compact-button" type="button" data-view-label="${escapeHtml(item.assetCode)}">View URL</button>` : ""}
                    ${label ? `<button class="secondary-button compact-button" type="button" data-set-label-written="${escapeHtml(label.id)}" data-written="${label.writtenAt ? "false" : "true"}">${label.writtenAt ? "Mark not written" : "Mark written"}</button>` : ""}
                    <button class="secondary-button compact-button" type="button" data-replace-label="${escapeHtml(item.assetCode)}">${label ? "Replace label" : "Create label"}</button>
                  </td>
                </tr>
              `;
            }).join("")}
            <tr data-filter-empty="labels" ${data.equipment.length ? "hidden" : ""}><td colspan="6" class="empty-table-cell">No NFC labels match these filters.</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function proposalsView(data) {
  return `
    <section class="management-section" data-view-panel="proposals" hidden>
      <div class="management-heading">
        <div><p class="eyebrow">Equipment ideas</p><h2>Proposals</h2></div>
        <p>Review member suggestions, select an option, and track it from proposed to received.</p>
      </div>
      ${adminFilterBar("proposals", {
        placeholder: "Proposal, requirement, requester or selected option",
        selects: [{ label: "Status", key: "status", allLabel: "Any status", options: ["proposed", "ordered", "received"].map((status) => ({ value: status, label: status[0].toUpperCase() + status.slice(1) })) }],
      })}
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead><tr><th>Proposal</th><th>Requested by</th><th>Options</th><th>Selected</th><th>Status</th><th></th></tr></thead>
          <tbody>
            ${data.proposals.length ? data.proposals.map((proposal) => {
              const selected = proposal.options.find((option) => option.id === proposal.selectedOptionId);
              return `
                <tr data-filter-row="proposals" data-search="${escapeHtml([proposal.title, proposal.requirement, proposal.requestedBy, selected?.name].filter(Boolean).join(" "))}" data-status="${escapeHtml(proposal.status)}">
                  <td><strong>${escapeHtml(proposal.title)}</strong><small>${escapeHtml(proposal.requirement)}</small></td>
                  <td>${escapeHtml(proposal.requestedBy || "—")}</td>
                  <td>${proposal.options.length}</td>
                  <td>${escapeHtml(selected?.name || "—")}</td>
                  <td><span class="admin-status status-${escapeHtml(proposal.status)}">${escapeHtml(proposal.status)}</span></td>
                  <td><button class="secondary-button compact-button" type="button" data-edit-proposal="${escapeHtml(proposal.id)}">Review</button></td>
                </tr>
              `;
            }).join("") : ""}
            <tr data-filter-empty="proposals" ${data.proposals.length ? "hidden" : ""}><td colspan="6" class="empty-table-cell">No proposals match these filters.</td></tr>
          </tbody>
        </table>
      </div>
    </section>
  `;
}

function exportsView() {
  return `
    <section class="management-section" data-view-panel="exports" hidden>
      <div class="management-heading">
        <div><p class="eyebrow">Protected downloads</p><h2>Exports</h2></div>
        <p>Downloads may contain member names and administrator notes. Store them outside the public repository.</p>
      </div>
      <div class="export-grid">
        <article>
          <h3>Inventory workbook</h3>
          <p>Equipment, bundle contents, members and categories in the same format used for validated imports.</p>
          <button class="primary-button" id="export-inventory-workbook" type="button">Download workbook</button>
        </article>
        <article>
          <h3>Operational data</h3>
          <p>Reservations, checkouts, NFC label history, proposals, audit events and recorded backup runs.</p>
          <button class="secondary-button" id="export-operational-data" type="button">Download JSON</button>
        </article>
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
      ${summaryCard("NFC written", `${summary.writtenLabelCount} / ${summary.activeLabelCount}`)}
      ${summaryCard("Open checkouts", summary.openCheckoutCount)}
      ${summaryCard("Reservations", summary.activeReservationCount)}
      ${summaryCard("Categories", summary.categoryCount)}
      ${summaryCard("Proposed", summary.proposals.proposed)}
      ${summaryCard("Ordered", summary.proposals.ordered)}
      ${summaryCard("Received", summary.proposals.received)}
    </dl>
    <nav class="admin-tabs" aria-label="Administration modules">
      <button type="button" data-admin-view="equipment">Equipment</button>
      <button type="button" data-admin-view="members">Members</button>
      <button type="button" data-admin-view="labels">NFC labels</button>
      <button type="button" data-admin-view="proposals">Proposals</button>
      <button type="button" data-admin-view="exports">Exports</button>
    </nav>
    ${equipmentView(currentData)}
    ${membersView(currentData)}
    ${labelsView(currentData)}
    ${proposalsView(currentData)}
    ${exportsView()}
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

function bindAdminFilters() {
  document.querySelectorAll("[data-admin-filters]").forEach((filterBar) => {
    const scope = filterBar.dataset.adminFilters;
    const panel = filterBar.closest("[data-view-panel]");
    const rows = [...panel.querySelectorAll(`[data-filter-row="${scope}"]`)];
    const controls = [...filterBar.querySelectorAll("[data-filter-key]")];
    const count = filterBar.querySelector("[data-filter-count]");
    const empty = panel.querySelector(`[data-filter-empty="${scope}"]`);
    const apply = () => {
      let visible = 0;
      for (const row of rows) {
        const matches = matchesAdminFilters(row.dataset, controls.map((control) => ({
          key: control.dataset.filterKey,
          value: control.value,
          mode: control.type === "search" ? "contains" : "exact",
        })));
        row.hidden = !matches;
        if (matches) visible += 1;
      }
      empty.hidden = visible !== 0;
      count.textContent = `Showing ${visible} of ${rows.length}`;
    };
    controls.forEach((control) => {
      control.addEventListener(control.type === "search" ? "input" : "change", apply);
    });
    filterBar.querySelector("[data-filter-clear]").addEventListener("click", () => {
      controls.forEach((control) => { control.value = ""; });
      apply();
      controls[0]?.focus();
    });
    apply();
  });
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

function openAvailabilityDialog(item) {
  const dialog = document.querySelector("#admin-dialog");
  const members = currentData.members.filter((member) => member.active);
  const memberOptions = members.map((member) => `<option value="${escapeHtml(member.username)}" ${member.username === item.currentUsername ? "selected" : ""}>${escapeHtml(member.displayName)}</option>`).join("");
  dialog.innerHTML = `
    <form method="dialog" id="availability-form" class="admin-edit-form narrow-form">
      <div class="dialog-heading"><div><p class="eyebrow">Administrator override</p><h2>${escapeHtml(item.assetCode)} availability</h2></div><button class="icon-button" type="button" data-close-dialog aria-label="Close">×</button></div>
      <p class="dialog-copy">Current state: <strong>${escapeHtml(availabilityLabels[item.availability] || item.availability)}</strong>${item.currentUser ? ` · ${escapeHtml(item.currentUser)}` : ""}. Saving replaces conflicting active reservations or checkouts and records an audit event.</p>
      <label><span>Availability</span><select name="availability" required><option value="free" ${item.availability === "free" ? "selected" : ""}>Available</option><option value="reserved" ${item.availability === "reserved" ? "selected" : ""}>Reserved</option><option value="in_use" ${item.availability === "in_use" ? "selected" : ""}>In use</option><option value="not_unboxed" ${item.availability === "not_unboxed" ? "selected" : ""}>Not yet unboxed</option></select></label>
      <div id="availability-member-fields">
        <label><span>Member</span><select name="username"><option value="">Select member</option>${memberOptions}</select></label>
      </div>
      <div id="availability-until-field">
        ${field("Tentative end or expected return", "until", localDateTimeValue(item.availabilityUntil), "type=datetime-local")}
      </div>
      <label class="check-field" id="availability-share-field"><input name="canShare" type="checkbox"><span>Member may be able to share during the reservation</span></label>
      <label><span>Override note <small>(optional)</small></span><textarea name="note" rows="3" maxlength="500" placeholder="Reason for the administrator override"></textarea></label>
      <p class="form-error" id="admin-form-error" role="alert" hidden></p>
      <div class="dialog-actions"><button class="secondary-button" type="button" data-close-dialog>Cancel</button><button class="primary-button" type="submit">Save availability</button></div>
    </form>
  `;
  const form = dialog.querySelector("#availability-form");
  const availability = form.elements.namedItem("availability");
  const username = form.elements.namedItem("username");
  const memberFields = dialog.querySelector("#availability-member-fields");
  const untilField = dialog.querySelector("#availability-until-field");
  const shareField = dialog.querySelector("#availability-share-field");
  const refreshFields = () => {
    const needsMember = ["reserved", "in_use"].includes(availability.value);
    memberFields.hidden = !needsMember;
    untilField.hidden = !needsMember;
    shareField.hidden = availability.value !== "reserved";
    username.required = needsMember;
  };
  availability.addEventListener("change", refreshFields);
  refreshFields();
  dialog.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => dialog.close()));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const formData = new FormData(form);
    await submitAdminForm(form, async () => {
      await apiRequest(`/api/v1/admin/equipment/${encodeURIComponent(item.assetCode)}/availability`, {
        method: "PUT",
        authenticated: true,
        body: {
          availability: formData.get("availability"),
          username: formData.get("username") || null,
          until: formData.get("until") ? new Date(formData.get("until")).toISOString() : null,
          canShare: formData.get("canShare") === "on",
          note: formData.get("note") || null,
        },
      });
      dialog.close();
      await loadDashboard(`${item.assetCode} availability was overridden.`);
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

function showStoredLabelDialog(assetCode) {
  const dialog = document.querySelector("#admin-dialog");
  const label = currentData.labels.find((item) => item.assetCode === assetCode && item.status === "active");
  if (!label?.scanUrl) return;
  dialog.innerHTML = `
    <section class="admin-edit-form narrow-form">
      <div class="dialog-heading"><div><p class="eyebrow">Active NFC label</p><h2>${escapeHtml(assetCode)} scan URL</h2></div><button class="icon-button" type="button" data-close-dialog aria-label="Close">×</button></div>
      <label><span>NFC scan URL</span><textarea id="stored-label-url" rows="4" readonly>${escapeHtml(label.scanUrl)}</textarea></label>
      <div class="dialog-actions"><button class="secondary-button" type="button" id="copy-stored-label-url">Copy URL</button><button class="primary-button" type="button" data-close-dialog>Done</button></div>
    </section>
  `;
  dialog.querySelector("#copy-stored-label-url").addEventListener("click", async (event) => {
    await navigator.clipboard.writeText(label.scanUrl);
    event.currentTarget.textContent = "Copied";
  });
  dialog.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => dialog.close()));
  dialog.showModal();
}

function openLabelDialog(assetCode) {
  const dialog = document.querySelector("#admin-dialog");
  const hasActive = currentData.labels.some((label) => label.assetCode === assetCode && label.status === "active");
  dialog.innerHTML = `
    <form method="dialog" id="label-form" class="admin-edit-form narrow-form">
      <div class="dialog-heading"><div><p class="eyebrow">NFC label</p><h2>${hasActive ? "Replace" : "Create"} ${escapeHtml(assetCode)} label</h2></div><button class="icon-button" type="button" data-close-dialog aria-label="Close">×</button></div>
      <p class="dialog-copy">${hasActive ? "The existing association will be retired immediately." : "A new association will be created."} The new scan URL will remain available to administrators.</p>
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
          <p class="dialog-copy">Write this complete URL to the sticker for <strong>${escapeHtml(assetCode)}</strong>. It is stored and can be viewed again from the NFC labels table.</p>
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

async function setLabelWritten(button) {
  const label = currentData.labels.find((item) => item.id === button.dataset.setLabelWritten);
  if (!label) return;
  const written = button.dataset.written === "true";
  button.disabled = true;
  button.textContent = written ? "Marking…" : "Clearing…";
  try {
    await apiRequest(`/api/v1/admin/labels/${encodeURIComponent(label.id)}/written`, {
      method: "PUT",
      authenticated: true,
      body: { written },
    });
    await loadDashboard(`${label.assetCode} was marked ${written ? "written" : "not written"}.`);
    showView("labels");
  } catch (error) {
    button.disabled = false;
    button.textContent = written ? "Mark written" : "Mark not written";
    window.alert(error instanceof Error ? error.message : "The NFC written status could not be saved.");
  }
}

function openProposalDialog(proposal) {
  const dialog = document.querySelector("#admin-dialog");
  const optionChoices = proposal.options.map((option) => `<option value="${escapeHtml(option.id)}" ${proposal.selectedOptionId === option.id ? "selected" : ""}>${escapeHtml(option.name)}${option.quotedPrice !== null ? ` — ${escapeHtml(`${option.currency} ${Number(option.quotedPrice).toFixed(2)}`)}` : ""}</option>`).join("");
  const receivedEquipmentChoices = currentData.equipment.map((item) => `<option value="${escapeHtml(item.assetCode)}" ${proposal.receivedAssetCode === item.assetCode ? "selected" : ""}>${escapeHtml(item.assetCode)} — ${escapeHtml(item.name)}</option>`).join("");
  dialog.innerHTML = `
    <form method="dialog" id="proposal-admin-form" class="admin-edit-form">
      <div class="dialog-heading"><div><p class="eyebrow">Equipment proposal</p><h2>${escapeHtml(proposal.title)}</h2></div><button class="icon-button" type="button" data-close-dialog aria-label="Close">×</button></div>
      <p class="dialog-copy"><strong>Requested by:</strong> ${escapeHtml(proposal.requestedBy || "Unknown member")}</p>
      <p class="dialog-copy">${escapeHtml(proposal.requirement)}</p>
      <div class="proposal-review-options">
        ${proposal.options.map((option) => `<article><div><strong>${escapeHtml(option.name)}</strong>${option.supplier ? `<span>${escapeHtml(option.supplier)}</span>` : ""}</div><a href="${escapeHtml(option.productUrl)}" target="_blank" rel="noopener noreferrer">Open product link</a>${option.notes ? `<p>${escapeHtml(option.notes)}</p>` : ""}</article>`).join("")}
      </div>
      <div class="admin-field-grid">
        <label><span>Status</span><select name="status" required>${["proposed", "ordered", "received"].map((status) => `<option value="${status}" ${proposal.status === status ? "selected" : ""}>${status}</option>`).join("")}</select></label>
        <label><span>Selected option</span><select name="selectedOptionId"><option value="">No option selected</option>${optionChoices}</select></label>
        <label><span>Received equipment record</span><select name="receivedAssetCode"><option value="">Not linked</option>${receivedEquipmentChoices}</select></label>
      </div>
      <label><span>Administrator notes</span><textarea name="adminNotes" rows="4" maxlength="2000">${escapeHtml(proposal.adminNotes || "")}</textarea></label>
      <p class="form-error" id="admin-form-error" role="alert" hidden></p>
      <div class="dialog-actions"><button class="secondary-button" type="button" data-close-dialog>Cancel</button><button class="primary-button" type="submit">Save proposal</button></div>
    </form>
  `;
  const form = dialog.querySelector("#proposal-admin-form");
  const status = form.elements.namedItem("status");
  const selectedOption = form.elements.namedItem("selectedOptionId");
  const receivedEquipment = form.elements.namedItem("receivedAssetCode");
  const refreshRequirements = () => {
    selectedOption.required = ["ordered", "received"].includes(status.value);
    receivedEquipment.required = status.value === "received";
  };
  status.addEventListener("change", refreshRequirements);
  refreshRequirements();
  dialog.querySelectorAll("[data-close-dialog]").forEach((button) => button.addEventListener("click", () => dialog.close()));
  form.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!form.reportValidity()) return;
    const formData = new FormData(form);
    await submitAdminForm(form, async () => {
      await apiRequest(`/api/v1/admin/proposals/${encodeURIComponent(proposal.id)}`, {
        method: "PUT",
        authenticated: true,
        body: {
          status: formData.get("status"),
          selectedOptionId: formData.get("selectedOptionId") || null,
          receivedAssetCode: formData.get("receivedAssetCode") || null,
          adminNotes: formData.get("adminNotes") || null,
        },
      });
      dialog.close();
      await loadDashboard(`${proposal.title} was updated.`);
      showView("proposals");
    });
  });
  dialog.showModal();
}

function exportInventoryWorkbook(button) {
  button.disabled = true;
  button.textContent = "Preparing…";
  try {
    const workbook = buildInventoryWorkbook(currentData);
    downloadFile(workbook, `PAIR-Lab-Inventory-${exportDateStamp()}.xlsx`, "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet");
    button.textContent = "Downloaded";
  } catch (error) {
    button.textContent = error instanceof Error ? error.message : "Export failed";
  }
  window.setTimeout(() => { button.disabled = false; button.textContent = "Download workbook"; }, 1800);
}

async function exportOperationalData(button) {
  button.disabled = true;
  button.textContent = "Preparing…";
  try {
    const operations = await apiRequest("/api/v1/admin/export/operations", { authenticated: true });
    const payload = {
      ...operations,
      categories: currentData.categories,
      equipment: currentData.equipment,
      members: currentData.members,
      nfcLabels: currentData.labels,
      proposals: currentData.proposals,
    };
    downloadFile(JSON.stringify(payload, null, 2), `PAIR-Lab-Operations-${exportDateStamp()}.json`, "application/json");
    button.textContent = "Downloaded";
  } catch (error) {
    button.textContent = error instanceof Error ? error.message : "Export failed";
  }
  window.setTimeout(() => { button.disabled = false; button.textContent = "Download JSON"; }, 1800);
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
  bindAdminFilters();
  document.querySelector("#admin-logout").addEventListener("click", () => {
    window.sessionStorage.removeItem(storageKey);
    currentData = null;
    currentSummary = null;
    renderLogin("You have signed out.");
  });
  document.querySelectorAll("[data-admin-view]").forEach((button) => button.addEventListener("click", () => showView(button.dataset.adminView)));
  document.querySelector("#add-equipment").addEventListener("click", () => openEquipmentDialog());
  document.querySelectorAll("[data-edit-availability]").forEach((button) => button.addEventListener("click", () => openAvailabilityDialog(currentData.equipment.find((item) => item.assetCode === button.dataset.editAvailability))));
  document.querySelectorAll("[data-edit-equipment]").forEach((button) => button.addEventListener("click", () => openEquipmentDialog(currentData.equipment.find((item) => item.assetCode === button.dataset.editEquipment))));
  document.querySelector("#add-member").addEventListener("click", () => openMemberDialog());
  document.querySelectorAll("[data-edit-member]").forEach((button) => button.addEventListener("click", () => openMemberDialog(currentData.members.find((member) => member.username === button.dataset.editMember))));
  document.querySelectorAll("[data-view-label]").forEach((button) => button.addEventListener("click", () => showStoredLabelDialog(button.dataset.viewLabel)));
  document.querySelectorAll("[data-set-label-written]").forEach((button) => button.addEventListener("click", () => setLabelWritten(button)));
  document.querySelectorAll("[data-replace-label]").forEach((button) => button.addEventListener("click", () => openLabelDialog(button.dataset.replaceLabel)));
  document.querySelectorAll("[data-edit-proposal]").forEach((button) => button.addEventListener("click", () => openProposalDialog(currentData.proposals.find((proposal) => proposal.id === button.dataset.editProposal))));
  document.querySelector("#export-inventory-workbook").addEventListener("click", (event) => exportInventoryWorkbook(event.currentTarget));
  document.querySelector("#export-operational-data").addEventListener("click", (event) => exportOperationalData(event.currentTarget));
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
