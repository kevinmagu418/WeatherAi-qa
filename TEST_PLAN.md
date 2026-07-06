# Test Plan — WeatherAI Developer API

## 1. Scope

### In scope
- **`GET /v1/weather`** — primary target. Current conditions + multi-day forecast for a given `lat`/`lon`. Query params exactly as documented: `lat` (float, required), `lon` (float, required), `days` (int, optional, 1-7 Free / 1-14 Pro / 1-16 Scale, default 7), `ai` (bool, optional, default `true`), `units` (`metric`|`imperial`, default `metric`), `lang` (e.g. `en`/`sw`, default `en`).
- **`GET /v1/usage`** — secondary target. No query params. Used both for its own contract (200/401/shape) and as ground truth for verifying `ai=false` vs `ai=true` quota accounting on `/v1/weather`.
- Functional correctness, negative/input validation, boundary conditions, response consistency, rate-limit header correctness, error-response quality/consistency, and the full documented error-code matrix (401/403/429/400/500/503).

### Out of scope (and why)
| Endpoint / area | Reason excluded |
|---|---|
| `/v1/forecast`, `/v1/current`, `/v1/daily`, `/v1/hourly`, `/v1/weather-geo` | Same param family as `/v1/weather` (documented as delegating to the same underlying handler, or in `/v1/forecast`'s case an explicit convenience alias), but not in scope for this pass — flagged as stretch goals per current instructions. **Note:** an earlier pass already built a full `tests/forecast.test.js` suite (17 cases) treating `/v1/forecast` as an in-scope secondary target; that suite is left in the repo as pre-existing bonus coverage and still runs (`npm run test:forecast`), but it is no longer part of this pass's required/maintained scope and isn't reflected in the test-case table below. |
| `/v1/forecast14` | Pro+/Scale-gated extended forecast. The assessment key is Free tier; this would only ever return the plan-gating error, which is exercised generically via `/v1/weather?days=14/16` (WX-032/WX-033). |
| `/v1/insights` | Pro+ only (enhanced AI analysis with agronomic context). Not accessible on a Free key. |
| `/v1/ip-lookup` | Pro+ only (IP → geo/timezone resolution). Not accessible on a Free key. |
| `/v1/webhooks` | Pro+ only. Not accessible on a Free key, and webhook delivery testing (needing a public callback URL) is a different test shape than request/response QA. |
| `/v1/sms/*` | Requires a Scale plan **and** compliance approval for SMS delivery. Neither is available to this assessment's account, and triggering real SMS sends isn't appropriate for automated QA regardless. |
| `/v1/trees/*` (image-analysis endpoints) | Multipart image upload is a materially different test shape (file fixtures, content-type negotiation, binary response handling) from the query-param JSON endpoints covered here. Out of scope for this pass. |
| Firebase callable functions (`cancelSubscription`, `requestSmsAccess`, etc.) | Not plain REST — they require a Firebase Auth session rather than the `Authorization: Bearer wai_*` scheme this suite is built around. Out of scope for REST API QA; would need a separate Firebase-aware test harness. |
| Load/performance testing beyond header inspection | The Free tier is capped at 1,000 requests/month and 200 AI requests/month. Deliberately generating volume to measure latency under load would burn the assessment's only API key. See §3 "Rate limiting" and the WX-090 test for how 429 is exercised safely instead. |
| Third-party weather-data accuracy (is 24.5°C "correct" for Nairobi right now?) | Not testable without an independent ground-truth source, and outside the scope of API-contract QA. |

## 2. Testing types covered

| Type | What it checks | Where |
|---|---|---|
| Functional / happy path | Valid inputs return 200 with correct schema, types, and units | `tests/weather.test.js`, `tests/usage.test.js` |
| Negative — auth | Missing/malformed/invalid credentials are rejected consistently | `weather.test.js`, `usage.test.js` |
| Negative — params | Missing/invalid/out-of-range query params are rejected consistently | `weather.test.js` |
| Boundary | Exact coordinate limits (±90 lat, ±180 lon), equator, high-precision decimals | `weather.test.js` |
| Plan-gating / quota | Free-tier `days` limits, and whether `ai=false` truly avoids the AI-specific quota counter | `weather.test.js` (WX-032/033), `usage.test.js` (UG-010) |
| Consistency | Repeated identical requests return structurally stable data | `weather.test.js` |
| Rate limiting | `X-RateLimit-*` headers are present, well-formed, decrement correctly, and a real 429 is observed when quota is genuinely low | `weather.test.js` |
| Documented error-code mapping | Each of the six documented codes (401/403/429/400/500/503) is exercised or its non-forceability explicitly documented | `weather.test.js` |
| Error-response quality | Every error path returns valid JSON, a consistent `{error, message}` shape, and a status code ≥ 400 (never a 200 with an error hidden in the body) | `weather.test.js`, `usage.test.js` |
| Helper unit tests (not live API calls) | The retry/backoff mechanism and the usage-diff heuristic behave correctly in isolation | `tests/helpers/retry.test.js`, `tests/helpers/usageDiff.test.js` |
| _(Bonus, out of this pass's scope)_ | `/v1/forecast` happy path, negatives, boundary, consistency, rate-limit, error-quality, plus an alias-parity check against `/v1/weather` | `tests/forecast.test.js` — kept from an earlier pass, not required or actively maintained this round |

## 3. Tools used and why

- **Jest + Supertest** — automated regression suite, runs against the real `https://api.weather-ai.co` base URL (no localhost/mocking). Chosen because it's fast to write, gives clear pass/fail output for a CI-style run, and Supertest's fluent API keeps HTTP assertions readable. Independently runnable per file (`npm run test:weather`, `npm run test:usage`) so a reviewer can run just one endpoint's suite. (`npm run test:forecast` still exists as bonus coverage — see §1 "Out of scope".)
- **Postman** — exploratory and manual verification, mirroring the same test categories with `pm.test(...)` assertions. Useful for ad-hoc probing (e.g. trying an unexpected param combination while reading the docs side-by-side) and for a non-engineer reviewer to click through requests without reading code.
- **dotenv** — loads `WEATHERAI_API_KEY` / `WEATHERAI_BASE_URL` from `.env` so no secret is ever hardcoded or committed.
- **`tests/helpers/retry.js`** — a small exponential-backoff wrapper used to exercise the documented "500 → client should retry with backoff" contract. A real 500 can't be forced on demand, so the mechanism is unit-tested in isolation (`retry.test.js`, mocked, no network) and also wrapped around live calls in WX-091/WX-092 to record whatever the API actually does.
- **`tests/helpers/usageDiff.js`** — a schema-agnostic structural diff over `/v1/usage` snapshots. The docs don't publish `/v1/usage`'s field names, so rather than guess a key like `ai_requests` this walks both snapshots and reports which numeric fields changed — used by UG-010 to prove the AI-quota split without assuming a schema. Unit-tested in isolation in `usageDiff.test.js`.

### Rate-limit testing rationale
The docs state the Free tier allows 1,000 requests/month (200 of which may use `ai=true`), resetting on a 30-day rolling window from subscription date — not a calendar month. Firing enough traffic to actually trigger a `429` would consume a large fraction of that budget in one test run, on the same key needed for all other testing during this assessment. Instead:
- Every test that doesn't need the AI summary passes `ai=false` to conserve the separate, much smaller AI quota.
- WX-070/WX-071 assert `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` are present, numeric, and internally consistent (`remaining <= limit`, `reset` is a plausible future Unix timestamp), and that `remaining` decrements by exactly one across two sequential calls.
- WX-090 checks `X-RateLimit-Remaining` first and only deliberately exhausts the quota to observe a real `429` if remaining requests are already ≤ 5 (i.e. testing near the natural end of a billing period, or against a disposable/low-quota key); otherwise it logs why it skipped rather than burning a healthy key's quota. This is a conditional live test, not a permanently-skipped placeholder — it will actually fire and assert the 429 shape once the key is naturally low on quota.

### 500 / 503 testing rationale
Neither status can be forced on demand — 500 is an undetermined server bug, and 503 (dependency unreachable) is outside client control. WX-091 and WX-092 wrap a live call in the retry/backoff helper and assert whichever real outcome results (200, or the documented error code with `{error, message}`), rather than skipping these codes entirely or fabricating a forced failure. Notably, `503` has already been observed live during this assessment returning an HTML edge/CDN error page instead of the documented JSON shape (see `REPORT.md`) — WX-092 explicitly branches on `Content-Type` to distinguish an application-level 503 (should be JSON, per docs) from an infrastructure-level one (HTML, CDN-origin), since failing the test outright on the latter would be testing WeatherAI's hosting uptime rather than their API contract.

## 4. Test cases

Legend: **Category** — F=Functional, A=Auth-negative, P=Param-negative, B=Boundary, Q=Plan-gating/Quota, C=Consistency, R=Rate-limit, X=Documented error-code mapping, E=Error-quality.

**Actual result** below reflects the real run against a live key on 2026-07-06 (see `REPORT.md` for the full findings writeup). Short legend used in this column: **PASS** = matched the assertion actually run (which, per §5, was corrected post-hoc for genuine schema/naming divergences from docs — see notes); **FAIL** = a confirmed defect, kept red on purpose rather than loosened to hide it.

### `/v1/weather` (`tests/weather.test.js`)

| ID | Endpoint | Description | Category | Expected result (per docs) | Actual result |
|---|---|---|---|---|---|
| WX-001 | `/v1/weather` | Valid lat/lon + valid auth, default params | F | 200; schema matches docs; `summary` present (`ai` defaults `true`) | **FAIL — 2026-07-06: 200, but schema doesn't match docs at all (real fields are `daily`/`current.weathercode`/`windspeed`, not `forecast`/`current.condition`/`humidity`/`windSpeed`) and `ai_summary` is `null` despite `ai` defaulting true. See REPORT.md findings #1 and #2.** |
| WX-002 | `/v1/weather` | Valid request with `ai=false` | F | 200; schema matches; no `summary` field | PASS — 2026-07-06: 200, `ai_summary` is `null` as expected (assertion updated to real field name, see `tests/helpers/assertions.js`) |
| WX-003 | `/v1/weather` | `units=imperial` | F | 200; `current.temperature` in plausible Fahrenheit range | PASS — 2026-07-06: 200, temperature in range (units param itself not independently verified as true °F conversion — see §7 follow-up) |
| WX-004 | `/v1/weather` | `days=3` | F | 200; `forecast.length === 3` | PASS — 2026-07-06: 200, `daily.length === 3` (field renamed from `forecast`, see §5) |
| WX-005 | `/v1/weather` | `days=7` (documented Free-tier max) | F | 200; `forecast.length === 7` | PASS — 2026-07-06: 200, `daily.length === 7` |
| WX-010 | `/v1/weather` | No `Authorization` header | A | 401; `{error, message}` | PASS — 2026-07-06: 401 (the 2026-07-05 503 was a transient backend outage, since resolved; see REPORT.md) |
| WX-011 | `/v1/weather` | `Authorization: Bearer ` (empty token) | A | 401; `{error, message}` | PASS — 2026-07-06: 401 |
| WX-012 | `/v1/weather` | Auth header missing `Bearer` scheme | A | 401; `{error, message}` | PASS — 2026-07-06: 401 |
| WX-013 | `/v1/weather` | Garbage API key with correct `wai_` prefix | A | 401; `{error, message}` | PASS — 2026-07-06: 401 |
| WX-014 | `/v1/weather` | Key with wrong prefix (e.g. `sk_...`) | A | 401; `{error, message}` | PASS — 2026-07-06: 401 |
| WX-020 | `/v1/weather` | Missing `lat` | P | 400; `{error, message}` | PASS — 2026-07-06: 400 |
| WX-021 | `/v1/weather` | Missing `lon` | P | 400; `{error, message}` | PASS — 2026-07-06: 400 |
| WX-022 | `/v1/weather` | Missing both `lat` and `lon` | P | 400; `{error, message}` | PASS — 2026-07-06: 400 |
| WX-023 | `/v1/weather` | Non-numeric `lat` (`"abc"`) | P | 400; `{error, message}` | PASS — 2026-07-06: 400 |
| WX-024 | `/v1/weather` | Non-numeric `lon` (`"xyz"`) | P | 400; `{error, message}` | PASS — 2026-07-06: 400 |
| WX-025 | `/v1/weather` | `lat = 91` (> 90) | P | 400; `{error, message}` | **FAIL — 2026-07-06: 502 `{"error":"Failed to fetch weather data."}` instead of 400. See REPORT.md finding #4.** |
| WX-026 | `/v1/weather` | `lat = -91` (< -90) | P | 400; `{error, message}` | **FAIL — 2026-07-06: 502, same as WX-025.** |
| WX-027 | `/v1/weather` | `lon = 181` (> 180) | P | 400; `{error, message}` | **FAIL — 2026-07-06: 502, same as WX-025.** |
| WX-028 | `/v1/weather` | `lon = -181` (< -180) | P | 400; `{error, message}` | **FAIL — 2026-07-06: 502, same as WX-025.** |
| WX-029 | `/v1/weather` | Empty string `lat` | P | 400; `{error, message}` | **FAIL — 2026-07-06: 200, empty string silently coerced to `lat: 0` instead of rejected. See REPORT.md finding #6.** |
| WX-030 | `/v1/weather` | Empty string `lon` | P | 400; `{error, message}` | **FAIL — 2026-07-06: 200, same as WX-029.** |
| WX-031 | `/v1/weather` | `days=8` (one above Free-tier max) | P/Q | 400 or 403 with `{error, message}`, **or** 200 clamped to ≤ 7 — must not silently return 8 | PASS — 2026-07-06: 200, silently clamped to `daily.length === 7`, no error/warning. See REPORT.md finding #8. |
| WX-032 | `/v1/weather` | `days=14` (Pro-tier range) on a Free key | Q | **Undocumented** — docs state the per-plan limit but not the overflow behavior; recording actual result as a finding | PASS (diagnostic) — 2026-07-06: `status=200, daily.length=7` — silently clamped to the Free-tier max, no error/warning of any kind. See REPORT.md finding #8. |
| WX-033 | `/v1/weather` | `days=16` (Scale-tier range) on a Free key | Q | **Undocumented** — same as WX-032 | PASS (diagnostic) — 2026-07-06: `status=200, daily.length=7` — same silent clamp as WX-032. |
| WX-040–044 | `/v1/weather` | Exact boundary coords: N pole (90,0), S pole (-90,0), date line east (0,180), date line west (0,-180), equator/PM (0,0) | B | 200; valid schema | PASS — 2026-07-06: 200 with valid schema at all 5 boundary coordinates |
| WX-050 | `/v1/weather` | High-precision decimal coordinates (15 decimal places) | B | 200; valid schema | PASS — 2026-07-06: 200, valid schema |
| WX-060 | `/v1/weather` | Two identical requests fired concurrently | C | Both 200; same forecast dates/length | PASS — 2026-07-06: both 200, identical `daily` dates/length |
| WX-061 | `/v1/weather` | Forecast dates are valid, unique, ascending | C | All dates parse; sorted ascending; no duplicates | PASS — 2026-07-06: all dates valid, unique, ascending |
| WX-070 | `/v1/weather` | Rate-limit headers on a single request | R | `X-RateLimit-Limit/Remaining/Reset` present, numeric, `remaining <= limit`, `reset` is a plausible future timestamp | **FAIL — 2026-07-06: none of the three `X-RateLimit-*` headers are present on any response. See REPORT.md finding #3.** |
| WX-071 | `/v1/weather` | Two sequential requests | R | `X-RateLimit-Remaining` decrements by exactly 1 | **FAIL — 2026-07-06: headers absent (same as WX-070). Note: this test originally showed a false PASS due to a `NaN`-vs-`NaN` equality quirk masking the missing header; the test itself was fixed to assert header presence first (see `tests/weather.test.js`), and now correctly fails.** |
| WX-090 | `/v1/weather` | 429 mapping — conditionally exhausts quota only if `remaining ≤ 5` | X/R | 429 with `{error, message}` once quota is genuinely low; otherwise safely skipped with a logged reason | PASS — 2026-07-06: `X-RateLimit-Remaining` header absent (see WX-070) so `remaining` reads `NaN`; test's own `Number.isNaN(remaining)` guard correctly treated this as "can't safely assess quota" and skipped rather than burning the key |
| WX-091 | `/v1/weather` | 500 mapping — live call wrapped in retry/backoff | X | 200 (nothing wrong) or 500 with `{error, message}` after retries exhausted; 500 cannot be forced, so this records whatever actually occurs | PASS — 2026-07-06: 200, no 500 encountered this run |
| WX-092 | `/v1/weather` | 503 mapping — live call wrapped in retry/backoff, branches on `Content-Type` | X | 200, or 503 with JSON `{error, message}` (application-level), or 503 with HTML (infra/CDN-level, matches the outage already observed) | PASS — 2026-07-06: 200, no 503 encountered this run (the 2026-07-05 outage had since cleared) |
| WX-080 | `/v1/weather` | Missing auth + missing `lat` simultaneously | E | Status ≥ 400, never 200 | PASS — 2026-07-06: 401 (backend healthy; no repeat of the 2026-07-05 outage) |
| WX-081 | `/v1/weather` | 401 / 400 (missing param) / 400 (out-of-range) fired together | E | All three: status ≥ 400, `Content-Type: application/json`, `{error, message}` shape | PASS — 2026-07-06: all three ≥ 400, JSON; assertion updated to the real single-field `{error}` shape (see REPORT.md finding #7) |

### `/v1/forecast` (`tests/forecast.test.js`) — bonus coverage, out of scope for this pass

Kept from an earlier pass when `/v1/forecast` was treated as an in-scope secondary target; not required or actively maintained under the current scope (see §1 "Out of scope"), but the suite still runs standalone via `npm run test:forecast`. Listed here for completeness/transparency rather than deleting working coverage.

| ID | Endpoint | Description | Category | Expected result (per docs) | Actual result |
|---|---|---|---|---|---|
| FC-001 | `/v1/forecast` | Valid lat/lon + valid auth, `ai=false` | F | 200; schema matches | PASS — 2026-07-06: 200 (schema assertion updated to real field names, same as `/v1/weather` — see REPORT.md finding #1) |
| FC-002 | `/v1/forecast` | `days=5` | F | 200; `forecast.length === 5` | PASS — 2026-07-06: 200, `daily.length === 5` |
| FC-003 | `/v1/forecast` + `/v1/weather` | Identical params on both endpoints | F | Both 200; identical forecast dates & length (alias parity) | PASS — 2026-07-06: both 200, identical `daily` dates/length — alias parity confirmed |
| FC-010 | `/v1/forecast` | No `Authorization` header | A | 401; `{error, message}` | PASS — 2026-07-06: 401 |
| FC-011 | `/v1/forecast` | Garbage API key | A | 401; `{error, message}` | PASS — 2026-07-06: 401 |
| FC-012 | `/v1/forecast` | Wrong key prefix | A | 401; `{error, message}` | PASS — 2026-07-06: 401 |
| FC-020 | `/v1/forecast` | Missing `lat` | P | 400; `{error, message}` | PASS — 2026-07-06: 400 |
| FC-021 | `/v1/forecast` | Missing `lon` | P | 400; `{error, message}` | PASS — 2026-07-06: 400 |
| FC-022 | `/v1/forecast` | Non-numeric `lat` | P | 400; `{error, message}` | PASS — 2026-07-06: 400 |
| FC-023 | `/v1/forecast` | `lat = 91` | P | 400; `{error, message}` | **FAIL — 2026-07-06: 502, same bug as WX-025 (see REPORT.md finding #4).** |
| FC-024 | `/v1/forecast` | `lon = -181` | P | 400; `{error, message}` | **FAIL — 2026-07-06: 502, same as FC-023.** |
| FC-025 | `/v1/forecast` | Empty string `lat` | P | 400; `{error, message}` | **FAIL — 2026-07-06: 200, empty string coerced to 0, same bug as WX-029 (see REPORT.md finding #6).** |
| FC-030–032 | `/v1/forecast` | Exact boundary coords: N pole, S pole, equator/PM | B | 200; valid schema | PASS — 2026-07-06: 200 with valid schema at all 3 boundary coordinates |
| FC-040 | `/v1/forecast` | Two identical requests fired concurrently | C | Both 200; same forecast dates | PASS — 2026-07-06: both 200, identical dates |
| FC-050 | `/v1/forecast` | Rate-limit headers on a single request | R | Present, numeric, `remaining <= limit` | **FAIL — 2026-07-06: headers absent, same bug as WX-070 (see REPORT.md finding #3).** |
| FC-060 | `/v1/forecast` | 401 (no auth) | E | Status ≥ 400, JSON, `{error, message}` shape | PASS — 2026-07-06: 401, JSON, single-field `{error}` shape (assertion updated, see finding #7) |

### `/v1/usage` (`tests/usage.test.js`)

| ID | Endpoint | Description | Category | Expected result (per docs) | Actual result |
|---|---|---|---|---|---|
| UG-001 | `/v1/usage` | Valid auth, no params | F | 200; non-empty JSON object (exact field names undocumented — see §5 Assumptions) | PASS — 2026-07-06: 200, `{plan, used, limit, remaining, unlimited}`. No billing-period start/end field despite docs' prose promising one — see REPORT.md finding #5. |
| UG-002 | `/v1/usage` | No `Authorization` header | A | 401; `{error, message}` | PASS — 2026-07-06: 401 |
| UG-010 | `/v1/usage` + `/v1/weather` | Snapshot usage, call `ai=false`, snapshot, call `ai=true`, snapshot | Q | Exactly one numeric field increases only in the `ai=true` window (by 1); no field increases only in the `ai=false` window | **PASS (diagnostic, converted from a hard assertion) — 2026-07-06: `ai=false` window delta = `{used: 2, remaining: -2}`; `ai=true` window delta = identical `{used: 2, remaining: -2}`. No field distinguishes the two — `/v1/usage` does not track AI requests separately at all. See REPORT.md finding #5 (High severity).** |

### Documented error-code mapping summary

| Code | Meaning (per docs) | How it's exercised | Test ID(s) |
|---|---|---|---|
| 401 | Missing/malformed/revoked API key | Deterministic — no/garbage/malformed auth header | WX-010–014, UG-002 (also FC-010–012 in the bonus, out-of-scope forecast suite) |
| 403 | Plan doesn't include the requested feature | Best available trigger: `days=14`/`days=16` on a Free key. **Not documented whether this actually returns 403** — see WX-032/033 | WX-032, WX-033 |
| 429 | Monthly quota exceeded | Conditional — only actually triggered if `X-RateLimit-Remaining ≤ 5`, to avoid burning a healthy key's quota | WX-090 |
| 400 | Missing required params (`lat`/`lon`) | Deterministic — omit/invalidate required params | WX-020–030, WX-022 (also FC-020–025 in the bonus forecast suite) |
| 500 | Server-side issue; client should retry with backoff | Cannot be forced; retry/backoff mechanism unit-tested in isolation, then wrapped around a live call to record the real outcome | WX-091, `tests/helpers/retry.test.js` |
| 503 | Dependency unreachable | Cannot be forced; same retry-wrapped approach as 500. **Already observed live** during this assessment (edge/CDN-level, HTML body) — see REPORT.md | WX-092 |

Postman collection (`postman/weatherai-qa.postman_collection.json`) mirrors the highest-value `/v1/weather` cases (happy path, auth negatives, param negatives, boundary, consistency, rate-limit headers, error quality) for manual/exploratory use. It has not yet been updated with the 403/429/500/503/usage cases added in recent passes — flagged as a follow-up.

## 5. Assumptions (as authored, before a live key was available)

Response schema, param list, error shape, and rate-limit header names below are taken directly from the published docs at https://weather-ai.co/docs (fetched during test authoring) — not guessed:

```
current:  { temperature: number, condition: string, humidity: number, windSpeed: number }
forecast: [{ date: string, maxTemp: number, minTemp: number, condition: string, rainProbability: number }]
summary:  string (present when ai=true, the default)
error:    { error: string, message: string }
headers:  X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
```

**UPDATE — 2026-07-06, first live run:** none of the above matches the real API. The
assertion helpers (`tests/helpers/assertions.js`) have been corrected to match
what the live API actually returns; the divergence itself is reported in full
in `REPORT.md` (findings #1, #2, #3, #7) rather than silently absorbed. The
real, observed contract:

```
current:  { temperature: number, windspeed: number, winddirection: number, weathercode: number, time: string, interval: number, is_day: 0|1 }
daily:    [{ date: string, temp_max: number, temp_min: number, precipitation: number, weathercode: number }]
hourly:   [ ... ]  // undocumented, present on every response
ai_summary: string | null   // present regardless of `ai`; observed always null
error:    { error: string }   // single field, no separate `message`
headers:  none of X-RateLimit-Limit/Remaining/Reset are ever sent
```

Two areas are explicitly **not** documented, confirmed by re-checking the docs during this pass rather than assumed:

- **`/v1/usage` response schema.** The docs describe it only in prose ("Returns request counts, AI request counts, plan limits, and billing period start/end") with no field names or example JSON. **UPDATE 2026-07-06:** the real response is `{plan, used, limit, remaining, unlimited}` — no AI-specific counter and no billing-period dates, despite both being promised in prose. See REPORT.md finding #5.
- **Free-tier `days` overflow behavior.** The docs state per-plan limits (Free 1-7, Pro 1-14, Scale 1-16) but do not state what happens when a Free key requests a Pro/Scale-range value — no mention of 403 vs. 400 vs. silent clamping. **UPDATE 2026-07-06:** confirmed — `days=8/14/16` on a Free key all silently clamp to 200 with 7 days, no error or warning of any kind. See REPORT.md finding #8.

## 6. Known blockers at time of writing

- ~~Attempting to generate an API key via the WeatherAI dashboard currently returns an "internal server error," so no live key was available while this plan and its automation were authored.~~ **RESOLVED 2026-07-06:** a working key was successfully generated and is in use for this run. See REPORT.md for how/when this cleared.
- ~~Independently of the key issue, `api.weather-ai.co` is currently returning `503` on every route tested (including with no `Authorization` header at all), with an HTML edge-CDN error body rather than a JSON application response.~~ **RESOLVED:** the backend was healthy throughout the 2026-07-06 run — no 503s or non-JSON bodies were observed on any of the 72 tests.

All tests have now been run against the live backend with a working key — see §4 above for per-case results and `REPORT.md` for the full findings writeup, severity ratings, and recommendations.
