"""Run the complete browser suite against a production frontend.

    uv run python -m scripts.run_browser_suite                 # build + start an isolated app
    uv run python -m scripts.run_browser_suite --base-url URL  # use an already running app

Without --base-url it builds the frontend into its own dist directory
(web/.next-browser-<port>), starts `next start` on its own port with the backend
proxy pointed at an unroutable address, runs every test, and stops only the
process it started. Your running dev or production servers are never touched.

Every /api/rag request is answered by fixtures (e2e/router.py); unexpected requests,
requests to other hosts, page errors and console errors fail tests. Results:
test-results/browser/{junit.xml,results.json,summary.md} plus Playwright traces and
screenshots for failures. Mocked browser results verify frontend behavior only; they
are not evidence of real persistence, provider availability or teaching quality.
"""

import argparse
import json
import os
import signal
import subprocess
import sys
import time
import urllib.request
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
WEB = ROOT / "web"


def wait_for(url: str, process: subprocess.Popen | None, timeout: float = 120.0):
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process is not None and process.poll() is not None:
            raise SystemExit(f"Frontend exited early with code {process.returncode}")
        try:
            with urllib.request.urlopen(url, timeout=2) as response:
                if response.status < 500:
                    return
        except Exception:
            time.sleep(0.5)
    raise SystemExit(f"Frontend did not become ready at {url}")


def start_frontend(port: int, build: bool) -> subprocess.Popen:
    env = {**os.environ, "BROWSER_DIST_DIR": f".next-browser-{port}",
           # Any request that escapes the browser fixtures fails instead of reaching a backend.
           "RAG_BACKEND_URL": "http://127.0.0.1:9", "NEXT_TELEMETRY_DISABLED": "1"}
    if build:
        print(f"Building the frontend into web/.next-browser-{port} ...", flush=True)
        # `next build` with a custom distDir rewrites these to point at it; restore them
        # so a suite run never leaves the working tree modified.
        generated = {name: (WEB / name).read_text() for name in ("tsconfig.json", "next-env.d.ts")}
        try:
            subprocess.run(["npm", "run", "build"], cwd=WEB, env=env, check=True,
                           stdout=subprocess.DEVNULL if not os.environ.get("CI") else None)
        finally:
            for name, text in generated.items():
                (WEB / name).write_text(text)
    print(f"Starting an isolated frontend on 127.0.0.1:{port}", flush=True)
    return subprocess.Popen(
        ["npx", "next", "start", "--hostname", "127.0.0.1", "--port", str(port)],
        cwd=WEB, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.STDOUT,
        start_new_session=True,  # Its own process group: cleanup stops exactly this tree.
    )


def stop(process: subprocess.Popen | None):
    if process is None or process.poll() is not None:
        return
    os.killpg(process.pid, signal.SIGTERM)
    try:
        process.wait(timeout=15)
    except subprocess.TimeoutExpired:
        os.killpg(process.pid, signal.SIGKILL)


def summarize(results_path: Path, output: Path) -> tuple[str, int, int]:
    records = json.loads(results_path.read_text()) if results_path.exists() else []
    counts: dict[str, int] = {}
    for record in records:
        counts[record["outcome"]] = counts.get(record["outcome"], 0) + 1
    flaky = [r for r in records if r.get("flaky")]
    failed = [r for r in records if r["outcome"] == "failed"]
    skipped = [r for r in records if r["outcome"] == "skipped"]
    lines = ["# Browser suite results", "",
             f"Total {len(records)}: " + ", ".join(f"{k} {v}" for k, v in sorted(counts.items())), ""]
    if failed:
        lines += ["## Failed", *[f"- `{r['id']}`: {r.get('error', '')}" for r in failed], ""]
    if flaky:
        lines += ["## Flaky (failed first, passed on retry)", *[f"- `{r['id']}`" for r in flaky], ""]
    if skipped:
        lines += ["## Skipped", *[f"- `{r['id']}`: {r.get('skip_reason', '')}" for r in skipped], ""]
    lines += ["Fixture-backed: verifies frontend behavior, not real persistence, providers or teaching quality.",
              f"Traces and screenshots for failures: `{output}`"]
    text = "\n".join(lines)
    (output / "summary.md").write_text(text + "\n")
    return text, len(failed), len(flaky)


def main(argv=None) -> int:
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--base-url", help="use an already running frontend instead of building one")
    parser.add_argument("--port", type=int, default=3101, help="port for the isolated frontend")
    parser.add_argument("--skip-build", action="store_true", help="reuse web/.next-browser-<port>")
    parser.add_argument("--retries", type=int, default=0, help="rerun failures N times; reruns are reported as flaky")
    parser.add_argument("--allow-flaky", action="store_true", help="exit 0 when a test only passed on retry")
    parser.add_argument("--output", default="test-results/browser")
    parser.add_argument("--test-timeout", type=int, default=240, help="fail any single test after N seconds")
    parser.add_argument("pytest_args", nargs="*", help="extra pytest arguments, e.g. -k quiz")
    args = parser.parse_args(argv)

    output = (ROOT / args.output).resolve()
    output.mkdir(parents=True, exist_ok=True)
    results = output / "results.json"
    results.unlink(missing_ok=True)
    process = None
    base = args.base_url
    try:
        if not base:
            process = start_frontend(args.port, build=not args.skip_build)
            base = f"http://127.0.0.1:{args.port}"
        wait_for(base + "/", process)
        command = [sys.executable, "-m", "pytest", "e2e", "-p", "no:cacheprovider",
                   "--timeout", str(args.test_timeout),
                   "--tracing", "retain-on-failure", "--screenshot", "only-on-failure",
                   "--output", str(output / "artifacts"), "--junitxml", str(output / "junit.xml"), "-q"]
        if args.retries:
            command += ["--reruns", str(args.retries)]
        command += args.pytest_args
        env = {**os.environ, "E2E_BASE_URL": base, "E2E_RESULTS": str(results)}
        print(f"Running the browser suite against {base}", flush=True)
        code = subprocess.run(command, cwd=ROOT, env=env).returncode
    finally:
        stop(process)
    text, failed, flaky = summarize(results, output)
    print("\n" + text)
    if code != 0 or failed:
        return code or 1
    if flaky and not args.allow_flaky:
        print("Flaky tests passed only on retry; failing (use --allow-flaky to accept).")
        return 3
    return 0


if __name__ == "__main__":
    sys.exit(main())
