const { extractNumericLeaves, diffNumericLeaves } = require("./usageDiff");

describe("extractNumericLeaves", () => {
  test("UD-001: extracts top-level and nested numeric fields, ignores strings/arrays", () => {
    const obj = {
      requests: 42,
      plan: "free",
      limits: { requestsPerMonth: 1000, aiRequestsPerMonth: 200 },
      billingPeriod: { start: "2026-07-01", end: "2026-07-31" },
      tags: [1, 2, 3],
    };

    expect(extractNumericLeaves(obj)).toEqual({
      requests: 42,
      "limits.requestsPerMonth": 1000,
      "limits.aiRequestsPerMonth": 200,
    });
  });
});

describe("diffNumericLeaves", () => {
  test("UD-010: reports only fields that changed, with correct delta", () => {
    const before = { requests: 10, aiRequests: 2, limits: { requestsPerMonth: 1000 } };
    const after = { requests: 11, aiRequests: 2, limits: { requestsPerMonth: 1000 } };

    expect(diffNumericLeaves(before, after)).toEqual({ requests: 1 });
  });

  test("UD-011: handles a field appearing only in `after` as a change from 0", () => {
    const before = { requests: 5 };
    const after = { requests: 5, aiRequests: 1 };

    expect(diffNumericLeaves(before, after)).toEqual({ aiRequests: 1 });
  });

  test("UD-012: returns an empty object when nothing numeric changed", () => {
    const before = { requests: 5, plan: "free" };
    const after = { requests: 5, plan: "pro" };

    expect(diffNumericLeaves(before, after)).toEqual({});
  });
});
