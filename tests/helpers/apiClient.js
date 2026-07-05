const request = require("supertest");

const BASE_URL = process.env.WEATHERAI_BASE_URL || "https://api.weather-ai.co";
const API_KEY = process.env.WEATHERAI_API_KEY;

/**
 * Returns a supertest agent bound to the live API base URL.
 * Never points at localhost -- these tests exercise the real service.
 */
function api() {
  return request(BASE_URL);
}

/**
 * Standard auth header using the key from .env. Throws early with a clear
 * message if no key is configured, instead of letting every test fail with
 * a confusing 401.
 */
function authHeader() {
  if (!API_KEY) {
    throw new Error(
      "WEATHERAI_API_KEY is not set. Copy .env.example to .env and add a real key " +
        "generated from the WeatherAI dashboard before running live tests."
    );
  }
  return `Bearer ${API_KEY}`;
}

module.exports = { api, authHeader, BASE_URL, API_KEY };
