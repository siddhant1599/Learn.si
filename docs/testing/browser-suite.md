# Browser suite

Automated browser coverage for Ask, Master and the landing page. What is covered,
and at which viewports and themes, is in [browser-coverage.md](browser-coverage.md).

## Run it

```sh
uv sync                                   # Python deps, including Playwright and pytest plugins
npm ci --prefix web                       # Frontend deps, including axe-core
uv run playwright install chromium        # Playwright-managed browser (add --with-deps on Linux CI)

uv run python -m scripts.run_browser_suite
```

The runner builds the frontend into its own directory (`web/.next-browser-3101`),
starts `next start` on port 3101 with the backend proxy pointed at an unroutable
address, runs every test, writes reports, and stops only the process it started.
Servers you already run (for example a production build on 3001 or a dev server)
are not touched.

Useful options:

| Option | Effect |
|---|---|
| `--base-url http://127.0.0.1:3001` | Test an already running frontend instead of building one |
| `--skip-build` | Reuse the previous isolated build |
| `--port 3105` | Use another port (and dist directory) for the isolated build |
| `--retries 1` | Rerun failures once; a pass on retry is reported as **flaky** and still fails unless `--allow-flaky` |
| `--test-timeout 240` | Fail any single test after N seconds |
| `-- -k quiz` | Pass arguments to pytest (select tests, `-x`, `--headed`, …) |

Exit code is non-zero when any test fails, on flaky tests (unless allowed), and when
the frontend cannot start.

Single files during development, against a running app:

```sh
E2E_BASE_URL=http://127.0.0.1:3001 uv run pytest e2e/test_quiz.py -q
uv run python -m scripts.check_web_master          # any existing script still runs on its own
```

`E2E_BASE_URL` sets the frontend for tests and the existing `scripts/check_web_*.py`.
Set `CHROME_PATH` only to use a specific local Chrome instead of Playwright's Chromium.

## Reports and artifacts

Written to `test-results/browser/` (git-ignored):

- `summary.md`: totals, failures with their first error line, flaky tests, skips with reasons.
- `results.json`: one record per test with every attempt, so a pass after a rerun is visible as flaky.
- `junit.xml`: for CI test reporting.
- `artifacts/`: Playwright traces and screenshots for failed tests. Open a trace with
  `uv run playwright show-trace test-results/browser/artifacts/<test>/trace.zip`.

CI (`.github/workflows/browser-suite.yml`) runs the suite on pull requests and `main`,
adds `summary.md` to the job summary, and keeps the results for 14 days.

## How tests are isolated

- **Fixture APIs.** `e2e/router.py` answers every `/api/rag` request. A request with
  no registered response is recorded as unexpected and fails the test; so does any
  request to a host other than the app. Default runs therefore never reach a live
  provider or touch real data.
- **Fresh state per test.** Each test gets a new browser context (cookies,
  localStorage, sessionStorage), a new router and a new fixture backend.
- **Errors fail tests.** Uncaught page errors and `console.error` messages fail the
  test that produced them. A test that provokes an error on purpose (for example a
  503) allows that exact pattern with `console.allow(...)`; the allowance does not
  leak into other tests.
- **No fixed sleeps for app state.** Tests use Playwright's web-first assertions and
  `wait_until` for Python-side conditions such as recorded requests. Time-based
  behavior (the study-time heartbeat) uses Playwright's clock.

## Fixtures

- `e2e/router.py` responders: `ok(payload, status)`, `error(detail, status)`,
  `sse(*frames)`, `malformed(body)`, `network_failure()`. Several replies on one
  route are used in order and the last repeats, which models fail-then-retry.
  `api.on(..., hold=True)` holds a request until `release_when_held(page, api, path, reply)`,
  which models loading and delayed responses. `api.calls(method, path)` returns
  request bodies for contract assertions.
- `ask_world` registers one synthetic source. `master` installs the stateful Master
  backend from `scripts/check_web_master.py`, built from `tests/fixtures/master`
  (a fictional archive handbook) and the app's own validators, grading and progress
  code, so responses have exactly the real API's shape.
- All fixture content is synthetic. Do not add real documents, chats or credentials.

## Extending coverage for a new feature

1. Add rows for each user-visible acceptance criterion to `browser-coverage.md`, with
   the test IDs you are adding, viewports and themes, or a reason it is N/A.
2. Add tests under `e2e/`, using the `api`, `master` or `ask_world` fixtures. Cover the
   success path and at least one empty, failed, retried or delayed response.
   Assert outcomes and request bodies, not only that the page renders.
3. If the feature adds a view, add it to `VIEWS` in `e2e/test_accessibility.py` so it
   gets axe checks in both themes and an overflow check.
4. Run the full suite three times locally; fix any flake before merging.

## Limits

These tests verify frontend behavior against controlled responses. They are not
evidence of real database persistence, provider availability or teaching quality.
Those are covered by backend tests (`uv run pytest`), the opt-in, credit-consuming
`scripts/check_web_live.py`, and the golden-dataset evaluation (#11).
