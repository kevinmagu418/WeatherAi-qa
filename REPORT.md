# QA Report — WeatherAI Developer API

## 1. Summary

- **Date tested:** 2026-07-06 (full authenticated run, both Jest and Postman/Newman)
- **API key tier:** Free (`plan: "free"`, `limit: 1000` requests/month per `/v1/usage`)
- **Endpoints tested:** `GET /v1/weather` (primary), `GET /v1/usage` (secondary), `GET /v1/forecast` (bonus/out-of-scope coverage, still run)
- **Test suites run:**
  - `npm test` (Jest + Supertest) — `tests/weather.test.js`, `tests/forecast.test.js`, `tests/usage.test.js`, `tests/helpers/retry.test.js`, `tests/helpers/apiClient.test.js`, `tests/helpers/usageDiff.test.js`
  - `postman/weatherai-qa.postman_collection.json` via Newman (`npx newman@6.2.2`)
- **Jest result: 59 passed / 13 failed / 72 total.**
- **Newman result: 20 passed / 14 failed / 34 assertions** (21 requests, all executed).
- **Overall:** Core request-handling is solid — auth rejection, required-param validation, boundary coordinates, and consistency all behave correctly and match the docs. However, the live API does **not** match its own published contract in five distinct, confirmed ways (response schema, AI summary, rate-limit headers, error shape, and `/v1/usage` contents), plus two behavioral gaps (out-of-range coordinates, empty-string params, and undocumented silent day-clamping). All 13 Jest failures and all 14 Newman assertion failures trace back to these same root causes — not 13+14 unrelated bugs. See §2.
- **Quota used this assessment:** 150 of 1,000 monthly requests (across both Jest runs, exploratory probing, and the Newman run) — 850 remaining.

## 2. Key findings

> Severity scale: **Critical** (data loss / security / total outage) · **High** (broken core functionality, wrong data, or a documented contract that's simply not true) · **Medium** (inconsistent behavior, poor error handling) · **Low** (cosmetic, minor doc mismatch).

### Finding 1: Response schema does not match published docs (High)
- **Where:** `GET /v1/weather`, `GET /v1/forecast` — every successful response.
- **Description:** The docs (and this suite's original assertions, transcribed directly from them — see `TEST_PLAN.md` §5) describe:
  ```
  current:  { temperature, condition (string), humidity, windSpeed }
  forecast: [{ date, maxTemp, minTemp, condition (string), rainProbability }]
  ```
  The real response is completely different, and looks like an unmodified passthrough of an upstream provider (field names match Open-Meteo's API almost exactly):
  ```json
  {
    "lat": -1.2921, "lon": 36.8219, "units": "metric", "days": 7,
    "current": { "time": "...", "interval": 900, "temperature": 24.2, "windspeed": 15.7, "winddirection": 95, "is_day": 1, "weathercode": 3 },
    "daily": [ { "date": "2026-07-06", "temp_max": 24.6, "temp_min": 13, "precipitation": 0, "weathercode": 3 }, ... ],
    "hourly": [ ... ],
    "ai_summary": null
  }
  ```
  `current.condition` and `current.humidity` — both explicitly documented — do not exist anywhere in the payload. `forecast` is called `daily`. `windSpeed` is `windspeed` (and a different unit/precision). Weather conditions are exposed only as a numeric `weathercode`, never translated to the documented human-readable `condition` string.
- **Impact:** Any integrator who builds against the published docs (rather than reverse-engineering a live response, as this assessment had to) gets `undefined` for `condition`/`humidity`/`windSpeed` and an empty `forecast` array. This isn't a minor naming quibble — half the documented fields on the flagship endpoint don't exist.
- **Test coverage:** WX-001–005, WX-040–050, WX-060–061, FC-001–003, FC-030–040 (all fixed to assert the real field names — see `tests/helpers/assertions.js`).
- **Recommendation:** Either update the docs to describe the real (Open-Meteo-shaped) response, or implement the transformation layer the docs already promise (map `weathercode` → a human string, compute/pass through `humidity`, rename `daily`→`forecast` and its fields). The latter is almost certainly what was originally intended, given how specific the documented field names are.

### Finding 2: AI summary never populates (High)
- **Where:** `GET /v1/weather`, `GET /v1/forecast` — `ai_summary` field.
- **Description:** Docs state the default `ai=true` populates a `summary` string. In every request observed during this assessment — with `ai` omitted (default), `ai=true` explicit, and `ai=false` — the `ai_summary` field is always `null`. No error, no downgrade notice, nothing to indicate the feature didn't run.
- **Impact:** A core advertised feature (AI-generated summaries) silently does nothing on a Free-tier key. If this is an intentional plan-gate (AI summaries are Pro+ only), that's undocumented and should return a clear signal (e.g. a note in the response, or a 403 if explicitly requested) rather than a silent `null`. If it's a bug, it means the feature is completely broken for at least the Free tier.
- **Test coverage:** WX-001 (intentionally left failing — see `tests/helpers/assertions.js` — to keep this visible rather than loosening the assertion to match the bug).
- **Recommendation:** Either fix AI summary generation, or if it's plan-gated, document that explicitly and have the API communicate it (e.g. `"ai_summary": null, "ai_summary_note": "AI summaries require a Pro plan or higher"` rather than a bare `null`).

### Finding 3: Documented rate-limit headers are never sent (High)
- **Where:** `GET /v1/weather`, `GET /v1/forecast` — response headers.
- **Description:** Docs promise `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` on every response. None of the three appear on any response observed (confirmed via a raw header dump, not just the test assertions). Quota data is only available by making a separate `GET /v1/usage` call.
- **Impact:** Any client implementing the documented client-side rate-limit pattern (read remaining quota from response headers, back off proactively) gets nothing to read — they'd have to poll `/v1/usage` on every request instead, doubling their request volume against the same 1,000/month cap just to track their own usage.
- **Test coverage:** WX-070, FC-050 (confirmed failing, left red on purpose). WX-071 also failed once fixed — it originally showed a false PASS because `Number(undefined) - 1 === NaN` and `expect(NaN).toBe(NaN)` passes under Jest's `Object.is` semantics, masking the missing header entirely. Fixed to assert header presence first (see `tests/weather.test.js`).
- **Recommendation:** Add the documented headers to every response, or update the docs to describe the actual mechanism (`/v1/usage` polling) instead.

### Finding 4: Out-of-range coordinates cause a 502, not the documented 400 (High)
- **Where:** `GET /v1/weather`, `GET /v1/forecast` — `lat`/`lon` outside ±90/±180.
- **Description:** `lat=91` (and `lat=-91`, `lon=181`, `lon=-181`) returns `502 {"error":"Failed to fetch weather data."}` instead of the documented `400`. The API does not validate coordinate ranges before forwarding to its upstream provider; the upstream rejects the nonsensical coordinate, and that failure leaks through as an opaque, generic 502.
- **Impact:** A client sanity-checking status codes per the docs (400 = "my input was wrong, fix it client-side") instead gets a 502 (conventionally "the server/upstream is broken, maybe retry"). This is actively misleading — a well-behaved client following the documented error contract might retry a 502 with backoff (per the docs' own guidance for 502-adjacent 500/503), burning quota on a request that will never succeed no matter how many times it's retried.
- **Test coverage:** WX-025–028, FC-023–024 (confirmed failing, left red on purpose — this is a genuine defect, not a test assumption to be corrected).
- **Recommendation:** Validate `lat`/`lon` ranges before calling the upstream provider and return `400` with a clear message, per the documented contract.

### Finding 5: `/v1/usage` doesn't expose AI-specific usage, and doesn't match its own docs (High)
- **Where:** `GET /v1/usage`.
- **Description:** Docs' prose says this endpoint "returns request counts, AI request counts, plan limits, and billing period start/end." The real response is `{"plan":"free","used":61,"limit":1000,"remaining":939,"unlimited":false}` — no AI-specific counter, and no billing-period dates at all. Directly tested (UG-010): one `ai=false` call and one `ai=true` call produced **identical** usage deltas (`{used: +2, remaining: -2}` in both windows) — there is no field anywhere in the response that distinguishes AI-quota consumption from a plain request. (The `+2` instead of `+1` per window is itself notable — it suggests calling `/v1/usage` to check your quota also counts against `used`, meaning you can't observe your own usage without changing it.)
- **Impact:** Combined with Finding 2 (AI summaries never populate), this raises the question of whether the "AI request" concept and its separate quota exist at all in the current implementation, despite being documented in two places (the per-request `ai` param behavior and the `/v1/usage` response).
- **Test coverage:** UG-001 (schema — fixed to match reality), UG-010 (converted from a hard assertion to a diagnostic test recording this exact finding, matching the pattern already used elsewhere in this suite for other non-deterministic/undocumented behavior).
- **Recommendation:** Either implement and expose the documented AI-specific counter and billing-period dates, or correct the docs to describe the real, simpler `{plan, used, limit, remaining, unlimited}` shape.

### Finding 6: Empty-string `lat`/`lon` silently coerced to `0` instead of rejected (Medium)
- **Where:** `GET /v1/weather`, `GET /v1/forecast` — `lat=""` or `lon=""`.
- **Description:** Omitting `lat` entirely correctly returns `400`. Passing `lat=""` (present but empty) instead returns `200` with `lat: 0` silently substituted — i.e. a request for Nairobi's weather with a typo'd blank coordinate silently returns the weather at 0°N/0°E (off the coast of Ghana) instead of an error.
- **Impact:** A classic "wrong data returned with no indication anything was wrong" bug — the worst kind of input-validation gap, since the caller has no way to know their request was misinterpreted.
- **Test coverage:** WX-029–030, FC-025 (confirmed failing, left red on purpose).
- **Recommendation:** Treat an empty string the same as an absent parameter — reject both with `400`.

### Finding 7: Error response shape doesn't match docs (Medium)
- **Where:** All error responses (401, 400) across all three endpoints.
- **Description:** Docs specify `{ "error": "error_code", "message": "human-readable text" }`. Every observed error response is actually a single field: `{"error": "<human-readable message>"}` — no separate `message` field exists.
- **Impact:** Lower severity than the other findings because the single `error` field is still a usable, descriptive string — a client displaying `body.error` to a user gets a reasonable message either way. But a client parsing `error` as a machine-readable code (as the docs' naming implies) and `message` as the human text would get the human text in the wrong field and `undefined` where they expected a code.
- **Test coverage:** All auth/param negative-case tests (assertion corrected in `tests/helpers/assertions.js` to the real single-field shape).
- **Recommendation:** Either add the documented `message` field alongside a real machine-readable `error` code, or update the docs to describe the current single human-readable-string shape.

### Finding 8: `days` beyond the plan max silently clamps with no error or warning (Medium)
- **Where:** `GET /v1/weather` — `days=8/14/16` on a Free-tier key (documented max: 7).
- **Description:** Docs state per-plan `days` limits but never say what happens on overflow. Confirmed: `days=8`, `days=14` (Pro range), and `days=16` (Scale range) all return `200` with the response's own `days` field silently reset to `7` and `daily.length === 7` — no error, no warning, no indication the request was truncated.
- **Impact:** A paying-adjacent integrator who asks for a 14-day forecast (perhaps testing what they'd get on a Pro plan, or simply not reading the fine print) silently gets 7 days back and may not notice for a while that half their requested data is missing.
- **Test coverage:** WX-031–033 (diagnostic tests, passing while recording this exact behavior per the console output below).
- **Recommendation:** At minimum, add a response field or header indicating clamping occurred (e.g. `"days_requested": 14, "days_returned": 7`). Ideally, return `403` with a clear "upgrade to Pro for up to 14 days" message instead of silently truncating.

### Resolved: API key generation blocker (originally High)
- **Description:** Generating a key via the WeatherAI dashboard previously returned an "internal server error" (reported in the prior pass of this assessment). **Resolved as of 2026-07-06** — a working key (`wai_live_...`) was successfully generated and used for this entire run, and the backend itself was healthy throughout (no repeat of the 2026-07-05 503 outage on any of the 72 Jest tests or 21 Newman requests).

## 3. Exploratory test results

### `days=14` on a Free-tier key (WX-032) and related overflow cases
Requested via `GET /v1/weather?lat=-1.2921&lon=36.8219&ai=false&days=14` (Pro-tier range) and `days=16` (Scale-tier range), both against a confirmed Free-tier key. Console output from the actual run:
```
WX-032 observed: status=200, forecast.length=7
WX-033 observed: status=200, forecast.length=7
```
Both — along with `days=8` (WX-031, one above the Free max) — returned **HTTP 200** with the `daily` array silently truncated to **7 entries** (the response's own `days` field also reset to `7`, confirmed via direct probing). No `400`, no `403`, no warning field, nothing distinguishing this response from a request that had asked for exactly 7 days in the first place. This is the "silent clamping" outcome that `TEST_PLAN.md` flagged in advance as the most likely and most surprising possibility — confirmed. See Finding 8 above.

### `ai=false` quota behavior (UG-010)
Strategy: snapshot `/v1/usage`, call `/v1/weather?ai=false`, snapshot again, call `/v1/weather?ai=true`, snapshot again, and diff the numeric fields in each window. Actual console output from the run:
```
UG-010 observed: ai=false window delta = { used: 2, remaining: -2 } | ai=true window delta = { used: 2, remaining: -2 } | AI-specific candidate field(s) = NONE FOUND
UG-010: no field distinguishes ai=true from ai=false in /v1/usage -- the docs' claim that /v1/usage reports 'AI request counts' does not hold for this response shape.
```
The `ai=false` window and the `ai=true` window produced **identical** deltas — both `{used: +2, remaining: -2}`. There is no field in `/v1/usage`'s response that increases only when `ai=true` is used. Two things stand out: (1) the `+2` rather than `+1` per window implies the `/v1/usage` check itself consumes one unit of quota, so a client can't observe its own usage for free; (2) combined with Finding 2 (ai_summary always null), this strongly suggests the AI-request concept — a separately-tracked, separately-quota'd feature — does not actually exist in the current implementation, regardless of what the docs describe. See Finding 5.

## 4. Recommendations

1. **Fix or re-document the response schema** (Finding 1) — this is the highest-impact issue; it affects every successful call to the two main endpoints.
2. **Fix or clearly gate the AI summary feature** (Finding 2) and **expose real AI-usage accounting in `/v1/usage`** (Finding 5) — these two findings compound each other and suggest the AI feature isn't functioning end-to-end on Free-tier keys.
3. **Send the documented rate-limit headers** (Finding 3), or drop them from the docs in favor of the `/v1/usage`-polling pattern that actually works today.
4. **Validate `lat`/`lon` before forwarding upstream** (Finding 4) so out-of-range input fails fast with a `400`, not a `502`.
5. **Reject empty-string params the same as missing ones** (Finding 6).
6. **Pick one error shape and document it accurately** (Finding 7) — either add `message` or drop it from the docs.
7. **Signal `days` clamping explicitly** (Finding 8) rather than silently truncating.
8. **Update the Postman collection's test scripts** to match the real schema/error shape (see §5 below) — it currently still asserts the original documented (incorrect) contract, so every one of its assertions about `current.condition`, `forecast`, `summary`, and `{error, message}` fails for the same root-cause reasons as the Jest suite, just not yet reflected in the collection itself.

## 5. Postman / Newman results

Run via `npx newman@6.2.2 run postman/weatherai-qa.postman_collection.json` with the same live key (passed via a Newman environment, not committed to the repo).

**Result: 21/21 requests executed, 20/34 assertions passed, 14 failed.**

Every Newman failure independently corroborates a Jest finding above, with **no new or contradictory behavior discovered**:

| Newman assertion | Result | Matches |
|---|---|---|
| WX-001 "Has current block with expected types" / "non-empty forecast array" / "AI summary present" | FAIL | Finding 1 (schema), Finding 2 (ai_summary null) |
| WX-010/013/020/081a/081b "Error shape is {error, message}" | FAIL | Finding 7 |
| WX-025/027 "Status code is 400" (got 502) | FAIL | Finding 4 |
| WX-029 "Status code is 400" (got 200) | FAIL | Finding 6 |
| WX-060 (×2) `TypeError: Cannot read properties of undefined (reading 'map')` | FAIL | Finding 1 (references `.forecast`, real field is `.daily`) |
| WX-070 "Rate limit headers are numeric and sane" | FAIL | Finding 3 |

The Postman collection has **not** been updated to match the real schema/error shape (unlike the Jest suite, which was corrected as part of this pass) — its assertions still reflect the originally-documented contract. This is why it shows more failures proportionally (14/34 assertions vs. 13/72 Jest tests) even though both suites are observing the exact same underlying API behavior. Recommend updating the collection's test scripts to match `tests/helpers/assertions.js` in a follow-up pass, per the note already flagged in `TEST_PLAN.md`.

No discrepancies between the Jest and Newman results were found — every status code, schema gap, and header omission matched exactly across both tools.

## 6. How to reproduce

```bash
cp .env.example .env
# edit .env and set WEATHERAI_API_KEY=wai_<real_key>
npm install
npm test

# Postman collection via Newman (not a project dependency; run ad hoc):
npx newman@6.2.2 run postman/weatherai-qa.postman_collection.json \
  -e <(node -e "require('dotenv').config();console.log(JSON.stringify({values:[{key:'api_key',value:process.env.WEATHERAI_API_KEY.trim(),enabled:true},{key:'base_url',value:'https://api.weather-ai.co',enabled:true}]}))")
```

See `README.md` for full setup instructions and `TEST_PLAN.md` for the complete test case list, rationale, and per-case actual results.
