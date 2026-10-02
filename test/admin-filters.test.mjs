import assert from "node:assert/strict";
import test from "node:test";
import { matchesAdminFilters } from "../web/admin-filters.js";

const equipment = {
  search: "ROB-006 Reachy Mini Wireless Pollen Robotics Robots",
  category: "Robots",
  type: "bundle",
  availability: "not_unboxed",
};

test("administrator filters combine partial search with exact selections", () => {
  assert.equal(matchesAdminFilters(equipment, [
    { key: "search", value: "reachy mini", mode: "contains" },
    { key: "category", value: "robots" },
    { key: "type", value: "bundle" },
    { key: "availability", value: "not_unboxed" },
  ]), true);
  assert.equal(matchesAdminFilters(equipment, [
    { key: "search", value: "reachy", mode: "contains" },
    { key: "availability", value: "free" },
  ]), false);
});

test("blank administrator filters match all rows", () => {
  assert.equal(matchesAdminFilters(equipment, [
    { key: "search", value: "", mode: "contains" },
    { key: "category", value: "" },
  ]), true);
});

