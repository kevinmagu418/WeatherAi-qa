/**
 * QA suite for GET /v1/usage (WeatherAI developer API).
 *
 * Schema caveat: the docs describe this endpoint only in prose --
 * "Returns request counts, AI request counts, plan limits, and billing
 * period start/end" -- with no field names, nesting, or example JSON shown.
 * UG-001 therefore only asserts the documented *shape category* (a non-empty
 * JSON object) rather than guessing exact keys; the PENDING marker should be
 * replaced with the real field names once a live payload is observed.
 *
 * UG-010 proves the ai=true/false quota split described in the docs
 * ("ai=false ... preserve AI quota") without hardcoding a guessed field name
 * for the AI counter -- see tests/helpers/usageDiff.js for why.
 *
 * No-key behavior: same as weather.test.js -- every describe block is
 * gated on `hasApiKey` and skips (not fails) when no key is configured.
 */

const { api, authHeader, hasApiKey } = require("./helpers/apiClient");
const { assertErrorShape } = require("./helpers/assertions");
const { diffNumericLeaves } = require("./helpers/usageDiff");

const ENDPOINT = "/v1/usage";
const WEATHER_ENDPOINT = "/v1/weather";
const VALID_PARAMS = { lat: -1.2921, lon: 36.8219 };
const maybeDescribe = hasApiKey ? describe : describe.skip;

function getUsage() {
  return api().get(ENDPOINT).set("Authorization", authHeader());
}

maybeDescribe("GET /v1/usage - happy path", () => {
  test("UG-001: valid auth returns 200 with a non-empty JSON object", async () => {
    const res = await getUsage();

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    expect(res.body).toBeInstanceOf(Object);
    expect(Array.isArray(res.body)).toBe(false);
    expect(Object.keys(res.body).length).toBeGreaterThan(0);

    // PENDING -- awaiting API key: docs do not publish exact field names for
    // request counts / AI request counts / plan limits / billing period.
    // Once a live response is captured, replace this block with concrete
    // assertions, e.g.:
    //   expect(typeof res.body.requests_used).toBe("number");
    //   expect(typeof res.body.ai_requests_used).toBe("number");
    //   expect(typeof res.body.plan).toBe("string");
    //   expect(typeof res.body.billing_period.start).toBe("string");
    //   expect(typeof res.body.billing_period.end).toBe("string");
  });
});

maybeDescribe("GET /v1/usage - auth negative cases", () => {
  test("UG-002: missing Authorization header returns 401", async () => {
    const res = await api().get(ENDPOINT);

    expect(res.status).toBe(401);
    assertErrorShape(res.body);
  });
});

maybeDescribe("GET /v1/usage - AI quota accounting (cross-endpoint)", () => {
  // Strategy: snapshot /v1/usage, make one /v1/weather call with ai=false,
  // snapshot again, make one call with ai=true, snapshot again. Each window
  // contains exactly one weather call plus the /v1/usage check itself, so
  // any counter that increments in BOTH windows is most likely the general
  // request counter (or noise from checking usage), while a counter that
  // increments ONLY in the ai=true window is the AI-specific counter the
  // docs describe. This avoids assuming a specific field name.
  test("UG-010: ai=true increments an AI-specific counter that ai=false does not", async () => {
    const before = await getUsage();
    expect(before.status).toBe(200);

    const falseCall = await api()
      .get(WEATHER_ENDPOINT)
      .query({ ...VALID_PARAMS, ai: false })
      .set("Authorization", authHeader());
    expect(falseCall.status).toBe(200);

    const afterFalse = await getUsage();
    expect(afterFalse.status).toBe(200);

    const trueCall = await api()
      .get(WEATHER_ENDPOINT)
      .query({ ...VALID_PARAMS, ai: true })
      .set("Authorization", authHeader());
    expect(trueCall.status).toBe(200);

    const afterTrue = await getUsage();
    expect(afterTrue.status).toBe(200);

    const deltaFalseWindow = diffNumericLeaves(before.body, afterFalse.body);
    const deltaTrueWindow = diffNumericLeaves(afterFalse.body, afterTrue.body);

    // Fields that grew in the ai=true window but did NOT grow in the
    // ai=false window are the AI-quota candidate(s).
    const aiCandidateFields = Object.keys(deltaTrueWindow).filter(
      (key) => deltaTrueWindow[key] > 0 && !(deltaFalseWindow[key] > 0)
    );

    expect(aiCandidateFields.length).toBeGreaterThan(0);
    for (const field of aiCandidateFields) {
      expect(deltaTrueWindow[field]).toBe(1);
    }

    // eslint-disable-next-line no-console
    console.info(
      "UG-010 observed AI-quota candidate field(s):",
      aiCandidateFields,
      "-- record the real field name in TEST_PLAN.md once confirmed."
    );
  });
});
