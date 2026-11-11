# Golden evaluation commands and release prerequisites

All handbook questions, source spans, review packets and live outputs belong in
private Git-ignored storage. Current local development material is under
`.local/golden-discovery/`. No dataset contents are included in this repository.

## Run locally

```sh
uv run pytest tests/test_golden*.py -q
uv run python -m evals.golden --private-dir /private/data --pdf /private/handbook.pdf --dataset development.jsonl
uv run python -m evals.retrieval --private-dir /private/data --pdf /private/handbook.pdf --dataset development.jsonl --max-calls 8 --allow-draft
uv run python -m evals.e2e --private-dir /private/data --pdf /private/handbook.pdf --max-requests 1 --allow-draft
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
category counts, time, attempts, missing citations and source/code hashes. The server
model/revision is not exposed by the API and is explicitly marked unavailable.

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
no judge, no retries, concurrency 1 and a 40-minute job limit. It requires:

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
held-out set or calibrated quality gate. Live runs have exposed missing citations and
omitted facts; mixed-answer success remains unverified. See `implementation-status.md`
for exact observed results. #11 must remain open until review, split, version provenance,
private storage, calibration and hosted validation requirements are met.
