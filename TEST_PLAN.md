# Test Plan — WeatherAI Developer API

## 1. Scope

### In scope
- **`GET /v1/weather`** — primary target. Current conditions + multi-day forecast for a given `lat`/`lon`.
- **`GET /v1/forecast`** — documented as a convenience alias of `/v1/weather` accepting identical parameters. Covered as a secondary target, including a parity check against `/v1/weather`.
- Both endpoints accept: `lat` (required), `lon` (required), `days`, `ai`, `units`, `lang` (all optional).
- Functional correctness, negative/input validation, boundary conditions, response consistency, rate-limit header correctness, and error-response quality/consistency.

### Out of scope (and why)
| Endpoint / area | Reason excluded |
|---|---|
| `/v1/forecast14`, `/v1/insights`, `/v1/ip-lookup` | Pro+/Scale-gated; the assessment key (once available) is Free tier. Testing these would only confirm the 403 gate, which is covered generically by the auth/plan-gating pattern in `/v1/weather`. |
| `/v1/current`, `/v1/daily`, `/v1/hourly`, `/v1/weather-geo`, `/v1/usage` | Documented as delegating to the same underlying handler as `/v1/weather` (or, for `/v1/usage`, a distinct account-metadata endpoint). Listed as candidates for a follow-up test pass once the primary endpoints are verified; not exercised in this round given the 48-hour window. |
| Load/performance testing beyond header inspection | The Free tier is capped at 1,000 requests/month and 200 AI requests/month. Deliberately generating volume to measure latency under load, or to actually trip a 429, would burn the assessment's only API key and block further exploratory testing. See §3 "Rate limiting" for what is tested instead. |
| Third-party weather-data accuracy (is 24.5°C "correct" for Nairobi right now?) | Not testable without an independent ground-truth source, and outside the scope of API-contract QA. |

## 2. Testing types covered

| Type | What it checks | Where |
|---|---|---|
| Functional / happy path | Valid inputs return 200 with correct schema, types, and units | `tests/weather.test.js`, `tests/forecast.test.js` |
| Negative — auth | Missing/malformed/invalid credentials are rejected consistently | both suites |
| Negative — params | Missing/invalid/out-of-range query params are rejected consistently | both suites |
| Boundary | Exact coordinate limits (±90 lat, ±180 lon), equator, high-precision decimals | both suites |
| Consistency | Repeated identical requests return structurally stable data | both suites |
| Rate limiting | `X-RateLimit-*` headers are present, well-formed, and decrement correctly | both suites |
| Error-response quality | Every error path returns valid JSON, a consistent `{error, message}` shape, and a status code ≥ 400 (never a 200 with an error hidden in the body) | both suites |

## 3. Tools used and why

- **Jest + Supertest** — automated regression suite, runs against the real `https://api.weather-ai.co` base URL (no localhost/mocking). Chosen because it's fast to write, gives clear pass/fail output for a CI-style run, and Supertest's fluent API keeps HTTP assertions readable. Independently runnable per file (`npm run test:weather`, `npm run test:forecast`) so a reviewer can run just one endpoint's suite.
- **Postman** — exploratory and manual verification, mirroring the same test categories with `pm.test(...)` assertions. Useful for ad-hoc probing (e.g. trying an unexpected param combination while reading the docs side-by-side) and for a non-engineer reviewer to click through requests without reading code.
- **dotenv** — loads `WEATHERAI_API_KEY` / `WEATHERAI_BASE_URL` from `.env` so no secret is ever hardcoded or committed.

### Rate-limit testing rationale
The docs state the Free tier allows 1,000 requests/month (200 of which may use `ai=true`), resetting on a 30-day rolling window from subscription date — not a calendar month. Firing enough traffic to actually trigger a `429` would consume a large fraction of that budget in one test run, on the same key needed for all other testing during this assessment. Instead:
- Every test that doesn't need the AI summary passes `ai=false` to conserve the separate, much smaller AI quota.
- The rate-limit test suite asserts `X-RateLimit-Limit`, `X-RateLimit-Remaining`, and `X-RateLimit-Reset` are present, numeric, and internally consistent (`remaining <= limit`, `reset` is a plausible future Unix timestamp), and that `remaining` decrements by exactly one across two sequential calls.
- If a disposable/staging key becomes available, a follow-up test would fire requests in a tight loop until a `429` is observed and assert: correct status code, `{error, message}` shape, and (if present) a `Retry-After` header — documented here as a known gap rather than silently skipped.

## 4. Test cases

Legend: **Type** — F=Functional, A=Auth-negative, P=Param-negative, B=Boundary, C=Consistency, R=Rate-limit, E=Error-quality.

### `/v1/weather` (`tests/weather.test.js`)

| ID | Description | Type | Expected result |
|---|---|---|---|
| WX-001 | Valid lat/lon + valid auth, default params | F | 200; schema matches docs; `summary` present (ai defaults true) |
| WX-002 | Valid request with `ai=false` | F | 200; schema matches; no `summary` field |
| WX-003 | `units=imperial` | F | 200; `current.temperature` in plausible Fahrenheit range |
| WX-004 | `days=3` | F | 200; `forecast.length === 3` |
| WX-010 | No `Authorization` header | A | 401; `{error, message}` |
| WX-011 | `Authorization: Bearer ` (empty token) | A | 401; `{error, message}` |
| WX-012 | Auth header missing `Bearer` scheme | A | 401; `{error, message}` |
| WX-013 | Garbage API key with correct `wai_` prefix | A | 401; `{error, message}` |
| WX-014 | Key with wrong prefix (e.g. `sk_...`) | A | 401; `{error, message}` |
| WX-020 | Missing `lat` | P | 400; `{error, message}` |
| WX-021 | Missing `lon` | P | 400; `{error, message}` |
| WX-022 | Missing both `lat` and `lon` | P | 400; `{error, message}` |
| WX-023 | Non-numeric `lat` (`"abc"`) | P | 400; `{error, message}` |
| WX-024 | Non-numeric `lon` (`"xyz"`) | P | 400; `{error, message}` |
| WX-025 | `lat = 91` (> 90) | P | 400; `{error, message}` |
| WX-026 | `lat = -91` (< -90) | P | 400; `{error, message}` |
| WX-027 | `lon = 181` (> 180) | P | 400; `{error, message}` |
| WX-028 | `lon = -181` (< -180) | P | 400; `{error, message}` |
| WX-029 | Empty string `lat` | P | 400; `{error, message}` |
| WX-030 | Empty string `lon` | P | 400; `{error, message}` |
| WX-031 | `days = 8` (above Free-tier max of 7) | P | Either 400 with `{error, message}`, **or** 200 clamped to ≤ 7 days — must not silently return 8 |
| WX-040–044 | Exact boundary coords: N pole (90,0), S pole (-90,0), date line east (0,180), date line west (0,-180), equator/PM (0,0) | B | 200; valid schema |
| WX-050 | High-precision decimal coordinates (15 decimal places) | B | 200; valid schema |
| WX-060 | Two identical requests fired concurrently | C | Both 200; same forecast dates/length |
| WX-061 | Forecast dates are valid, unique, ascending | C | All dates parse; sorted ascending; no duplicates |
| WX-070 | Rate-limit headers on a single request | R | `X-RateLimit-Limit/Remaining/Reset` present, numeric, `remaining <= limit`, `reset` is a plausible future timestamp |
| WX-071 | Two sequential requests | R | `X-RateLimit-Remaining` decrements by exactly 1 |
| WX-080 | Missing auth + missing `lat` simultaneously | E | Status ≥ 400, never 200 |
| WX-081 | 401 / 400 (missing param) / 400 (out-of-range) fired together | E | All three: status ≥ 400, `Content-Type: application/json`, `{error, message}` shape |

### `/v1/forecast` (`tests/forecast.test.js`)

| ID | Description | Type | Expected result |
|---|---|---|---|
| FC-001 | Valid lat/lon + valid auth, `ai=false` | F | 200; schema matches |
| FC-002 | `days=5` | F | 200; `forecast.length === 5` |
| FC-003 | `/v1/forecast` vs `/v1/weather`, identical params | F | Both 200; identical forecast dates & length (alias parity) |
| FC-010 | No `Authorization` header | A | 401; `{error, message}` |
| FC-011 | Garbage API key | A | 401; `{error, message}` |
| FC-012 | Wrong key prefix | A | 401; `{error, message}` |
| FC-020 | Missing `lat` | P | 400; `{error, message}` |
| FC-021 | Missing `lon` | P | 400; `{error, message}` |
| FC-022 | Non-numeric `lat` | P | 400; `{error, message}` |
| FC-023 | `lat = 91` | P | 400; `{error, message}` |
| FC-024 | `lon = -181` | P | 400; `{error, message}` |
| FC-025 | Empty string `lat` | P | 400; `{error, message}` |
| FC-030–032 | Exact boundary coords: N pole, S pole, equator/PM | B | 200; valid schema |
| FC-040 | Two identical requests fired concurrently | C | Both 200; same forecast dates |
| FC-050 | Rate-limit headers on a single request | R | Present, numeric, `remaining <= limit` |
| FC-060 | 401 (no auth) | E | Status ≥ 400, JSON, `{error, message}` shape |

Postman collection (`postman/weatherai-qa.postman_collection.json`) mirrors the highest-value cases from both tables above (happy path, auth negatives, param negatives, boundary, consistency, rate-limit headers, error quality) for manual/exploratory use.

## 5. Assumptions

Response schema, param list, error shape, and rate-limit header names below are taken directly from the published docs at https://weather-ai.co/docs (fetched during test authoring) — not guessed:

```
current:  { temperature: number, condition: string, humidity: number, windSpeed: number }
forecast: [{ date: string, maxTemp: number, minTemp: number, condition: string, rainProbability: number }]
summary:  string (present when ai=true, the default)
error:    { error: string, message: string }
headers:  X-RateLimit-Limit, X-RateLimit-Remaining, X-RateLimit-Reset
```

If live responses diverge from this contract, that divergence is itself a finding — see `REPORT.md`.

## 6. Known blockers at time of writing

- Attempting to generate an API key via the WeatherAI dashboard currently returns an "internal server error," so no live key was available while this plan and its automation were authored.
- Independently of the key issue, `api.weather-ai.co` is currently returning `503` on every route tested (including with no `Authorization` header at all), with an HTML edge-CDN error body rather than a JSON application response. This was confirmed directly (see `REPORT.md` for the reproduction) and means the API backend itself is unreachable right now, not just gated behind auth.

All tests are written against the documented contract and are ready to run as soon as (a) the backend is back up and (b) a working key is dropped into `.env` (see `README.md`). Both blockers are reported as findings in `REPORT.md`.
