const request = require("supertest");

const BASE_URL = process.env.WEATHERAI_BASE_URL || "https://api.weather-ai.co";

// .trim() guards against a blank-but-present value (e.g. a leftover
// `WEATHERAI_API_KEY=` line, or one with just whitespace) being treated as
// "configured" -- an empty string is falsy in JS, but a whitespace-only
// string is truthy, so a naive `!API_KEY` check can miss that case.
const RAW_API_KEY = process.env.WEATHERAI_API_KEY || "";
const API_KEY = RAW_API_KEY.trim();
const hasApiKey = API_KEY.length > 0;

if (!hasApiKey) {
  // eslint-disable-next-line no-console
  console.warn(
    "\n[weatherai-qa] WEATHERAI_API_KEY is not set -- skipping all live API tests in this file. " +
      "Copy .env.example to .env and add a real key to run them for real.\n"
  );
}

/**
 * Returns a supertest agent bound to the live API base URL.
 * Never points at localhost -- these tests exercise the real service.
 */
function api() {
  return request(BASE_URL);
}

/**
 * Standard auth header using the key from .env. Test files should gate
 * entire describe blocks on `hasApiKey` (via `describe.skip`) rather than
 * relying on this throwing -- see maybeDescribe in weather/forecast/usage
 * .test.js. This throw remains as a defensive guard against a test being
 * added later that forgets to gate itself.
 */
function authHeader() {
  if (!hasApiKey) {
    throw new Error(
      "WEATHERAI_API_KEY is not set. Copy .env.example to .env and add a real key " +
        "generated from the WeatherAI dashboard before running live tests."
    );
  }
  return `Bearer ${API_KEY}`;
}

module.exports = { api, authHeader, hasApiKey, BASE_URL, API_KEY };
