# Issue #11 implementation status

The first implementation slice adds `evals.golden`: a strict draft case schema,
source validator and deterministic retrieval metrics. It validates every annotated
span against a fresh extraction of the checksum-matched PDF, then checks every
chunk binding against the private SQL snapshot. Uploaded page sections must match
page IDs exactly. Duplicate IDs and declared families/exact normalized questions
crossing held-out boundaries are rejected. Semantic paraphrase detection still
requires independent annotation review.

Run privately from the repository root:

```sh
uv run python -m evals.golden --private-dir .local/golden-discovery --pdf /path/to/handbook.pdf
# Release eligibility additionally requires recorded independent approval:
uv run python -m evals.golden --private-dir .local/golden-discovery --pdf /path/to/handbook.pdf --release
uv run pytest tests/test_golden.py -q
```

The input directory currently follows the #10 pilot layout: `source-audit.json`,
`sql-chunks.json`, `pilot.jsonl`. No private artifacts are included in CI. Errors
contain row numbers and fixed codes, never question/quote text or validation input.
The validator does not contact the database or providers, and explicitly reports
that live index freshness has not been verified. Snapshot validation is not a
substitute for checking active vector generations before a live evaluation.

Retrieval metrics deduplicate scoped chunk IDs and report hit@1/3/5, reciprocal
rank, annotated-span coverage and all-evidence coverage. Evidence-free cases return
no positive retrieval score; empty search results are misses. These metrics do not
claim semantic grounding, per-fact correctness or answer quality.

Local validation on 2026-11-09: 21 synthetic tests passed. All 8 existing private
pilot cases pass source validation; all remain assistant-reviewed drafts. Release
validation must reject all 8 until actual independent review is recorded.
Offline GitHub Actions configuration has been added; hosted execution has not yet
been observed.

Remaining scope: full source-authored dataset and fact-to-evidence mappings;
independent approval and frozen grouped splits; durable private artifact storage;
active-index verification and live retrieval runner; SSE evaluation and safe
aggregate reports; explicit live budgets; reviewed baselines and calibrated gates.
Do not close #11 or claim a 96-case golden dataset from this initial slice.

## Live retrieval evaluator (continued implementation)

`evals.retrieval` now invokes the configured provider and actual scoped
`Storage.search` path, without modifying documents, vectors or conversations.
It validates the original PDF and every source reference first. Before and after
each search it checks the active SQL document generation, embedding signature,
edition and complete chunk snapshot. These checks detect reingestion and changed
text; they do not independently enumerate all Pinecone vectors.

```sh
uv run python -m evals.retrieval \
  --private-dir .local/golden-discovery --pdf /path/to/handbook.pdf \
  --max-calls 8 --allow-draft
```

Without `--allow-draft`, independent review is required. The call budget is required;
there are no evaluator retries. Each selected case has a bounded timeout (default
60 seconds). Follow-ups and non-positive retrieval cases are skipped explicitly,
not scored as successes. Failures are counted separately from quality denominators.
Output contains only aggregate metrics, category counts, version hashes and limits;
provider exception details and source/question text are excluded. Document UUIDs
are normalized before scoring.

Initial live pilot: 6 scored, 2 skipped, 0 errors; 6 embedding calls; hit@1 0.8333,
hit@3/5 1.0, MRR 0.8889, annotated-span coverage 1.0. One table case first matched
at rank 3. This is a draft development smoke baseline only; the two skipped cases
were an unanswerable query and a history-dependent follow-up. It establishes no
held-out answer-quality threshold. The aggregate JSON is private under
`.local/golden-discovery/retrieval-baseline.json`.

`evals.stream.StreamCheck` adds an in-memory SSE contract evaluator: final result
replacement, interrupted/error streams, duplicate final results, document/web
citation counts, section separation and the two-attempt web cap. Its summaries
never contain raw payloads. Section headings do not establish claim support;
semantic grounding remains explicitly pending review. This parser has synthetic
tests but is not yet a live end-to-end runner or persistence audit.

Remaining work includes full dataset authoring, fact-to-evidence mappings,
independent review, live SSE orchestration with isolated conversation cleanup,
semantic grading, baseline comparison and separately budgeted live CI. No release
quality gates or independent approvals have been invented.

## Live SSE evaluator (2026-11-10)

The `evals.e2e` command now calls the local running `/query` endpoint with real
providers. It creates a fresh SQL conversation UUID before each request and deletes
only that owned UUID in `finally`, including after network failures. Each request
has a timeout and the run requires an explicit request-count cap. No automatic
retry or LLM judge is used. The server's own per-request provider caps still apply;
the evaluator's request limit is not a dollar budget. Remote endpoints are rejected.

```sh
uv run python -m evals.e2e \
  --private-dir .local/golden-discovery --pdf /path/to/handbook.pdf \
  --max-requests 2 --allow-draft
uv run python -m evals.e2e \
  --private-dir .local/golden-discovery --pdf /path/to/handbook.pdf \
  --max-requests 1 --category unanswerable --allow-draft
```

Checks include SSE completion and final replacement, time to first token, elapsed
time, document citation identity/page/edition, annotated-page coverage, reported
web attempt cap, section headings when web citations exist, and equality between
stored assistant messages and the API's safe persisted representation. Web citation
fields and URLs in persisted messages are independently flagged. This is not a
semantic proof that every stored word is document-derived, nor an audit of browser
storage, provider logs or Pinecone persistence. Follow-ups currently skip because
history seeding and multi-turn evaluation remain to implement.

Live results:

- Two document cases completed in 4.764s and 11.071s. Both had 100% annotated-page
  citation coverage, valid source identities, matching saved messages, no web calls
  and successful owned-conversation cleanup. Together: 7 chat and 2 embedding calls.
- One unanswerable case completed in 5.494s and attempted web search once. It had no
  document or web citations, no persisted URLs/web citation fields, a matching safe
  saved message and successful cleanup. Usage: 3 chat, 1 embedding, 1 web attempt.
  This run exercised fallback activation but **did not exercise a mixed answer with
  web citations**. Do not claim live mixed-answer coverage from it.

Reports remain Git-ignored in `.local/golden-discovery/e2e-{smoke,fallback}.json`.
Questions, answers, web links and excerpts are not retained in those reports. The
running API does not expose its model/revision; reports explicitly mark that version
as unavailable rather than assuming the server matches local configuration. These
are development smoke results, not reproducible release-quality baselines.

`evals.compare` computes retrieval metric deltas only for compatible source,
dataset, embedding, index-binding and run-budget manifests with matching category
denominators. It rejects incompatible comparisons instead of manufacturing gains.
It imposes no uncalibrated quality threshold:

```sh
uv run python -m evals.compare /private/before.json /private/after.json
```

Outstanding #11 acceptance items remain the full proposed dataset, per-fact
annotations, independent review, grouped held-out freeze, durable private storage,
semantic grounding/abstention adjudication, mixed-answer live coverage, full provider
version provenance and separately budgeted live CI. Keep #11 open.
