# Golden evaluation commands and release prerequisites

All handbook questions, source spans, review packets and live outputs belong in
private Git-ignored storage. Current local development material is under
`.local/golden-discovery/`. No dataset contents are included in this repository.

## Run locally

```sh
uv run pytest tests/test_golden*.py -q
uv run python -m evals.golden --private-dir /private/data --pdf /private/handbook.pdf --dataset development.jsonl
uv run python -m evals.retrieval --private-dir /private/data --pdf /private/handbook.pdf --dataset development.jsonl --max-calls 8 --allow-draft
uv run python -m evals.e2e --private-dir /private/data --pdf /private/handbook.pdf --max-requests 1 --max-chat-calls 6 --max-embedding-calls 13 --max-web-calls 2 --allow-draft
# Optional semantic judge: at most one additional provider call per reserved slot.
uv run python -m evals.e2e --private-dir /private/data --pdf /private/handbook.pdf --max-requests 1 --max-judge-calls 1 --allow-draft
# Four isolated synthetic retrieved-instruction tests, four chat calls maximum.
uv run python -m evals.adversarial --live
```

The optional judge checks every fact and annotated span, including qualifications,
contradictions, prohibited claims, abstention and document/web attribution. Input and
raw output stay in memory. It returns only structured scores. Oversized input is
skipped explicitly, not silently truncated. Provider failures are separate errors.
The configured application model also serves as judge; correlated model bias is a
limitation. Scores remain uncalibrated and cannot enable release gates until
compared with independently reviewed labels. Synthetic unit tests validate the
scoring contract, not semantic judgment accuracy.

The adversarial suite uses synthetic evidence directly in the synthesis agent,
without writing to SQL or Pinecone. It checks the expected fact, valid citations
and absence of an injected marker. It does not establish general prompt-injection
resistance or inspect all possible disclosures.

E2E commands require the local API on port 8001 and its matching database in the
process environment. Evaluator-owned conversations are deleted after each case.
History is fixture-seeded; original app answers are not manufactured. Reports include
category counts, time, attempts, missing citations and source/code hashes. The API's
`/evaluation/runtime` endpoint reports its startup source/lockfile fingerprint, Git
revision and dirty state, process instance, Python version, configured model, embedding
signature and nonsecret retrieval/orchestration settings. Credentials, DSNs, private
source text and index/namespace names are excluded. The endpoint returns 409 after
source/config changes until the server restarts. Each SSE session identifies its
server instance; E2E verifies that instance and the corpus binding before and after
every case. An old server without this endpoint fails preflight. `--base-url` can
select another loopback port for an isolated evaluation server.

This records the configured model, not an immutable upstream model revision or the
identity chosen by a provider's free-model router. Those remain unverified. A source
fingerprint includes the dependency lockfile, not a proof of installed binary identity.

Before dispatch, E2E reserves the server's maximum chat/embedding/web attempts for
each request. Optional `--max-chat-calls`, `--max-embedding-calls`, `--max-web-calls`
bound the entire run; omitted caps default to request count times server caps. Cases
that cannot fit are explicitly skipped, even if a previous case used fewer calls.
Judge slots have a separate cap. Reported usage and unknown usage are separate;
timeouts cannot silently count as zero-cost successes. These bounds are call budgets,
not dollar costs. Per-category reports include explicit denominators and p50/p95
latency, with sample counts. Tiny smoke runs do not establish stable latency estimates.

Compare saved sanitized reports with:

```sh
uv run python -m evals.compare /private/before.json /private/after.json
```

E2E report version 3 comparisons require the same dataset, index binding, evaluator,
selection/call budgets, server configuration and attempted cases. Server application
build changes are allowed. Completion/error changes are reported; a quality metric
delta is unavailable when the contributing case sets differ, even when counts match.
Comparisons do not invent thresholds or approve a baseline. Earlier report versions
are rejected rather than rescored under a different contract. Version 3 requires
every annotated page to be cited in the document answer, validates in-text reference
numbers against the returned catalog, and rejects document/web references in the
wrong section. Section headings must be unique, ordered and nonempty, including
fallback responses that return no web citations. These are structural checks; real
page identities and correct section placement do not prove semantic claim support.

## Independent review

Export a new packet with `python -m evals.review INPUT.jsonl PRIVATE-OUTPUT.json`.
An independent reviewer fills out the pending decisions after inspecting the PDF.
Import with `--decisions PRIVATE-OUTPUT.json` into a new private JSONL file, then run
`evals.golden --release`. Do not self-approve or relabel exposed development cases as
held-out. Reviewer identity is self-attested; this utility is not authentication.
The current packet is `review-packet-v3.json`, covering 99 private handbook drafts;
older packets do not cover the new negative cases. Four synthetic adversarial fixtures
are separate from these handbook cases and never represented as handbook content.

## CI

`golden-offline.yml` uses sanitized fixtures without provider credentials.
`golden-live.yml` runs manually on main only, with a request cap chosen from 1/2/4/8,
no judge, no evaluator retries, concurrency 1 and a 40-minute job limit. Total caps are
6 chat, 13 embedding and 2 web attempts per requested case, including app recovery
attempts. A server requiring larger reservations causes explicit skips/failure instead
of increasing the budget silently. It requires:

- A trusted dedicated self-hosted runner labelled `document-lab-evals`, with uv installed.
- A `golden-evaluation` GitHub environment; configure its protection rules before use.
- Environment variables `EVAL_PRIVATE_DIR`, `EVAL_PDF_PATH`, `EVAL_DATASET` pointing to
  independently approved data outside the checkout directory.
- Environment secret `EVAL_DATABASE_URL`, and a matching local API at port 8001.

Keep private files outside checkout: checkout cleanup can remove untracked files.
The live job performs release validation first and cannot silently use drafts. It
prints sanitized reports only; it uploads no private dataset or raw answer artifacts.
Runner provisioning, access controls, approved private storage and successful hosted
execution have not been established here. The workflow definition alone is not a
successful live CI run. Request caps are not dollar budgets; configure server provider
limits and account spending controls appropriate to the selected run.

## Current limitations

All 99 handbook cases remain development drafts. There is no independently approved
held-out set or calibrated quality gate. After correcting synthesis and citation
handling, the latest eight-case pilot and separate mixed-answer smoke case passed
the stricter citation, section separation and safe persistence checks. Four isolated
synthetic adversarial fixtures also passed. Semantic quality, general attack
resistance and repeatability remain unverified. See
`implementation-status.md` for exact observed results. #11 must remain open until review, split,
private storage, calibration and hosted validation requirements are met.
