# WeatherAI QA Assessment

QA test plan, automated test suite, and Postman collection for the [WeatherAI
developer API](https://weather-ai.co/docs), covering `GET /v1/weather` and
`GET /v1/forecast`.

- **`TEST_PLAN.md`** — scope, testing types, tools, and the full test case list.
- **`REPORT.md`** — findings and recommendations from the live test run (see status note at the top of that file).
- **`tests/`** — Jest + Supertest automated suite, run against the real API (no mocking, no localhost).
- **`postman/`** — Postman collection mirroring the same test categories for manual/exploratory use.

## Prerequisites

- Node.js 18+
- A WeatherAI API key (`wai_...`), generated from the [developer dashboard](https://weather-ai.co/docs)

## Setup (< 5 minutes)

```bash
git clone <this-repo-url>
cd weatherai-qa-assessment
npm install
cp .env.example .env
```

Open `.env` and set your key:

```
WEATHERAI_API_KEY=wai_your_real_key_here
```

## Running the tests

```bash
npm test              # full suite (weather + forecast)
npm run test:weather  # /v1/weather only
npm run test:forecast # /v1/forecast only
```

Tests hit the live API at `https://api.weather-ai.co` (override with
`WEATHERAI_BASE_URL` in `.env` if needed, e.g. for a staging environment).
No key = the suite fails fast with a clear error telling you to set one,
rather than a wall of confusing 401s.

## Running the Postman collection

1. Import `postman/weatherai-qa.postman_collection.json` into Postman.
2. Set the collection variable `api_key` to your real key (Collection →
   Variables tab), or create a Postman environment that overrides it. Do not
   commit a real key into the collection file itself.
3. Run individual requests, or use the Collection Runner to execute a folder
   (Happy Path, Auth Negative Cases, etc.) in sequence.

## A note on API quota

The Free tier is capped at 1,000 requests/month (200 of which may use
`ai=true`). Most test cases pass `ai=false` to conserve the smaller AI quota.
The rate-limit tests intentionally inspect response headers on a couple of
requests rather than firing enough traffic to trigger a 429 — see
`TEST_PLAN.md` § "Rate-limit testing rationale" for why, and what a fuller
test would look like against a disposable key.

## Project structure

```
weatherai-qa-assessment/
├── README.md
├── TEST_PLAN.md
├── REPORT.md
├── .env.example
├── package.json
├── jest.config.js
├── tests/
│   ├── helpers/
│   │   ├── apiClient.js
│   │   └── assertions.js
│   ├── weather.test.js
│   └── forecast.test.js
└── postman/
    └── weatherai-qa.postman_collection.json
```
