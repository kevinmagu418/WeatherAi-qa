# QA Report — WeatherAI Developer API

> **Status: template.** This report is scaffolded ahead of live test execution.
> Sections below are placeholders — replace them with real results after
> running `npm test` (and the Postman collection) against a working API key.
> Do not fill these in with fabricated numbers; leave a section marked
> "pending" if it genuinely couldn't be exercised.

## 1. Summary

- **Date(s) tested:** 2026-07-05 (infrastructure probe only — see below); full authenticated run still _TBD_
- **API key tier:** _TBD (Free, per assessment scope)_ — no working key obtained yet (see §4)
- **Endpoints tested:** `GET /v1/weather`, `GET /v1/forecast`, `GET /v1/usage`
- **Test suites run:** `tests/weather.test.js`, `tests/forecast.test.js`, `tests/usage.test.js`, `postman/weatherai-qa.postman_collection.json` — not yet run in full; unauthenticated cases (WX-010, WX-080, WX-092) were run manually and are reported below because they required no API key
- **Total automated test cases:** 58 live/API cases (38 in `weather.test.js`, 17 in `forecast.test.js`, 3 in `usage.test.js`) + 9 isolated unit tests for internal helpers (`tests/helpers/retry.test.js`, `tests/helpers/usageDiff.test.js`) — see `TEST_PLAN.md` §4 for the full list
- **Overall result:** _TBD — full suite blocked pending a working key and a responsive backend (see Finding below)_

## 2. Key findings

> One entry per finding. Severity scale: **Critical** (data loss / security / total outage) · **High** (broken core functionality, wrong data) · **Medium** (inconsistent behavior, poor error handling) · **Low** (cosmetic, minor doc mismatch).

### Finding: `api.weather-ai.co` is returning 503 on every endpoint — API appears fully down
- **Severity:** Critical
- **Where:** All of `api.weather-ai.co` (confirmed on `/v1/weather`, `/v1/usage`; the root `/` on the same host also 503s)
- **Description:** Every request to the API host currently returns HTTP `503` with an HTML body (`Content-Type: text/html`, not JSON) reading *"Error: Server Error — The service you requested is not available yet. Please try again in 30 seconds."* Response headers (`server: Google Frontend`, `x-served-by: cache-*`, `fastly-restarts: 1`) indicate this is an edge/CDN-level error, not an application-level response — i.e. the backend service behind the CDN isn't up or isn't reachable, so requests never reach WeatherAI's own application code. Reproduced 2026-07-05 with no `Authorization` header at all (so this is not an auth issue):
  ```
  $ curl -i "https://api.weather-ai.co/v1/weather?lat=-1.2921&lon=36.8219"
  HTTP/1.1 503 Service Unavailable
  content-type: text/html; charset=UTF-8
  server: Google Frontend
  fastly-restarts: 1

  <html>...<h2>The service you requested is not available yet. Please try again in 30 seconds.</h2>...</html>
  ```
  By contrast, `https://weather-ai.co/docs` (marketing/docs site, different host) returns `200` normally — so this is isolated to the API backend, not a whole-company outage.
- **Impact:** The API is completely unusable for any customer right now, authenticated or not. This also plausibly explains the "internal server error" encountered generating a key from the dashboard (see next finding) — if the dashboard's backend calls the same infrastructure, a down API would surface exactly that symptom. This blocked the full authenticated test run for this assessment.
- **Test coverage:** WX-010 (auth-negative probe), WX-080 (error-quality probe), and WX-092 (the dedicated 503-mapping test, which explicitly branches on `Content-Type` to distinguish this infra-level failure from an application-level 503) all independently reproduced this — see `TEST_PLAN.md` §4 for how each is designed to keep recording this if it recurs.
- **Recommendation:** Investigate backend/origin health behind the CDN (Fastly) for `api.weather-ai.co` as a priority — this reads as an infra/deploy issue rather than an application bug. Once restored, add uptime monitoring + alerting on the API host distinct from the marketing site, since the two are clearly on separate infrastructure and one can be up while the other is down without anyone noticing from the docs site alone.

### Finding: API key generation fails with an internal server error
- **Severity:** High
- **Where:** WeatherAI dashboard (key generation flow, not the API itself)
- **Description:** Attempting to generate a new API key via the developer dashboard returns an "internal server error," blocking any live testing of the API until resolved.
- **Impact:** No prospective customer (or, in this case, no QA candidate) can exercise the product without a working key. This is a first-impression blocker for developer onboarding. Possibly related to the API outage above if the dashboard depends on the same backend.
- **Recommendation:** Add server-side error logging/alerting on the key-generation endpoint; surface a more specific error to the user (e.g. distinguish "billing not set up" from "internal error") so developers know whether the problem is on their end or the platform's.

### Finding: _template — replace with real finding once authenticated tests can run_
- **Severity:** _Critical / High / Medium / Low_
- **Where:** `GET /v1/weather` or `/v1/forecast`, specific param/case
- **Description:** _What happened, with the exact request and response._
- **Impact:** _Who is affected and how._
- **Recommendation:** _Concrete fix or mitigation._

_(Add one entry per confirmed issue found during the live run. Delete this template block once populated.)_

## 3. Recommendations for improvement

> Fill in after the live run. Seed ideas to evaluate once real data is available:
- Confirm error responses consistently use the documented `{error, message}` shape across *all* failure modes (some APIs drift on edge cases like 500s or malformed query strings).
- Confirm `X-RateLimit-Reset` is actually a rolling 30-day window as documented, not silently a calendar month (would need multi-day observation to fully verify — noted as a testing limitation for a single 48-hour window).
- **Document the `days` overflow behavior explicitly.** The docs state per-plan limits (Free 1-7, Pro 1-14, Scale 1-16) but never say what happens when a Free key requests `days=14` or `days=16` — 400, 403, or silent clamping are all plausible and none is documented. WX-031/032/033 are written to record whichever actually happens; if it turns out to be silent clamping with a 200 (i.e. the caller asked for 16 days and got 7 back with no indication anything was capped), that's a real integration hazard worth flagging as at least a Medium finding once observed.
- **Publish a `/v1/usage` response schema.** The docs describe this endpoint only in prose with no field names or example JSON — the only Free/Pro/Scale-tier endpoint without one. This forced the test suite to verify AI-quota accounting structurally (diffing numeric fields across snapshots) rather than asserting a concrete field name; a published schema would let integrators (and this suite) assert exact fields with confidence.

## 4. Blockers encountered during testing

- **`api.weather-ai.co` returning 503 on every route (see Finding above).** Confirmed independently of the key issue, since it reproduces with zero auth. This blocks the *entire* authenticated test matrix, not just the parts that need a key.
- **API key generation error on the dashboard (see Finding above).** This blocked key acquisition during the initial assessment window.
- Net effect: the full 58-case automated suite (plus 9 isolated unit tests for internal helpers) and the Postman collection are written and ready (see `TEST_PLAN.md` §4), but could not be executed end-to-end because the API itself was unreachable at time of writing. All test code and this report's structure were completed against the documented API contract (https://weather-ai.co/docs) so that testing can proceed immediately once the backend and key issuance are both restored. Note the Postman collection has not yet been updated with the newer 403/429/500/503/usage cases added in this pass — flagged as a follow-up in `TEST_PLAN.md`.
- _(Add any additional blockers encountered during the live run, e.g. unexpected auth behavior, undocumented required headers, CORS issues if relevant, etc.)_

## 5. How to reproduce

```bash
cp .env.example .env
# edit .env and set WEATHERAI_API_KEY=wai_<real_key>
npm install
npm test
```

See `README.md` for full setup instructions and `TEST_PLAN.md` for the complete test case list and rationale.
