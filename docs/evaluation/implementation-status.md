# Issue #11 implementation status

## Latest progress: partial-evidence synthesis (2026-11-12)

Ticket #11 remains open. The validator, retrieval/E2E evaluators, review tooling,
budget controls, report comparisons and CI definitions exist, with 99 private draft
cases. Independent review, an unexposed held-out set, durable private storage,
reviewed quality baselines/calibration and hosted CI execution remain outstanding.
The dated entries below retain earlier observations and their limitations.

A bounded in-memory diagnostic reproduced a mixed-question failure: document
assessment marked one part sufficient and another unsupported, but synthesis
abstained from the entire document answer. The prompt required acknowledging gaps
while also abstaining when the question could not be answered. Both document and
web synthesis now explicitly answer supported parts with citations, identify gaps,
and reserve complete abstention for questions with no supported part. Citation
validation, source isolation and provider-call limits remain enforced.

Validation: 450 backend tests passed, one skipped; Ruff and diff checks passed.
Two new synthetic regression cases exercise streaming and nonstreaming mixed
answers, separate evidence, global citation numbering and unsupported-question
coverage. Mocked generation checks contracts, not semantic model behavior.

Three bounded live `/query` runs on an isolated local server passed deterministic
E2E checks, with verified server/source/index identities and owned-thread cleanup:

| Case | Document / web citations | Chat / embedding / web calls | Completion |
|---|---:|---:|---:|
| Document-only pilot | 1 / 0 | 3 / 1 / 0 | 4.798s |
| Mixed document/public query | 2 / 2 | 6 / 2 / 1 | 20.528s |
| Unanswerable pilot | 0 / 0 | 3 / 1 / 1 | 7.009s |

Both answerable runs cited all annotated pages. The mixed result had separate
document/web sections. All three matched the safe stored response and contained
no persisted web URLs or web citation records. The unanswerable case exercised
fallback without producing citations; semantic abstention correctness was not
independently graded. Each run reserved at most 6 chat, 13 embedding and 2 web
attempts; no judge was used. Source text, questions and raw web outputs were not
stored in reports or committed. The isolated server was stopped afterwards.

The manifest-checked comparison with the preceding mixed run changed citation-page
coverage and contract pass from 0 to 1 with the same call counts. This is one
development case, not a reviewed quality baseline or proof of repeatability. Earlier
missing-citation failures on other cases are not declared resolved. The running
application on port 8001 was not restarted by this validation.

## Initial implementation

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

## Dataset expansion and fact provenance (2026-11-10)

The private `development.jsonl` now contains 62 draft cases: the original eight
pilot cases, 36 new direct questions (two per chapter), and 18 natural paraphrases
(one per chapter). Every new case was authored from the extracted handbook, not
from application answers. All 62 cases validate against a fresh checksum-matched
PDF extraction and the SQL chunk snapshot. Their exact questions, quotes and
private authoring script remain under `.local/golden-discovery/` and outside Git.

New `fact_evidence` entries map each required fact to zero-based indices into that
case's evidence list. Provided mappings must cover every fact, contain valid unique
indices, and never be empty. Release validation requires mappings for all facts;
legacy draft pilot cases remain readable but are not release eligible. Review dates
now use a validated date type rather than accepting arbitrary text.

All 62 cases remain development material and independently unapproved. Topic groups
keep paraphrases and related pilot cases together. No held-out claims are made for
this exposed set. The 96-case proposal is not satisfied simply by extending this
count: additional structured-table, conditional-number, cross-section, adversarial
and multi-turn cases still require careful authoring and review. Existing pilot
facts also need individual support mappings before release eligibility.

```sh
uv run python -m evals.golden --private-dir .local/golden-discovery \
  --pdf /path/to/handbook.pdf --dataset development.jsonl
```

This expansion received source validation only, not 62 live model evaluations.
The earlier live baselines still refer exclusively to the eight-case pilot hash.

## Complex coverage and follow-up evaluation

Private development coverage is now 94 draft cases: 37 direct, 18 paraphrase,
13 multi-page, 9 table, 9 numeric/conditional, 5 follow-up, and one each of
configuration, false-premise and unanswerable cases. This includes the original
pilot; these counts do not satisfy every quota in the 96-case proposal. In
particular, adversarial cases and a broader independently reviewed negative set
remain missing. Tables were checked against extracted rows, not independently
visually approved. All 94 cases pass source validation.

New numeric rubrics include units and explicit prohibited inversions. Multi-page
cases map each fact separately and declare related topic groups; the validator
rejects related groups crossing development/held-out boundaries. Original pilot
facts now have mappings in the development copy; the archived pilot is unchanged.
Negative cases require a recorded absence/ambiguity review method for release,
instead of fabricated positive evidence spans. Independent approval is still
required separately.

Follow-up context now uses validated user/assistant history turns. The E2E runner
seeds these into its owned conversation and cleans them up with that conversation.
This measures answering with supplied fixture history, not the quality of an
actual preceding generated answer. System-role history is rejected.

A live seeded follow-up completed in 8.782 seconds (4 chat, 2 embedding, 0 web
attempts) with successful cleanup and safe persistence. **It returned no document
citations: annotated-page coverage was 0%.** This is an observed quality failure,
not a successful answer baseline. The evaluator now explicitly flags missing
expected citations and returns a nonzero CLI status for that outcome. No production
answer-generation fix or causal explanation is claimed from this one run.
The private report `e2e-followup.json` predates that added flag and the pilot-map
update; its recorded dataset hash identifies the exact earlier draft used.

All current cases remain independently unapproved development data. Remaining work
includes adversarial/negative coverage, semantic review and grading, a genuinely
unexposed held-out set, durable private artifact storage, investigation of the
follow-up citation failure, live mixed-answer coverage and controlled live CI.

## Expanded live retrieval baseline and follow-up investigation

A live run against the 94-case development set scored 88 cases, with 6 explicit
skips (five history-dependent cases and one negative), zero provider errors and
88 embedding calls. A second run with unchanged evaluator/application code
reproduced the aggregate scores:

| Metric | Development result |
| --- | --- |
| Hit@1 | 0.5114 |
| Hit@3 | 0.7045 |
| Hit@5 | 0.8068 |
| MRR | 0.6212 |
| Annotated span coverage | 0.7784 |
| Fact-evidence coverage | 0.7784 |
| All required evidence retrieved | 0.7386 |

Every metric has denominator 88. Paraphrase evidence coverage was 0.6111;
all-evidence coverage for the 13 multi-page cases was 0.4615. These results use
single scoped `Storage.search` calls with question embeddings, not full agent
planning/refinement. They therefore identify retrieval limitations without
establishing end-to-end answer accuracy. They also show why the small eight-case
pilot was insufficient as a quality baseline.

The authoritative development smoke report for this iteration is private
`retrieval-development-frozen.json` (24.973 seconds). An earlier run completed
while evaluator files were being edited, so its implementation fingerprint is not
suitable for version attribution. The runner now fingerprints evaluator and
application Python files before execution and rejects the report if they change
during execution. The unchanged second run supersedes that earlier report.

Fact-evidence coverage requires every support reference mapped to a fact to be
retrieved. Unmapped facts are not silently scored as zero; metric denominators
explicitly count available annotations. This remains evidence-identity scoring,
not semantic claim grading.

A read-only graph diagnostic rerun of the failing seeded follow-up retrieved page
45 among its results, assessed evidence as sufficient and generated one citation.
It used four chat and one embedding call. The earlier zero-citation result is not
consistently reproduced; no deterministic production cause or fix is established.
Diagnostic output contained only stage names, counts and page numbers, not generated
answers or web content. No production behavior was changed during this investigation.

Validation for this iteration: 60 evaluation tests pass; full backend suite
384 passed, 1 skipped; lint passes. Independent review, remaining dataset categories,
held-out creation, private storage, mixed-answer live coverage and controlled live
CI remain outstanding. #11 stays in progress.

## Independent-review handoff tooling

`evals.review` now exports a private packet containing the original questions,
rubrics, evidence mappings and source spans, plus pending decisions. All 94 cases
are available in `.local/golden-discovery/review-packet-v2.json`; no approval has
been created. This is the current packet; the earlier packet predates the annotator
schema field and should not be used.

The reviewer must inspect the original PDF (especially rendered tables, units and
qualifications), record disagreements and explicitly attest source/rubric checks.
Negative/ambiguous cases additionally require an absence check. Decision hashes
bind reviews to the exact case content; annotation changes invalidate old decisions.
Duplicate, unknown, stale, incomplete and future-dated decisions are rejected.
The original annotator is preserved across rejection/re-review; self-approval is
rejected both during import and release validation. Reviewer identity is
self-attested: this local tool does not authenticate a human or independently prove
that review happened.

```sh
# Export to a NEW Git-ignored destination; existing files are never overwritten.
uv run python -m evals.review .local/golden-discovery/development.jsonl \
  .local/golden-discovery/review-packet-v2.json
# After an actual independent reviewer fills in the decisions:
uv run python -m evals.review .local/golden-discovery/development.jsonl \
  .local/golden-discovery/reviewed-development.jsonl \
  --decisions .local/golden-discovery/review-packet-v2.json
# Approval import is not source validation. Run the separate release check:
uv run python -m evals.golden --private-dir .local/golden-discovery \
  --pdf /path/to/handbook.pdf --dataset reviewed-development.jsonl --release
```

Packets and reviewed datasets are created with owner-only permissions (0600) and
must be Git-ignored. Public output contains counts only. Rejected cases remain
release-ineligible drafts, and pending cases are never implicitly approved. None
of this creates a held-out split or substitutes for source review, private durable
storage, adversarial/negative coverage, semantic grading or live CI. An independent
reviewer and a private artifact destination have been requested from the project
owner and remain outstanding.

## Final implementation pass and observed failures (2026-11-11)

Added optional bounded semantic grading to E2E, using every annotated fact and
source span. Output is restricted to validated structured scores; raw answers and
judge responses are not persisted. Scores are explicitly uncalibrated, and input
limits/errors are reported separately. E2E now records category summaries and
source/implementation hashes and rejects evaluator/app code changes during a run.

Added four isolated synthetic adversarial synthesis fixtures and a manually triggered
private-runner live CI definition. No hosted live CI execution is claimed: runner,
private artifact storage and environment secrets still require configuration.

Private handbook development coverage is now 99 drafts, including five new provisional
negative cases. The current review packet is v3 and creates zero approvals. The four
synthetic adversarial fixtures are separate; they are not handbook-derived questions.
Negative labels still require full-corpus independent absence review.

Final local verification: 414 backend tests passed, 1 skipped; lint and diff checks
passed. Regression coverage includes judge timeouts preserving application completion
and owned-conversation cleanup, and oversized rubrics making no provider call.

Observed live validation:
- One document answer completed but omitted its required fact and all document
  citations. The semantic judge reported 0% fact support; CLI correctly failed.
- Synthetic adversarial checks: 3/4 preserved the expected fact and valid citation.
  The role-spoofing case omitted both. No injected marker appeared in any answer.
  This is a narrow test failure, not proof of broader disclosure or security.
- One mixed document/current-web request attempted web once and completed, but
  produced no usable document/web citations. Expected-fact support was 0%; the
  uncalibrated judge also flagged unsupported document claims. Persistence/cleanup
  checks passed. Usage was 6 app chat calls, 2 embeddings, 1 web attempt, plus 1
  separately budgeted judge call. This is not successful mixed-answer validation.

The evaluation detects these failures; it does not fix production answer quality.
The remaining independent review, held-out data, calibration, authoritative server
version provenance, private runner/storage setup and successful hosted validation
remain requirements for closing #11. No acceptance criteria were weakened.

## Runtime verification and E2E baseline comparison (2026-11-11)

The local API now exposes nonsecret startup provenance at `/evaluation/runtime`:
source/dependency-lock fingerprint, Git revision/dirty state, process identity,
Python version, configured model/embedding and orchestration limits. It rejects
stale source/config snapshots. SSE sessions identify the serving process. The E2E
runner verifies the same runtime and unchanged corpus binding around every case.
Configured model identity is verified; an immutable upstream provider model revision
is still unavailable and is not inferred from the configured model name.

E2E report version 2 adds per-category denominators, explicit skip/error reasons,
p50/p95 with sample counts, observed/unknown usage, and total provider-attempt
reservations. Manual CI now has explicit chat/embedding/web caps. Baseline comparison
requires matching dataset, evaluator, configuration and attempted cases, and refuses
quality deltas when the contributing case sets differ. It allows application build
changes and reports changes in error rates separately. No quality thresholds or
independent approvals are created by comparison.

Validation:
- Backend: **448 passed, 1 skipped**; lint and diff checks passed.
- Frontend adapter/reducer/store: **67 passed**, including a regression confirming
  that the new session metadata is discarded from chat events.
- All **99** private draft cases passed source/span/chunk validation. Split counts
  are now printed explicitly: 13 pilot-development, 86 development, zero held-out.
- Two bounded live document smoke runs used an isolated server on port 8002, each
  reserving at most 6 chat/13 embedding/2 web attempts. Both completed, verified
  runtime/binding/cleanup and safe persistence, and used 3 chat/1 embedding/0 web
  attempts. Both lacked expected document citations and correctly exited with
  failure. Completion times were 6.091s and 4.117s. Their compatible comparison
  succeeded and reported unchanged failed citation coverage; these are not passing
  answer-quality baselines or statistically meaningful latency estimates.
- A separate mixed smoke run completed in 17.684s with 6 chat/2 embedding/1 web
  attempt. It returned two web citations with separate document/web headings and
  passed persistence/cleanup/runtime checks, but had no expected document citation.
  It correctly failed. No semantic judge was invoked in these three runs.

The temporary server was stopped after validation. The existing app on port 8001
was not restarted; it requires a normal restart to serve the new provenance endpoint.
Private reports remain Git-ignored. Outstanding closure requirements are independent
review/adjudication, an unexposed held-out set, reviewed quality baselines/calibration,
durable private storage, trusted live CI execution and resolution/adjudication of
the recorded answer-quality failures. The implementation is not a claim of release
benchmark approval.
