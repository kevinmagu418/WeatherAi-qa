/**
 * Setup/config sanity check for apiClient.js. Unlike weather/forecast/usage
 * .test.js, this never touches the network and always runs (it's not gated
 * on hasApiKey) -- its job is to confirm the environment is being read
 * correctly regardless of whether a real key is configured, so `npm test`
 * always has at least one green, meaningful signal even with zero live
 * tests running.
 */

const { BASE_URL, hasApiKey, API_KEY, authHeader } = require("./apiClient");

describe("apiClient setup check", () => {
  test("SETUP-001: BASE_URL resolves to a well-formed http(s) URL", () => {
    expect(typeof BASE_URL).toBe("string");
    expect(BASE_URL).toMatch(/^https?:\/\/.+/);
  });

  test("SETUP-002: hasApiKey accurately reflects whether WEATHERAI_API_KEY is configured", () => {
    const envValue = (process.env.WEATHERAI_API_KEY || "").trim();

    if (envValue.length > 0) {
      expect(hasApiKey).toBe(true);
      expect(API_KEY).toBe(envValue);
    } else {
      // Covers both "unset" and "set to an empty/whitespace-only string" --
      // neither should be treated as a usable key.
      expect(hasApiKey).toBe(false);
      expect(API_KEY).toBe("");
    }
  });

  test("SETUP-003: authHeader() behaves correctly for the current key state", () => {
    if (hasApiKey) {
      expect(authHeader()).toBe(`Bearer ${API_KEY}`);
    } else {
      expect(() => authHeader()).toThrow(/WEATHERAI_API_KEY is not set/);
    }
  });
});
