/**
 * QA suite for GET /v1/forecast (WeatherAI developer API).
 *
 * Per docs, /v1/forecast is a "convenience alias" for /v1/weather accepting
 * identical parameters and returning the identical response shape. This
 * suite mirrors weather.test.js's categories (see that file for the fuller
 * negative/boundary matrix and the AI-quota rationale) plus one parity
 * check confirming the alias behaves as documented.
 *
 * Independently runnable: `npm run test:forecast`.
 *
 * No-key behavior: same as weather.test.js -- every describe block is
 * gated on `hasApiKey` and skips (not fails) when no key is configured.
 */

const { api, authHeader, hasApiKey } = require("./helpers/apiClient");
const { assertValidWeatherSchema, assertErrorShape } = require("./helpers/assertions");

const ENDPOINT = "/v1/forecast";
const VALID_PARAMS = { lat: -1.2921, lon: 36.8219 };
const maybeDescribe = hasApiKey ? describe : describe.skip;

maybeDescribe("GET /v1/forecast - happy path", () => {
  test("FC-001: valid lat/lon + valid auth returns 200 with full schema", async () => {
    const res = await api()
      .get(ENDPOINT)
      .query({ ...VALID_PARAMS, ai: false })
      .set("Authorization", authHeader());

    expect(res.status).toBe(200);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    assertValidWeatherSchema(res.body, { aiExpected: false });
  });

  test("FC-002: days param controls forecast length (Free tier max = 7)", async () => {
    const res = await api()
      .get(ENDPOINT)
      .query({ ...VALID_PARAMS, ai: false, days: 5 })
      .set("Authorization", authHeader());

    expect(res.status).toBe(200);
    expect(res.body.daily.length).toBe(5);
  });

  test("FC-003: /v1/forecast and /v1/weather return equivalent data for identical params (alias parity)", async () => {
    const params = { ...VALID_PARAMS, ai: false, days: 3 };
    const [forecastRes, weatherRes] = await Promise.all([
      api().get("/v1/forecast").query(params).set("Authorization", authHeader()),
      api().get("/v1/weather").query(params).set("Authorization", authHeader()),
    ]);

    expect(forecastRes.status).toBe(200);
    expect(weatherRes.status).toBe(200);
    expect(forecastRes.body.daily.map((d) => d.date)).toEqual(
      weatherRes.body.daily.map((d) => d.date)
    );
    expect(forecastRes.body.daily.length).toBe(weatherRes.body.daily.length);
  });
});

maybeDescribe("GET /v1/forecast - auth negative cases", () => {
  test("FC-010: missing Authorization header returns 401", async () => {
    const res = await api().get(ENDPOINT).query(VALID_PARAMS);

    expect(res.status).toBe(401);
    assertErrorShape(res.body);
  });

  test("FC-011: invalid/garbage API key returns 401", async () => {
    const res = await api()
      .get(ENDPOINT)
      .query(VALID_PARAMS)
      .set("Authorization", "Bearer wai_ffffffffffffffffffffffffffffffff");

    expect(res.status).toBe(401);
    assertErrorShape(res.body);
  });

  test("FC-012: wrong key prefix (not wai_) returns 401", async () => {
    const res = await api()
      .get(ENDPOINT)
      .query(VALID_PARAMS)
      .set("Authorization", "Bearer sk_someotherformatkey123");

    expect(res.status).toBe(401);
    assertErrorShape(res.body);
  });
});

maybeDescribe("GET /v1/forecast - param negative cases", () => {
  test("FC-020: missing lat returns 400", async () => {
    const res = await api()
      .get(ENDPOINT)
      .query({ lon: VALID_PARAMS.lon })
      .set("Authorization", authHeader());

    expect(res.status).toBe(400);
    assertErrorShape(res.body);
  });

  test("FC-021: missing lon returns 400", async () => {
    const res = await api()
      .get(ENDPOINT)
      .query({ lat: VALID_PARAMS.lat })
      .set("Authorization", authHeader());

    expect(res.status).toBe(400);
    assertErrorShape(res.body);
  });

  test("FC-022: non-numeric lat returns 400", async () => {
    const res = await api()
      .get(ENDPOINT)
      .query({ lat: "abc", lon: VALID_PARAMS.lon })
      .set("Authorization", authHeader());

    expect(res.status).toBe(400);
    assertErrorShape(res.body);
  });

  test("FC-023: lat > 90 (out of range) returns 400", async () => {
    const res = await api()
      .get(ENDPOINT)
      .query({ lat: 91, lon: VALID_PARAMS.lon })
      .set("Authorization", authHeader());

    expect(res.status).toBe(400);
    assertErrorShape(res.body);
  });

  test("FC-024: lon < -180 (out of range) returns 400", async () => {
    const res = await api()
      .get(ENDPOINT)
      .query({ lat: VALID_PARAMS.lat, lon: -181 })
      .set("Authorization", authHeader());

    expect(res.status).toBe(400);
    assertErrorShape(res.body);
  });

  test("FC-025: empty string lat returns 400", async () => {
    const res = await api()
      .get(ENDPOINT)
      .query({ lat: "", lon: VALID_PARAMS.lon })
      .set("Authorization", authHeader());

    expect(res.status).toBe(400);
    assertErrorShape(res.body);
  });
});

maybeDescribe("GET /v1/forecast - boundary cases", () => {
  test.each([
    ["north pole", 90, 0],
    ["south pole", -90, 0],
    ["equator/prime meridian", 0, 0],
  ])("FC-03x: exact boundary coordinate (%s: lat=%d, lon=%d) returns 200", async (_label, lat, lon) => {
    const res = await api()
      .get(ENDPOINT)
      .query({ lat, lon, ai: false })
      .set("Authorization", authHeader());

    expect(res.status).toBe(200);
    assertValidWeatherSchema(res.body, { aiExpected: false });
  });
});

maybeDescribe("GET /v1/forecast - consistency", () => {
  test("FC-040: identical requests fired in quick succession return structurally consistent data", async () => {
    const [first, second] = await Promise.all([
      api().get(ENDPOINT).query({ ...VALID_PARAMS, ai: false }).set("Authorization", authHeader()),
      api().get(ENDPOINT).query({ ...VALID_PARAMS, ai: false }).set("Authorization", authHeader()),
    ]);

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(second.body.daily.map((d) => d.date)).toEqual(first.body.daily.map((d) => d.date));
  });
});

maybeDescribe("GET /v1/forecast - rate limiting", () => {
  // Same rationale as weather.test.js: observe headers, don't exhaust the
  // Free tier's 1,000 req/month quota.
  test("FC-050: response includes well-formed X-RateLimit-* headers", async () => {
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
    expect(remaining).toBeLessThanOrEqual(limit);
  });
});

maybeDescribe("GET /v1/forecast - error response quality", () => {
  test("FC-060: error responses are valid JSON with a consistent {error, message} shape", async () => {
    const res = await api().get(ENDPOINT).query(VALID_PARAMS); // 401: no auth

    expect(res.status).toBeGreaterThanOrEqual(400);
    expect(res.headers["content-type"]).toMatch(/application\/json/);
    assertErrorShape(res.body);
  });
});
