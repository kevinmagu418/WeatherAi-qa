/**
 * Retries a request-issuing function on retryable HTTP statuses (500/502/503/504)
 * with exponential backoff, per the docs' guidance that clients should "retry
 * with backoff" on 500 Internal Error.
 *
 * `fn` must return a supertest Response (or anything with a numeric `.status`).
 * Returns the last response received, whether it ultimately succeeded or the
 * retries were exhausted.
 */
async function requestWithRetry(
  fn,
  { retries = 3, baseDelayMs = 500, retryableStatuses = [500, 502, 503, 504] } = {}
) {
  let lastResponse;
  let attempts = 0;

  for (let attempt = 0; attempt <= retries; attempt++) {
    lastResponse = await fn();
    attempts += 1;
    if (!retryableStatuses.includes(lastResponse.status)) {
      return { response: lastResponse, attempts };
    }
    if (attempt < retries) {
      await new Promise((resolve) => setTimeout(resolve, baseDelayMs * 2 ** attempt));
    }
  }

  return { response: lastResponse, attempts };
}

module.exports = { requestWithRetry };
