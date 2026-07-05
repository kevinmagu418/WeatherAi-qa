/**
 * Unit test for the retry/backoff helper used against documented 500/503
 * responses. This is deliberately NOT a live network test: a real 500
 * cannot be forced from the client side on demand, so we verify the retry
 * *mechanism* in isolation with a mocked request function, and rely on the
 * live tests in weather.test.js / usage.test.js to observe and log whatever
 * the API actually does if a 500/503 occurs organically during a run.
 */

const { requestWithRetry } = require("./retry");

function delayedResolve(value, ms) {
  return new Promise((resolve) => setTimeout(() => resolve(value), ms));
}

describe("requestWithRetry", () => {
  test("RT-001: returns immediately on a non-retryable status (200), no retries", async () => {
    const fn = jest.fn().mockResolvedValue({ status: 200 });

    const { response, attempts } = await requestWithRetry(fn, { baseDelayMs: 1 });

    expect(response.status).toBe(200);
    expect(attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });

  test("RT-002: retries on 503 and succeeds once the dependency recovers", async () => {
    const fn = jest
      .fn()
      .mockResolvedValueOnce({ status: 503 })
      .mockResolvedValueOnce({ status: 503 })
      .mockResolvedValueOnce({ status: 200 });

    const { response, attempts } = await requestWithRetry(fn, { retries: 3, baseDelayMs: 1 });

    expect(response.status).toBe(200);
    expect(attempts).toBe(3);
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test("RT-003: gives up after exhausting retries and returns the last (failed) response", async () => {
    const fn = jest.fn().mockResolvedValue({ status: 500 });

    const { response, attempts } = await requestWithRetry(fn, { retries: 2, baseDelayMs: 1 });

    expect(response.status).toBe(500);
    expect(attempts).toBe(3); // initial attempt + 2 retries
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test("RT-004: backs off exponentially between retries (each gap roughly doubles)", async () => {
    const callTimestamps = [];
    const fn = jest.fn(async () => {
      callTimestamps.push(Date.now());
      return callTimestamps.length < 3 ? { status: 503 } : { status: 200 };
    });

    await requestWithRetry(fn, { retries: 3, baseDelayMs: 30 });

    expect(callTimestamps.length).toBe(3);
    const gap1 = callTimestamps[1] - callTimestamps[0]; // ~30ms (baseDelayMs * 2^0)
    const gap2 = callTimestamps[2] - callTimestamps[1]; // ~60ms (baseDelayMs * 2^1)

    expect(gap1).toBeGreaterThanOrEqual(25);
    expect(gap2).toBeGreaterThanOrEqual(gap1 * 1.5);
  });

  test("RT-005: only treats configured statuses as retryable (400 is not retried)", async () => {
    const fn = jest.fn().mockResolvedValue({ status: 400 });

    const { response, attempts } = await requestWithRetry(fn, { retries: 3, baseDelayMs: 1 });

    expect(response.status).toBe(400);
    expect(attempts).toBe(1);
    expect(fn).toHaveBeenCalledTimes(1);
  });
});
