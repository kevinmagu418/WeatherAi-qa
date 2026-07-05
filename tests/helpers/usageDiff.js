/**
 * The docs describe GET /v1/usage only in prose -- "Returns request counts,
 * AI request counts, plan limits, and billing period start/end" -- with no
 * field names, nesting, or example JSON. Rather than guess a field name like
 * `ai_requests` and risk a false negative if the real key differs, these
 * helpers diff two /v1/usage snapshots structurally: they walk every numeric
 * leaf in the response and report which ones changed and by how much.
 *
 * This lets the quota test in usage.test.js prove "the AI flag affects a
 * distinct counter from the general request counter" without hardcoding the
 * real API's exact schema. Once a live payload is observed, the actual field
 * name(s) should be documented in TEST_PLAN.md and this heuristic can be
 * tightened to an exact key if desired.
 */

function extractNumericLeaves(obj, prefix = "") {
  const out = {};
  if (!obj || typeof obj !== "object") return out;

  for (const [key, value] of Object.entries(obj)) {
    const path = prefix ? `${prefix}.${key}` : key;
    if (typeof value === "number") {
      out[path] = value;
    } else if (value && typeof value === "object" && !Array.isArray(value)) {
      Object.assign(out, extractNumericLeaves(value, path));
    }
  }
  return out;
}

/**
 * Returns { [path]: delta } for every numeric leaf whose value changed
 * between `before` and `after` (present in either snapshot, missing treated
 * as 0).
 */
function diffNumericLeaves(before, after) {
  const b = extractNumericLeaves(before);
  const a = extractNumericLeaves(after);
  const diff = {};

  for (const key of new Set([...Object.keys(b), ...Object.keys(a)])) {
    const delta = (a[key] ?? 0) - (b[key] ?? 0);
    if (delta !== 0) diff[key] = delta;
  }
  return diff;
}

module.exports = { extractNumericLeaves, diffNumericLeaves };
