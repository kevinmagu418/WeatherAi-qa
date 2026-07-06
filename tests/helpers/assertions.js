/**
 * Shared schema assertions for /v1/weather and /v1/forecast.
 *
 * https://weather-ai.co/docs documents this shape:
 *
 * {
 *   "current": { "temperature": number, "condition": string, "humidity": number, "windSpeed": number },
 *   "forecast": [ { "date": string, "maxTemp": number, "minTemp": number, "condition": string, "rainProbability": number } ],
 *   "summary": string   // present when the `ai` param is true (default)
 * }
 *
 * Live testing against a real key (2026-07-06) found the actual response
 * does NOT match this -- it looks like an undocumented passthrough of an
 * upstream provider's native shape instead of the transformed contract the
 * docs describe. See REPORT.md "Response schema does not match published
 * docs" (High severity) for the full writeup. The real shape:
 *
 * {
 *   "current": { "temperature": number, "windspeed": number, "winddirection": number,
 *                 "weathercode": number, "time": string, "interval": number, "is_day": 0|1 },
 *   "daily": [ { "date": string, "temp_max": number, "temp_min": number,
 *                "precipitation": number, "weathercode": number } ],
 *   "hourly": [ ... ],  // undocumented, present on every response
 *   "ai_summary": string | null  // present regardless of `ai`; observed always null -- see REPORT.md
 * }
 *
 * Notably absent from the real payload: `current.condition` (string) and
 * `current.humidity` -- neither exists in any observed live response, so
 * they are not asserted here (asserting a field that provably never exists
 * would just make every test fail forever for no diagnostic value; the gap
 * itself is reported in REPORT.md instead).
 */

function assertValidWeatherSchema(body, { aiExpected = true } = {}) {
  expect(body).toBeInstanceOf(Object);

  expect(body).toHaveProperty("current");
  const { current } = body;
  expect(typeof current.temperature).toBe("number");
  expect(typeof current.weathercode).toBe("number");
  expect(typeof current.windspeed).toBe("number");
  expect(typeof current.winddirection).toBe("number");

  expect(Array.isArray(body.daily)).toBe(true);
  expect(body.daily.length).toBeGreaterThan(0);
  for (const day of body.daily) {
    expect(typeof day.date).toBe("string");
    expect(typeof day.temp_max).toBe("number");
    expect(typeof day.temp_min).toBe("number");
    expect(typeof day.weathercode).toBe("number");
    expect(typeof day.precipitation).toBe("number");
  }

  if (aiExpected) {
    // Per docs, `ai=true` (the default) should populate an AI-generated
    // summary. Live testing found `ai_summary` is `null` on every request
    // observed, `ai=true` or not -- this assertion is intentionally left
    // matching the documented contract so it keeps failing (visibly) until
    // that's fixed upstream, rather than being loosened to hide it. See
    // REPORT.md "AI summary never populates" (High severity).
    expect(typeof body.ai_summary).toBe("string");
    expect(body.ai_summary.length).toBeGreaterThan(0);
  } else {
    expect(body.ai_summary == null).toBe(true);
  }
}

/**
 * Docs state the error shape is { "error": "error_code", "message": "..." }.
 * Live testing (2026-07-06) found every error response is actually a single
 * { "error": "<human-readable message>" } field -- there is no separate
 * `message` field on any observed 401/400 response. See REPORT.md
 * "Error shape doesn't match docs" (Medium severity). Asserted here against
 * the real, single-field shape so this still catches a genuine regression
 * (bare string body, HTML page, differently-shaped payload) without
 * permanently failing on a field that's never actually sent.
 */
function assertErrorShape(body) {
  expect(body).toHaveProperty("error");
  expect(typeof body.error).toBe("string");
  expect(body.error.length).toBeGreaterThan(0);
}

module.exports = { assertValidWeatherSchema, assertErrorShape };
