/**
 * QA suite for GET /v1/weather (WeatherAI developer API).
 *
 * Runs against the real base URL (https://api.weather-ai.co) using a live
 * API key from process.env.WEATHERAI_API_KEY -- see README.md for setup.
 *
 * Quota note: the Free tier allows only 1,000 requests/month and 200 AI
 * requests/month (X-RateLimit-* headers, per docs). To avoid burning
 * quota on every CI run, most requests below pass `ai=false` and only the
 * happy-path test exercises the default `ai=true` behavior. The rate-limit
 * test inspects headers on a single request rather than firing enough
 * traffic to actually trip the 429 -- see TEST_PLAN.md for the full
 * rationale.
 */

const { api, authHeader } = require("./helpers/apiClient");
const { assertValidWeatherSchema, assertErrorShape } = require("./helpers/assertions");

const ENDPOINT = "/v1/weather";
const VALID_PARAMS = { lat: -1.2921, lon: 36.8219 };

describe("GET /v1/weather - happy path", () => {
  test("WX-001: valid lat/lon + valid auth returns 200 with full schema (incl. AI summary)", async () => {
    const res = await api()
      .get(ENDPOINT)
      .query(VALID_PARAMS)
      .set("Authorization", authHeader());

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    assertValidWeatherSchema(res.body, { aiExpected: true });
  });

  test("WX-002: ai=false returns 200 without a summary field, preserving AI quota", async () => {
    const res = await api()
      .get(ENDPOINT)
      .query({ ...VALID_PARAMS, ai: false })
      .set("Authorization", authHeader());

    expect(res.status).toBe(200);
    assertValidWeatherSchema(res.body, { aiExpected: false });
    expect(res.body.summary).toBeUndefined();
  });

  test("WX-003: units=imperial returns 200 with plausible Fahrenheit-range values", async () => {
    const res = await api()
      .get(ENDPOINT)
      .query({ ...VALID_PARAMS, ai: false, units: "imperial" })
      .set("Authorization", authHeader());

    expect(res.status).toBe(200);
    assertValidWeatherSchema(res.body, { aiExpected: false });
    // Sanity range wide enough to cover any real-world surface temperature.
    expect(res.body.current.temperature).toBeGreaterThan(-100);
    expect(res.body.current.temperature).toBeLessThan(150);
  });

  test("WX-004: days param controls forecast length (Free tier max = 7)", async () => {
    const res = await api()
      .get(ENDPOINT)
      .query({ ...VALID_PARAMS, ai: false, days: 3 })
      .set("Authorization", authHeader());

    expect(res.status).toBe(200);
    expect(res.body.forecast.length).toBe(3);
  });
});

describe("GET /v1/weather - auth negative cases", () => {
  test("WX-010: missing Authorization header returns 401 with standard error shape", async () => {
    const res = await api().get(ENDPOINT).query(VALID_PARAMS);

    expect(res.status).toBe(401);
    assertErrorShape(res.body);
  });

  test("WX-011: malformed Bearer token (missing token value) returns 401", async () => {
    const res = await api()
      .get(ENDPOINT)
      .query(VALID_PARAMS)
      .set("Authorization", "Bearer ");

    expect(res.status).toBe(401);
    assertErrorShape(res.body);
  });

  test("WX-012: malformed Authorization scheme (no 'Bearer' prefix) returns 401", async () => {
    const res = await api()
      .get(ENDPOINT)
      .query(VALID_PARAMS)
      .set("Authorization", authHeader().replace("Bearer ", ""));

    expect(res.status).toBe(401);
    assertErrorShape(res.body);
  });

  test("WX-013: invalid/garbage API key returns 401", async () => {
    const res = await api()
      .get(ENDPOINT)
      .query(VALID_PARAMS)
      .set("Authorization", "Bearer wai_ffffffffffffffffffffffffffffffff");

    expect(res.status).toBe(401);
    assertErrorShape(res.body);
  });

  test("WX-014: wrong key prefix (not wai_) returns 401", async () => {
    const res = await api()
      .get(ENDPOINT)
      .query(VALID_PARAMS)
      .set("Authorization", "Bearer sk_someotherformatkey123");

    expect(res.status).toBe(401);
    assertErrorShape(res.body);
  });
});

describe("GET /v1/weather - param negative cases", () => {
  test("WX-020: missing lat returns 400", async () => {
    const res = await api()
      .get(ENDPOINT)
      .query({ lon: VALID_PARAMS.lon })
      .set("Authorization", authHeader());

    expect(res.status).toBe(400);
    assertErrorShape(res.body);
  });

  test("WX-021: missing lon returns 400", async () => {
    const res = await api()
      .get(ENDPOINT)
      .query({ lat: VALID_PARAMS.lat })
      .set("Authorization", authHeader());

    expect(res.status).toBe(400);
    assertErrorShape(res.body);
  });

  test("WX-022: missing both lat and lon returns 400", async () => {
    const res = await api().get(ENDPOINT).set("Authorization", authHeader());

    expect(res.status).toBe(400);
    assertErrorShape(res.body);
  });

  test("WX-023: non-numeric lat returns 400", async () => {
    const res = await api()
      .get(ENDPOINT)
      .query({ lat: "abc", lon: VALID_PARAMS.lon })
      .set("Authorization", authHeader());

    expect(res.status).toBe(400);
    assertErrorShape(res.body);
  });

  test("WX-024: non-numeric lon returns 400", async () => {
    const res = await api()
      .get(ENDPOINT)
      .query({ lat: VALID_PARAMS.lat, lon: "xyz" })
      .set("Authorization", authHeader());

    expect(res.status).toBe(400);
    assertErrorShape(res.body);
  });

  test("WX-025: lat > 90 (out of range) returns 400", async () => {
    const res = await api()
      .get(ENDPOINT)
      .query({ lat: 91, lon: VALID_PARAMS.lon })
      .set("Authorization", authHeader());

    expect(res.status).toBe(400);
    assertErrorShape(res.body);
  });

  test("WX-026: lat < -90 (out of range) returns 400", async () => {
    const res = await api()
      .get(ENDPOINT)
      .query({ lat: -91, lon: VALID_PARAMS.lon })
      .set("Authorization", authHeader());

    expect(res.status).toBe(400);
    assertErrorShape(res.body);
  });

  test("WX-027: lon > 180 (out of range) returns 400", async () => {
    const res = await api()
      .get(ENDPOINT)
      .query({ lat: VALID_PARAMS.lat, lon: 181 })
      .set("Authorization", authHeader());

    expect(res.status).toBe(400);
    assertErrorShape(res.body);
  });

  test("WX-028: lon < -180 (out of range) returns 400", async () => {
    const res = await api()
      .get(ENDPOINT)
      .query({ lat: VALID_PARAMS.lat, lon: -181 })
      .set("Authorization", authHeader());

    expect(res.status).toBe(400);
    assertErrorShape(res.body);
  });

  test("WX-029: empty string lat returns 400", async () => {
    const res = await api()
      .get(ENDPOINT)
      .query({ lat: "", lon: VALID_PARAMS.lon })
      .set("Authorization", authHeader());

    expect(res.status).toBe(400);
    assertErrorShape(res.body);
  });

  test("WX-030: empty string lon returns 400", async () => {
    const res = await api()
      .get(ENDPOINT)
      .query({ lat: VALID_PARAMS.lat, lon: "" })
      .set("Authorization", authHeader());

    expect(res.status).toBe(400);
    assertErrorShape(res.body);
  });

  test("WX-031: days requested above Free-tier max (8) either clamps or 400s -- never silently succeeds with >7 days", async () => {
    const res = await api()
      .get(ENDPOINT)
      .query({ ...VALID_PARAMS, ai: false, days: 8 })
      .set("Authorization", authHeader());

    if (res.status === 200) {
      expect(res.body.forecast.length).toBeLessThanOrEqual(7);
    } else {
      expect(res.status).toBe(400);
      assertErrorShape(res.body);
    }
  });
});

describe("GET /v1/weather - boundary cases", () => {
  test.each([
    ["north pole", 90, 0],
    ["south pole", -90, 0],
    ["date line east", 0, 180],
    ["date line west", 0, -180],
    ["equator/prime meridian", 0, 0],
  ])("WX-04x: exact boundary coordinate (%s: lat=%d, lon=%d) returns 200", async (_label, lat, lon) => {
    const res = await api()
      .get(ENDPOINT)
      .query({ lat, lon, ai: false })
      .set("Authorization", authHeader());

    expect(res.status).toBe(200);
    assertValidWeatherSchema(res.body, { aiExpected: false });
  });

  test("WX-050: high-precision decimal coordinates are accepted and returns 200", async () => {
    const res = await api()
      .get(ENDPOINT)
      .query({ lat: -1.292066123456789, lon: 36.821945987654321, ai: false })
      .set("Authorization", authHeader());

    expect(res.status).toBe(200);
    assertValidWeatherSchema(res.body, { aiExpected: false });
  });
});

describe("GET /v1/weather - consistency", () => {
  test("WX-060: identical requests fired in quick succession return structurally consistent data", async () => {
    const [first, second] = await Promise.all([
      api().get(ENDPOINT).query({ ...VALID_PARAMS, ai: false }).set("Authorization", authHeader()),
      api().get(ENDPOINT).query({ ...VALID_PARAMS, ai: false }).set("Authorization", authHeader()),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    assertValidWeatherSchema(first.body, { aiExpected: false });
    assertValidWeatherSchema(second.body, { aiExpected: false });

    // Same coordinates, seconds apart -> forecast length and structure
    // should match; temperature/condition should be near-identical (not
    // necessarily bit-for-bit if the upstream provider re-samples).
    expect(second.body.forecast.length).toBe(first.body.forecast.length);
    expect(second.body.forecast.map((d) => d.date)).toEqual(first.body.forecast.map((d) => d.date));
  });

  test("WX-061: forecast dates are valid, unique, and in ascending order", async () => {
    const res = await api()
      .get(ENDPOINT)
      .query({ ...VALID_PARAMS, ai: false })
      .set("Authorization", authHeader());

    expect(res.status).toBe(200);
    const dates = res.body.forecast.map((d) => new Date(d.date).getTime());
    expect(dates.every((t) => !Number.isNaN(t))).toBe(true);

    const sorted = [...dates].sort((a, b) => a - b);
    expect(dates).toEqual(sorted);
    expect(new Set(dates).size).toBe(dates.length);
  });
});

describe("GET /v1/weather - rate limiting", () => {
  // We deliberately do NOT attempt to exhaust the 1,000 req/month Free
  // quota here -- doing so would burn the assessment's only API key and
  // block further exploratory testing. Instead we verify the rate-limit
  // headers are present and internally sane on a single request. See
  // TEST_PLAN.md "Rate limiting" section for the full rationale.
  test("WX-070: response includes well-formed X-RateLimit-* headers", async () => {
    const res = await api()
      .get(ENDPOINT)
      .query({ ...VALID_PARAMS, ai: false })
      .set("Authorization", authHeader());

    expect(res.status).toBe(200);

    const limit = Number(res.headers["x-ratelimit-limit"]);
    const remaining = Number(res.headers["x-ratelimit-remaining"]);
    const reset = Number(res.headers["x-ratelimit-reset"]);

    expect(Number.isNaN(limit)).toBe(false);
    expect(Number.isNaN(remaining)).toBe(false);
    expect(Number.isNaN(reset)).toBe(false);

    expect(limit).toBeGreaterThan(0);
    expect(remaining).toBeGreaterThanOrEqual(0);
    expect(remaining).toBeLessThanOrEqual(limit);
    // Reset should be a plausible Unix timestamp (seconds) in the future,
    // within the documented 30-day rolling window.
    const nowSeconds = Date.now() / 1000;
    expect(reset).toBeGreaterThan(nowSeconds);
    expect(reset).toBeLessThan(nowSeconds + 31 * 24 * 60 * 60);
  });

  test("WX-071: X-RateLimit-Remaining decrements by one across two sequential calls", async () => {
    const first = await api()
      .get(ENDPOINT)
      .query({ ...VALID_PARAMS, ai: false })
      .set("Authorization", authHeader());
    const second = await api()
      .get(ENDPOINT)
      .query({ ...VALID_PARAMS, ai: false })
      .set("Authorization", authHeader());

    const firstRemaining = Number(first.headers["x-ratelimit-remaining"]);
    const secondRemaining = Number(second.headers["x-ratelimit-remaining"]);

    expect(secondRemaining).toBe(firstRemaining - 1);
  });
});

describe("GET /v1/weather - error response quality", () => {
  test("WX-080: 400/401 errors never return HTTP 200 with an error embedded in the body", async () => {
    const res = await api().get(ENDPOINT).query({ lon: VALID_PARAMS.lon });
    // No auth header AND missing lat -- whichever the API validates first,
    // it must not be a 200.
    expect(res.status).not.toBe(200);
    expect(res.status).toBeGreaterThanOrEqual(400);
  });

  test("WX-081: error responses are valid JSON with a consistent {error, message} shape across failure modes", async () => {
    const responses = await Promise.all([
      api().get(ENDPOINT).query(VALID_PARAMS), // 401: no auth
      api().get(ENDPOINT).query({ lon: VALID_PARAMS.lon }).set("Authorization", authHeader()), // 400: missing lat
      api()
        .get(ENDPOINT)
        .query({ lat: 999, lon: VALID_PARAMS.lon })
        .set("Authorization", authHeader()), // 400: out of range
    ]);

    for (const res of responses) {
      expect(res.status).toBeGreaterThanOrEqual(400);
      expect(res.headers["content-type"]).toMatch(/application\/json/);
      assertErrorShape(res.body);
    }
  });
});
