/**
 * Shared schema assertions for /v1/weather and /v1/forecast, which share an
 * identical response shape per https://weather-ai.co/docs:
 *
 * {
 *   "current": { "temperature": number, "condition": string, "humidity": number, "windSpeed": number },
 *   "forecast": [ { "date": string, "maxTemp": number, "minTemp": number, "condition": string, "rainProbability": number } ],
 *   "summary": string   // present when the `ai` param is true (default)
 * }
 */

function assertValidWeatherSchema(body, { aiExpected = true } = {}) {
  expect(body).toBeInstanceOf(Object);

  expect(body).toHaveProperty("current");
  const { current } = body;
  expect(typeof current.temperature).toBe("number");
  expect(typeof current.condition).toBe("string");
  expect(typeof current.humidity).toBe("number");
  expect(typeof current.windSpeed).toBe("number");

  expect(Array.isArray(body.forecast)).toBe(true);
  expect(body.forecast.length).toBeGreaterThan(0);
  for (const day of body.forecast) {
    expect(typeof day.date).toBe("string");
    expect(typeof day.maxTemp).toBe("number");
    expect(typeof day.minTemp).toBe("number");
    expect(typeof day.condition).toBe("string");
    expect(typeof day.rainProbability).toBe("number");
  }

  if (aiExpected) {
    expect(typeof body.summary).toBe("string");
    expect(body.summary.length).toBeGreaterThan(0);
  }
}

/**
 * Standard error shape per docs: { "error": "error_code", "message": "..." }
 * Asserted on every negative-path response so a bug that returns e.g. a
 * bare string, an HTML page, or a differently-shaped payload gets caught
 * regardless of which test triggered it.
 */
function assertErrorShape(body) {
  expect(body).toHaveProperty("error");
  expect(typeof body.error).toBe("string");
  expect(body.error.length).toBeGreaterThan(0);
  expect(body).toHaveProperty("message");
  expect(typeof body.message).toBe("string");
  expect(body.message.length).toBeGreaterThan(0);
}

module.exports = { assertValidWeatherSchema, assertErrorShape };
