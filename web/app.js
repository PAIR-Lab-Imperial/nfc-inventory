const app = document.querySelector("#app");
const apiBaseUrl = window.NFC_INVENTORY_CONFIG?.apiBaseUrl?.replace(/\/$/, "");

const statusLabels = Object.freeze({
  free: "Available",
  reserved: "Reserved",
  in_use: "In use",
  maintenance: "Maintenance",
  missing: "Missing",
  retired: "Retired",
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
      <div class="category-mark" aria-hidden="true">${escapeHtml(item.assetCode.split("-")[0])}</div>
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

function renderCatalogue(data) {
  document.title = "PAIR Lab Equipment";
  const total = data.items.length;
  const available = data.items.filter((item) => item.availability === "free").length;
  const allocated = data.items.filter((item) => ["reserved", "in_use"].includes(item.availability)).length;
  const categoryOptions = data.categories
    .filter((category) => category.equipmentCount > 0)
    .map((category) => `<option value="${escapeHtml(category.name)}">${escapeHtml(category.name)} (${category.equipmentCount})</option>`)
    .join("");

  app.innerHTML = `
    <section class="catalogue-hero">
      <div>
        <p class="eyebrow">NFC inventory</p>
        <h1>Find the equipment you need.</h1>
        <p class="hero-copy">Search the PAIR Lab collection, check live availability, and open a complete record for each item or bundle.</p>
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
}

function detailDefinition(label, value) {
  if (value === null || value === undefined || value === "") return "";
  return `<div><dt>${escapeHtml(label)}</dt><dd>${escapeHtml(value)}</dd></div>`;
}

function availabilityMessage(item) {
  if (item.availability === "free") return "Available now.";
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

function renderDetail(item) {
  document.title = `${item.assetCode} · ${item.name} · PAIR Lab Equipment`;
  const components = item.components.length
    ? `
      <ul class="component-list">
        ${item.components.map((component) => `
          <li>
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

  app.innerHTML = `
    <a class="back-link" href="./"><span aria-hidden="true">←</span> All equipment</a>
    <section class="detail-hero">
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
}

async function start() {
  const assetCode = new URLSearchParams(window.location.search).get("item")?.trim();
  try {
    if (assetCode) {
      const { item } = await fetchJson(`/api/v1/equipment/${encodeURIComponent(assetCode)}`);
      renderDetail(item);
    } else {
      renderCatalogue(await fetchJson("/api/v1/equipment"));
    }
  } catch (error) {
    renderError(error instanceof Error ? error.message : "Unknown inventory error.");
  }
}

start();
