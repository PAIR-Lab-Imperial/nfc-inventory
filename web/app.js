const app = document.querySelector("#app");
const apiBaseUrl = window.NFC_INVENTORY_CONFIG?.apiBaseUrl?.replace(/\/$/, "");
const placeholderPhotoUrl = new URL("./assets/equipment-placeholder.svg", window.location.href).href;

document.addEventListener("error", (event) => {
  if (!(event.target instanceof HTMLImageElement) || !event.target.matches("[data-equipment-photo]")) return;
  if (event.target.src !== placeholderPhotoUrl) event.target.src = placeholderPhotoUrl;
}, true);

const statusLabels = Object.freeze({
  free: "Available",
  reserved: "Reserved",
  in_use: "In use",
  maintenance: "Maintenance",
  missing: "Missing",
  retired: "Retired",
  not_unboxed: "Not yet unboxed",
});

const proposalStatusLabels = Object.freeze({
  proposed: "Proposed",
  ordered: "Ordered",
  received: "Received",
});

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

function titleCase(value) {
  return String(value ?? "")
    .replaceAll("_", " ")
    .replace(/\b\w/g, (character) => character.toUpperCase());
}

function statusLabel(value) {
  return statusLabels[value] ?? titleCase(value);
}

function formatDate(value, { includeTime = false } = {}) {
  if (!value) return null;
  const date = /^\d{4}-\d{2}-\d{2}$/.test(value)
    ? new Date(`${value}T12:00:00Z`)
    : new Date(value);
  if (Number.isNaN(date.valueOf())) return value;
  return new Intl.DateTimeFormat("en-GB", {
    day: "numeric",
    month: "short",
    year: "numeric",
    ...(includeTime ? { hour: "2-digit", minute: "2-digit" } : {}),
  }).format(date);
}

function formatMoney(value, currency) {
  if (value === null || value === undefined || !currency) return null;
  try {
    return new Intl.NumberFormat("en-GB", { style: "currency", currency }).format(value);
  } catch {
    return `${currency} ${Number(value).toFixed(2)}`;
  }
}

async function fetchJson(path) {
  if (!apiBaseUrl) throw new Error("The inventory API has not been configured.");
  const response = await fetch(`${apiBaseUrl}${path}`, {
    headers: { Accept: "application/json" },
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error?.message || `Inventory request failed (HTTP ${response.status}).`);
  }
  return body;
}

async function postJson(path, data) {
  if (!apiBaseUrl) throw new Error("The inventory API has not been configured.");
  const response = await fetch(`${apiBaseUrl}${path}`, {
    method: "POST",
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
    },
    body: JSON.stringify(data),
  });
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(body?.error?.message || `Inventory request failed (HTTP ${response.status}).`);
  }
  return body;
}

function localDateTimeValue(date) {
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.valueOf() - offset).toISOString().slice(0, 16);
}

function isoDateTime(value) {
  return value ? new Date(value).toISOString() : null;
}

function statusBadge(availability) {
  return `<span class="status-pill status-${escapeHtml(availability)}"><span aria-hidden="true"></span>${escapeHtml(statusLabel(availability))}</span>`;
}

function renderError(message) {
  document.title = "Inventory unavailable · PAIR Lab Equipment";
  app.innerHTML = `
    <section class="message-card error-card">
      <p class="eyebrow">Connection problem</p>
      <h1>We couldn’t load the inventory.</h1>
      <p>${escapeHtml(message)}</p>
      <button class="primary-button" id="retry-button" type="button">Try again</button>
    </section>
  `;
  document.querySelector("#retry-button")?.addEventListener("click", () => window.location.reload());
}

function equipmentCard(item) {
  const descriptor = [item.manufacturer, item.model].filter(Boolean).join(" · ");
  const usage = item.currentUser
    ? `<p class="usage-line"><strong>${item.availability === "reserved" ? "Reserved by" : "With"}:</strong> ${escapeHtml(item.currentUser)}</p>`
    : "";
  return `
    <article class="equipment-card" data-asset-code="${escapeHtml(item.assetCode)}">
      <div class="card-topline">
        <span class="asset-code">${escapeHtml(item.assetCode)}</span>
        ${statusBadge(item.availability)}
      </div>
      <img class="equipment-card-photo" data-equipment-photo src="${escapeHtml(item.photoUrl || placeholderPhotoUrl)}" alt="Photo of ${escapeHtml(item.name)}" loading="lazy">
      <div class="card-copy">
        <p class="category-label">${escapeHtml(item.category)}</p>
        <h2>${escapeHtml(item.name)}</h2>
        ${descriptor ? `<p class="descriptor">${escapeHtml(descriptor)}</p>` : ""}
        ${item.location ? `<p class="location-line">${escapeHtml(item.location)}</p>` : ""}
        ${usage}
      </div>
      <a class="card-link" href="?item=${encodeURIComponent(item.assetCode)}" aria-label="View ${escapeHtml(item.name)}, ${escapeHtml(item.assetCode)}">
        View details <span aria-hidden="true">→</span>
      </a>
    </article>
  `;
}

function proposalCard(proposal) {
  const options = proposal.options.map((option) => {
    const price = formatMoney(option.quotedPrice, option.currency);
    return `
      <li class="proposal-option${option.selected ? " selected" : ""}">
        <div><strong>${escapeHtml(option.name)}</strong>${option.supplier ? `<span>${escapeHtml(option.supplier)}</span>` : ""}</div>
        ${price ? `<span>${escapeHtml(price)}</span>` : ""}
        <a href="${escapeHtml(option.productUrl)}" target="_blank" rel="noopener noreferrer">Product link</a>
        ${option.selected ? `<small>Selected option</small>` : ""}
      </li>
    `;
  }).join("");
  const receivedLink = proposal.receivedAssetCode
    ? `<a class="proposal-received-link" href="?item=${encodeURIComponent(proposal.receivedAssetCode)}">View received equipment ${escapeHtml(proposal.receivedAssetCode)}</a>`
    : "";
  return `
    <article class="proposal-card">
      <div class="proposal-card-heading">
        <div><p class="eyebrow">${escapeHtml(proposal.requestedBy || "Lab member")}</p><h3>${escapeHtml(proposal.title)}</h3></div>
        <span class="proposal-status status-${escapeHtml(proposal.status)}">${escapeHtml(proposalStatusLabels[proposal.status] || titleCase(proposal.status))}</span>
      </div>
      <p>${escapeHtml(proposal.requirement)}</p>
      <ul class="proposal-options">${options}</ul>
      ${receivedLink}
    </article>
  `;
}

function proposalOptionRow(index) {
  return `
    <fieldset class="proposal-option-editor" data-proposal-option>
      <div class="proposal-option-editor-heading"><strong data-option-label>Option ${index + 1}</strong><button class="text-button" type="button" data-remove-proposal-option>Remove</button></div>
      <div class="field-pair">
        <label><span>Equipment or product name</span><input name="optionName" maxlength="200" required></label>
        <label><span>Supplier <small>(optional)</small></span><input name="optionSupplier" maxlength="200"></label>
      </div>
      <label><span>Product link</span><input name="optionUrl" type="url" maxlength="2000" required placeholder="https://"></label>
      <div class="field-pair compact-fields">
        <label><span>Price <small>(optional)</small></span><input name="optionPrice" type="number" min="0" step="0.01" inputmode="decimal"></label>
        <label><span>Currency</span><input name="optionCurrency" value="GBP" maxlength="3" pattern="[A-Za-z]{3}"></label>
      </div>
      <label><span>Option notes <small>(optional)</small></span><textarea name="optionNotes" maxlength="1000" rows="2"></textarea></label>
    </fieldset>
  `;
}

function renderCatalogue(data, proposalData, memberData, { message = "" } = {}) {
  document.title = "PAIR Lab Equipment";
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  const total = data.items.length;
  const available = data.items.filter((item) => item.availability === "free").length;
  const allocated = data.items.filter((item) => ["reserved", "in_use"].includes(item.availability)).length;
  const categoryOptions = data.categories
    .filter((category) => category.equipmentCount > 0)
    .map((category) => `<option value="${escapeHtml(category.name)}">${escapeHtml(category.name)} (${category.equipmentCount})</option>`)
    .join("");

  app.innerHTML = `
    ${message ? `<div class="action-confirmation" role="status">${escapeHtml(message)}</div>` : ""}
    <section class="catalogue-hero">
      <div>
        <p class="eyebrow">NFC inventory</p>
        <h1>Find the equipment you need.</h1>
        <p class="hero-copy">Search the PAIR Lab collection, check live availability, and open a complete record for each item or bundle.</p>
        <div class="hero-actions">
          <a class="secondary-button proposal-jump" href="#proposals">Propose equipment</a>
        </div>
      </div>
      <dl class="summary-strip" aria-label="Inventory summary">
        <div><dt>Total</dt><dd>${total}</dd></div>
        <div><dt>Available</dt><dd>${available}</dd></div>
        <div><dt>Reserved or in use</dt><dd>${allocated}</dd></div>
      </dl>
    </section>

    <section class="catalogue-panel" aria-labelledby="catalogue-title">
      <div class="panel-heading">
        <div>
          <p class="eyebrow">Browse</p>
          <h2 id="catalogue-title">Equipment catalogue</h2>
        </div>
        <p id="result-count">${total} items</p>
      </div>
      <div class="filters" role="search">
        <label class="search-field">
          <span>Search equipment</span>
          <input id="equipment-search" type="search" placeholder="Name, code, model or location" autocomplete="off">
        </label>
        <label>
          <span>Category</span>
          <select id="category-filter">
            <option value="">All categories</option>
            ${categoryOptions}
          </select>
        </label>
        <label>
          <span>Availability</span>
          <select id="availability-filter">
            <option value="">Any status</option>
            <option value="free">Available</option>
            <option value="reserved">Reserved</option>
            <option value="in_use">In use</option>
            <option value="not_unboxed">Not yet unboxed</option>
            <option value="maintenance">Maintenance</option>
            <option value="missing">Missing</option>
            <option value="retired">Retired</option>
          </select>
        </label>
      </div>
      <div id="equipment-grid" class="equipment-grid"></div>
      <div id="empty-results" class="empty-results" hidden>
        <h3>No equipment matches those filters.</h3>
        <p>Try a shorter search or clear one of the filters.</p>
        <button type="button" class="secondary-button" id="clear-filters">Clear filters</button>
      </div>
    </section>

    <section class="proposal-panel" id="proposals" tabindex="-1" aria-labelledby="proposal-title">
      <div class="panel-heading">
        <div><p class="eyebrow">Equipment ideas</p><h2 id="proposal-title">Proposals</h2></div>
        <button class="primary-button" id="open-proposal-dialog" type="button">Propose equipment</button>
      </div>
      <p class="proposal-intro">Share a requirement and compare possible products. Proposals are informational until an administrator marks one ordered.</p>
      <div class="proposal-grid">
        ${proposalData.proposals.length ? proposalData.proposals.map(proposalCard).join("") : `<div class="empty-results"><h3>No proposals yet.</h3><p>Start one when the lab needs equipment that is not in the catalogue.</p></div>`}
      </div>
    </section>

    <dialog class="action-dialog proposal-dialog" id="proposal-dialog" aria-labelledby="proposal-dialog-title">
      <form id="proposal-form">
        <div class="dialog-heading">
          <div><p class="eyebrow">Equipment idea</p><h2 id="proposal-dialog-title">Propose equipment</h2></div>
          <button class="icon-button" type="button" data-close-proposal-dialog aria-label="Close">×</button>
        </div>
        <div class="dialog-fields">
          <label><span>Lab member</span><select name="requestedByMemberId" required><option value="">Select your name</option>${memberData.members.map((member) => `<option value="${escapeHtml(member.id)}">${escapeHtml(member.displayName)}</option>`).join("")}</select></label>
          <label><span>Proposal title</span><input name="title" maxlength="180" required placeholder="For example: Mobile depth camera"></label>
          <label><span>Requirement</span><textarea name="requirement" maxlength="3000" rows="4" required placeholder="What capability is needed, where it will be used, and any important constraints"></textarea></label>
          <div class="proposal-options-heading"><div><p class="eyebrow">Choices</p><h3>Equipment options</h3></div><button class="secondary-button" id="add-proposal-option" type="button">Add option</button></div>
          <div id="proposal-options-editor">${proposalOptionRow(0)}</div>
        </div>
        <p class="form-error" id="proposal-error" role="alert" hidden></p>
        <div class="dialog-actions">
          <button class="secondary-button" type="button" data-close-proposal-dialog>Cancel</button>
          <button class="primary-button" id="proposal-submit" type="submit">Submit proposal</button>
        </div>
      </form>
    </dialog>
  `;

  const searchInput = document.querySelector("#equipment-search");
  const categoryFilter = document.querySelector("#category-filter");
  const availabilityFilter = document.querySelector("#availability-filter");
  const grid = document.querySelector("#equipment-grid");
  const empty = document.querySelector("#empty-results");
  const resultCount = document.querySelector("#result-count");

  function applyFilters() {
    const search = searchInput.value.trim().toLocaleLowerCase("en-GB");
    const category = categoryFilter.value;
    const availability = availabilityFilter.value;
    const items = data.items.filter((item) => {
      const searchable = [item.assetCode, item.name, item.category, item.manufacturer, item.model, item.location]
        .filter(Boolean)
        .join(" ")
        .toLocaleLowerCase("en-GB");
      return (!search || searchable.includes(search))
        && (!category || item.category === category)
        && (!availability || item.availability === availability);
    });
    grid.innerHTML = items.map(equipmentCard).join("");
    grid.hidden = items.length === 0;
    empty.hidden = items.length !== 0;
    resultCount.textContent = `${items.length} ${items.length === 1 ? "item" : "items"}`;
  }

  searchInput.addEventListener("input", applyFilters);
  categoryFilter.addEventListener("change", applyFilters);
  availabilityFilter.addEventListener("change", applyFilters);
  document.querySelector("#clear-filters").addEventListener("click", () => {
    searchInput.value = "";
    categoryFilter.value = "";
    availabilityFilter.value = "";
    applyFilters();
    searchInput.focus();
  });
  applyFilters();

  const proposalDialog = document.querySelector("#proposal-dialog");
  const proposalForm = document.querySelector("#proposal-form");
  const optionsEditor = document.querySelector("#proposal-options-editor");
  const proposalError = document.querySelector("#proposal-error");
  const proposalSubmit = document.querySelector("#proposal-submit");
  const refreshProposalOptionControls = () => {
    const rows = [...optionsEditor.querySelectorAll("[data-proposal-option]")];
    rows.forEach((row, index) => {
      row.querySelector("[data-option-label]").textContent = `Option ${index + 1}`;
      row.querySelector("[data-remove-proposal-option]").hidden = rows.length === 1;
    });
    document.querySelector("#add-proposal-option").disabled = rows.length >= 8;
  };
  document.querySelector("#open-proposal-dialog").addEventListener("click", () => {
    proposalError.hidden = true;
    proposalDialog.showModal();
    proposalForm.querySelector("select")?.focus();
  });
  document.querySelectorAll("[data-close-proposal-dialog]").forEach((button) => button.addEventListener("click", () => proposalDialog.close()));
  document.querySelector("#add-proposal-option").addEventListener("click", () => {
    const count = optionsEditor.querySelectorAll("[data-proposal-option]").length;
    if (count >= 8) return;
    optionsEditor.insertAdjacentHTML("beforeend", proposalOptionRow(count));
    refreshProposalOptionControls();
  });
  optionsEditor.addEventListener("click", (event) => {
    const button = event.target.closest("[data-remove-proposal-option]");
    if (!button || optionsEditor.querySelectorAll("[data-proposal-option]").length === 1) return;
    button.closest("[data-proposal-option]").remove();
    refreshProposalOptionControls();
  });
  proposalForm.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!proposalForm.reportValidity()) return;
    const formData = new FormData(proposalForm);
    const options = [...optionsEditor.querySelectorAll("[data-proposal-option]")].map((row) => {
      const price = row.querySelector('[name="optionPrice"]').value;
      return {
        name: row.querySelector('[name="optionName"]').value,
        productUrl: row.querySelector('[name="optionUrl"]').value,
        supplier: row.querySelector('[name="optionSupplier"]').value || null,
        quotedPrice: price === "" ? null : Number(price),
        currency: price === "" ? null : row.querySelector('[name="optionCurrency"]').value,
        notes: row.querySelector('[name="optionNotes"]').value || null,
      };
    });
    proposalSubmit.disabled = true;
    proposalSubmit.textContent = "Submitting…";
    proposalError.hidden = true;
    try {
      await postJson("/api/v1/proposals", {
        requestedByMemberId: formData.get("requestedByMemberId"),
        title: formData.get("title"),
        requirement: formData.get("requirement"),
        options,
      });
      proposalDialog.close();
      await loadCatalogue("Proposal submitted.");
    } catch (error) {
      proposalError.textContent = error instanceof Error ? error.message : "The proposal could not be submitted.";
      proposalError.hidden = false;
      proposalSubmit.disabled = false;
      proposalSubmit.textContent = "Submit proposal";
    }
  });
  refreshProposalOptionControls();
}

function detailDefinition(label, value) {
  if (value === null || value === undefined || value === "") return "";
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function availabilityMessage(item) {
  if (item.availability === "free") return "Available now.";
  if (item.availability === "not_unboxed") return "This item has arrived but has not yet been unboxed and made ready for use.";
  if (item.availability === "in_use") {
    return item.currentUser ? `Currently with ${item.currentUser}.` : "Currently in use.";
  }
  if (item.availability === "reserved") {
    const until = formatDate(item.reservedUntil, { includeTime: true });
    const owner = item.currentUser ? ` by ${item.currentUser}` : "";
    const ending = until ? ` until ${until}` : "";
    const sharing = item.canShare ? " The reservation may be shareable." : "";
    return `Reserved${owner}${ending}.${sharing}`;
  }
  return `This item is marked as ${statusLabel(item.availability).toLocaleLowerCase("en-GB")}.`;
}

function actionDialogMarkup(kind, item, members) {
  const now = new Date();
  const tomorrow = new Date(now.valueOf() + 24 * 60 * 60 * 1000);
  const memberOptions = members
    .map((member) => `<option value="${escapeHtml(member.id)}">${escapeHtml(member.displayName)}</option>`)
    .join("");

  if (kind === "reserve") {
    return `
      <p class="dialog-intro">Reserve <strong>${escapeHtml(item.assetCode)}</strong>. Reservations are advisory and may overlap.</p>
      <label><span>Lab member</span><select name="memberId" required><option value="">Select your name</option>${memberOptions}</select></label>
      <label><span>Confirm with your username</span><input name="username" type="text" maxlength="80" autocomplete="username" required placeholder="Your username"></label>
      <div class="field-pair">
        <label><span>Start</span><input name="startsAt" type="datetime-local" value="${localDateTimeValue(now)}" required></label>
        <label><span>Tentative end</span><input name="endsAt" type="datetime-local" value="${localDateTimeValue(tomorrow)}" required></label>
      </div>
      <label class="check-field"><input name="canShare" type="checkbox"><span>I may be able to share this equipment during my reservation</span></label>
      <label><span>Sharing or reservation note <small>(optional)</small></span><textarea name="sharingNotes" maxlength="500" rows="3" placeholder="For example: available after 15:00 if you message me"></textarea></label>
    `;
  }

  if (kind === "checkout") {
    return `
      <p class="dialog-intro">Check out <strong>${escapeHtml(item.assetCode)}</strong>. Enter your active lab username as a lightweight confirmation.</p>
      <label><span>Lab username</span><input name="username" type="text" maxlength="80" autocomplete="username" required placeholder="Your username"></label>
      <label><span>Expected return <small>(optional)</small></span><input name="expectedReturnAt" type="datetime-local" value="${localDateTimeValue(tomorrow)}"></label>
      <label><span>Checkout note <small>(optional)</small></span><textarea name="checkoutNotes" maxlength="500" rows="3" placeholder="Anything other members should know"></textarea></label>
    `;
  }

  return `
    <p class="dialog-intro">Return <strong>${escapeHtml(item.assetCode)}</strong>. The username must match the current holder.</p>
    <label><span>Current holder’s username</span><input name="username" type="text" maxlength="80" autocomplete="username" required placeholder="Your username"></label>
    <label><span>Return note <small>(optional)</small></span><textarea name="returnNotes" maxlength="500" rows="3" placeholder="Condition, missing parts, or other notes"></textarea></label>
  `;
}

function renderDetail(item, members, { message = "" } = {}) {
  document.title = `${item.assetCode} · ${item.name} · PAIR Lab Equipment`;
  window.scrollTo({ top: 0, left: 0, behavior: "auto" });
  const components = item.components.length
    ? `
      <ul class="component-list">
        ${item.components.map((component) => `
          <li>
            <img data-equipment-photo src="${escapeHtml(component.photoUrl || placeholderPhotoUrl)}" alt="Photo of ${escapeHtml(component.name)}" loading="lazy">
            <div><strong>${escapeHtml(component.name)}</strong>${component.quantity > 1 ? `<span>Quantity ${component.quantity}</span>` : ""}</div>
            <span class="return-flag">${component.requiredOnReturn ? "Return with bundle" : "Optional"}</span>
          </li>
        `).join("")}
      </ul>
    `
    : `<p class="muted-copy">No bundle constituents have been recorded yet.</p>`;
  const reservations = item.reservations.length
    ? `
      <div class="reservation-list">
        ${item.reservations.map((reservation) => `
          <article>
            <div>
              <strong>${escapeHtml(reservation.memberName)}</strong>
              <p>${escapeHtml(formatDate(reservation.startsAt, { includeTime: true }))} → ${escapeHtml(formatDate(reservation.endsAt, { includeTime: true }) || "No end date")}</p>
            </div>
            <span>${reservation.canShare ? "May share" : "Reserved"}</span>
            ${reservation.sharingNotes ? `<p class="reservation-note">${escapeHtml(reservation.sharingNotes)}</p>` : ""}
          </article>
        `).join("")}
      </div>
    `
    : `<p class="muted-copy">No current or upcoming reservations.</p>`;
  const canAct = item.lifecycleStatus === "active" && item.availability !== "not_unboxed";
  const primaryAction = item.availability === "in_use"
    ? `<button class="primary-button" type="button" data-equipment-action="return">Return equipment</button>`
    : `<button class="primary-button" type="button" data-equipment-action="checkout">Check out now</button>`;
  const actionPanel = canAct
    ? `
      <section class="detail-section action-section">
        <div class="section-heading"><p class="eyebrow">Member actions</p><h2>Use this equipment</h2></div>
        <p>Select your name to reserve. Checkout and return use your typed username as a lightweight confirmation, not a password.</p>
        <div class="action-buttons">
          ${primaryAction}
          <button class="secondary-button" type="button" data-equipment-action="reserve">Reserve dates</button>
        </div>
      </section>
    `
    : `
      <section class="detail-section action-section unavailable-action">
        <div class="section-heading"><p class="eyebrow">Member actions</p><h2>Actions unavailable</h2></div>
        <p>${item.availability === "not_unboxed" ? "This item must be unboxed and marked available by an administrator before members can reserve or check it out." : `This record is marked ${escapeHtml(statusLabel(item.lifecycleStatus).toLocaleLowerCase("en-GB"))}. An administrator must reactivate it first.`}</p>
      </section>
    `;

  app.innerHTML = `
    <a class="back-link" href="./"><span aria-hidden="true">←</span> All equipment</a>
    ${message ? `<div class="action-confirmation" role="status">${escapeHtml(message)}</div>` : ""}
    <section class="detail-hero">
      <div class="detail-photo-frame"><img data-equipment-photo src="${escapeHtml(item.photoUrl || placeholderPhotoUrl)}" alt="Photo of ${escapeHtml(item.name)}"></div>
      <div class="detail-title">
        <div class="card-topline">
          <span class="asset-code">${escapeHtml(item.assetCode)}</span>
          ${statusBadge(item.availability)}
        </div>
        <p class="eyebrow">${escapeHtml(item.category)}</p>
        <h1>${escapeHtml(item.name)}</h1>
        ${item.publicSpecifications ? `<p class="hero-copy">${escapeHtml(item.publicSpecifications)}</p>` : ""}
      </div>
      <aside class="availability-card status-border-${escapeHtml(item.availability)}">
        <p class="overline">Current status</p>
        <h2>${escapeHtml(statusLabel(item.availability))}</h2>
        <p>${escapeHtml(availabilityMessage(item))}</p>
        <p class="advisory-note">Availability is informational. Confirm with the listed member when needed.</p>
      </aside>
    </section>

    <div class="detail-layout">
      <div class="detail-main">
        <section class="detail-section">
          <div class="section-heading"><p class="eyebrow">Record</p><h2>Equipment details</h2></div>
          <dl class="detail-list">
            ${detailDefinition("Asset code", item.assetCode)}
            ${detailDefinition("Category", item.category)}
            ${detailDefinition("Type", titleCase(item.itemType))}
            ${detailDefinition("Manufacturer", item.manufacturer)}
            ${detailDefinition("Model", item.model)}
            ${detailDefinition("Location", item.location)}
            ${detailDefinition("Condition", titleCase(item.condition))}
            ${detailDefinition("Purchase date", formatDate(item.purchaseDate))}
          </dl>
          ${item.publicNotes ? `<div class="record-note"><strong>Notes</strong><p>${escapeHtml(item.publicNotes)}</p></div>` : ""}
        </section>
        ${item.itemType === "bundle" ? `
          <section class="detail-section">
            <div class="section-heading"><p class="eyebrow">Bundle</p><h2>What to return together</h2></div>
            ${components}
          </section>
        ` : ""}
      </div>
      <aside class="detail-sidebar">
        ${actionPanel}
        <section class="detail-section compact-section">
          <div class="section-heading"><p class="eyebrow">Schedule</p><h2>Reservations</h2></div>
          ${reservations}
        </section>
        <section class="permalink-card">
          <h2>Equipment link</h2>
          <p>This page is the public record for ${escapeHtml(item.assetCode)}.</p>
          <button class="secondary-button" id="copy-link" type="button">Copy page link</button>
        </section>
      </aside>
    </div>
    <dialog class="action-dialog" id="action-dialog" aria-labelledby="action-dialog-title">
      <form id="action-form">
        <div class="dialog-heading">
          <div><p class="eyebrow">Member action</p><h2 id="action-dialog-title"></h2></div>
          <button class="icon-button" type="button" data-close-dialog aria-label="Close">×</button>
        </div>
        <div class="dialog-fields" id="action-dialog-fields"></div>
        <p class="form-error" id="action-error" role="alert" hidden></p>
        <div class="dialog-actions">
          <button class="secondary-button" type="button" data-close-dialog>Cancel</button>
          <button class="primary-button" id="action-submit" type="submit">Continue</button>
        </div>
      </form>
    </dialog>
  `;

  document.querySelector("#copy-link")?.addEventListener("click", async (event) => {
    const button = event.currentTarget;
    try {
      await navigator.clipboard.writeText(window.location.href);
      button.textContent = "Link copied";
    } catch {
      button.textContent = "Copy unavailable";
    }
    window.setTimeout(() => { button.textContent = "Copy page link"; }, 1800);
  });

  const dialog = document.querySelector("#action-dialog");
  const form = document.querySelector("#action-form");
  const fields = document.querySelector("#action-dialog-fields");
  const title = document.querySelector("#action-dialog-title");
  const submit = document.querySelector("#action-submit");
  const errorMessage = document.querySelector("#action-error");
  let activeAction = null;

  document.querySelectorAll("[data-equipment-action]").forEach((button) => {
    button.addEventListener("click", () => {
      activeAction = button.dataset.equipmentAction;
      const titles = { reserve: "Reserve equipment", checkout: "Check out equipment", return: "Return equipment" };
      const submitLabels = { reserve: "Save reservation", checkout: "Check out", return: "Mark as returned" };
      title.textContent = titles[activeAction];
      submit.textContent = submitLabels[activeAction];
      fields.innerHTML = actionDialogMarkup(activeAction, item, members);
      errorMessage.hidden = true;
      dialog.showModal();
      fields.querySelector("select, input, textarea")?.focus();
    });
  });

  document.querySelectorAll("[data-close-dialog]").forEach((button) => {
    button.addEventListener("click", () => dialog.close());
  });

  form?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!activeAction || !form.reportValidity()) return;
    const data = new FormData(form);
    const payloads = {
      reserve: {
        memberId: data.get("memberId"),
        username: data.get("username"),
        startsAt: isoDateTime(data.get("startsAt")),
        endsAt: isoDateTime(data.get("endsAt")),
        canShare: data.get("canShare") === "on",
        sharingNotes: data.get("sharingNotes") || null,
      },
      checkout: {
        username: data.get("username"),
        expectedReturnAt: isoDateTime(data.get("expectedReturnAt")),
        checkoutNotes: data.get("checkoutNotes") || null,
      },
      return: {
        username: data.get("username"),
        returnNotes: data.get("returnNotes") || null,
      },
    };
    const paths = {
      reserve: "reservations",
      checkout: "checkouts",
      return: "return",
    };
    const successMessages = {
      reserve: "Reservation saved.",
      checkout: "Equipment checked out.",
      return: "Equipment marked as returned.",
    };
    submit.disabled = true;
    submit.textContent = "Saving…";
    errorMessage.hidden = true;
    try {
      await postJson(`/api/v1/equipment/${encodeURIComponent(item.assetCode)}/${paths[activeAction]}`, payloads[activeAction]);
      dialog.close();
      await loadDetail(item.assetCode, successMessages[activeAction]);
    } catch (error) {
      errorMessage.textContent = error instanceof Error ? error.message : "The action could not be saved.";
      errorMessage.hidden = false;
      submit.disabled = false;
      submit.textContent = { reserve: "Save reservation", checkout: "Check out", return: "Mark as returned" }[activeAction];
    }
  });
}

async function loadDetail(assetCode, message = "") {
  const [{ item }, { members }] = await Promise.all([
    fetchJson(`/api/v1/equipment/${encodeURIComponent(assetCode)}`),
    fetchJson("/api/v1/members"),
  ]);
  renderDetail(item, members, { message });
}

async function loadCatalogue(message = "") {
  const [equipment, proposals, members] = await Promise.all([
    fetchJson("/api/v1/equipment"),
    fetchJson("/api/v1/proposals"),
    fetchJson("/api/v1/members"),
  ]);
  renderCatalogue(equipment, proposals, members, { message });
}

async function resolveNfcToken(token) {
  const { label } = await fetchJson(`/api/v1/nfc/${encodeURIComponent(token)}`);
  const itemUrl = new URL(window.location.href);
  itemUrl.search = "";
  itemUrl.searchParams.set("item", label.assetCode);
  window.history.replaceState({}, "", itemUrl);
  return label.assetCode;
}

async function start() {
  const searchParams = new URLSearchParams(window.location.search);
  const nfcToken = searchParams.get("t")?.trim();
  let assetCode = searchParams.get("item")?.trim();
  try {
    if (nfcToken) assetCode = await resolveNfcToken(nfcToken);
    if (assetCode) {
      await loadDetail(assetCode);
    } else {
      await loadCatalogue();
    }
  } catch (error) {
    renderError(error instanceof Error ? error.message : "Unknown inventory error.");
  }
}

start();
