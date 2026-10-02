export function matchesAdminFilters(rowValues, filters) {
  return filters.every(({ key, value, mode = "exact" }) => {
    const normalizedFilter = String(value || "").trim().toLocaleLowerCase("en-GB");
    if (!normalizedFilter) return true;
    const normalizedRow = String(rowValues[key] || "").toLocaleLowerCase("en-GB");
    return mode === "contains" ? normalizedRow.includes(normalizedFilter) : normalizedRow === normalizedFilter;
  });
}

