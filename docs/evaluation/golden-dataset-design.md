# Golden dataset discovery and design — issue #10

Research date: 2026-11-09. This is a design deliverable, not a completed evaluation pipeline or a Builder.ai accuracy benchmark. Application baseline: `4b250fe`. Source audit used read-only SQL, read-only Pinecone fetches and local PDF extraction. No documents or vectors were modified, and no handbook text was sent to a model or web search.

## Decision

The available Builder.ai architecture handbook is suitable as a **frozen-document RAG evaluation corpus**, subject to independent annotation review. It is not proof of the current Builder.ai implementation or a general company-policy handbook. Freeze the PDF checksum as the authority for “according to this handbook” questions. Its metadata and cover identify it as generated from a repository's master branch, but provide no immutable source-code commit. Do not evaluate current-code correctness without separately identifying that revision.

The full golden dataset and evaluation pipeline remain #11. Eight pilot-development cases are drafted privately, source-reviewed by the coding assistant and structurally checked, but not independently human-reviewed. They must not be labelled human-approved or used as held-out release gates.

## What the sample actually does

Paths in this section are relative to the local `Agentic_RAG-sample-project` folder. It is a source snapshot without `.git`; file hashes are recorded in `sample-source-manifest.json` instead of inventing a revision.

| Stage | Verified source | Behavior and limitations |
|---|---|---|
| Case storage | `Backend/evals/golden.jsonl` | 51 cases: 40 factual, 4 table, 5 direct, 2 not-in-graph. Each uses `id/type/question/expected/facts`. 49 enter retrieval evaluation. |
| Loading/matching | `Backend/evals/common.py` | Loads JSONL; a section or descendant matches, tables have special matching rules; first expected match defines reciprocal rank. No document/version identity. JSON result files record commit/time but names can overwrite previous runs. |
| Source validation | `Backend/evals/check_dataset.py` | Duplicate IDs; primary expected section/table lookup in Neo4j; case-insensitive fact substrings in primary-source text. Checks only `expected[0]`; skips not-in-graph cases. Does not verify all references, independent annotations or true absence. |
| Retrieval | `Backend/evals/retrieval_eval.py` | Actual retriever plus variants, cached query embeddings, hit@1/3/5 and MRR, category breakdown. Ignores not-in-graph cases. Thresholds apply to the final selected variant; empty subsets are not safely handled everywhere. First-hit metrics do not establish multi-source completeness. |
| End-to-end | `Backend/evals/e2e_eval.py` | Calls `/api/chat` with `no_cache:true`, reads text/source/meta SSE parts; measures response presence, source-ID match, normalized fact substrings, web-used rates and latency. The “citation hit” function matches returned IDs; it does not itself query Neo4j to establish claim support. Saves full answers/questions in result artifacts. |
| Optional judge | same file | Hydrates only the first expected source, truncates reference and answer to 6,000 characters, asks a Google model for 1–5. This can miss cross-source support and inherits judge bias. |
| CI | `.github/workflows/evals.yml` | Main/backend pushes run source check and retrieval with hit@3 ≥ .95 and MRR ≥ .90. Scheduled/manual runs also evaluate 8 evenly spaced cases against the deployed app with citation-hit ≥ .75. `--judge` is not passed. Live Neo4j/Google secrets are needed; this is not offline CI. Artifacts and summaries are uploaded. Workflow presence was verified, not successful hosted runs. |
| Older path | `Backend/data/langsmith_evaluation_dataset.csv`, `Backend/experimentation_phase/migrated_root/run_langsmith_evals.py` | Separate 5-row input/output dataset and LangSmith upload/evaluation entry point. No reference in the inspected active eval workflow/docs; treat as legacy, not a second active release gate. |

The sample README's reported gains are historical claims, not reproduced measurements here. Its warning about tuning on a small evaluation set is relevant. Do not copy its thresholds, full-answer artifact retention, or hierarchical section matching into this project unchanged.

## Builder.ai source and index audit

Private audit artifacts are under `.local/golden-discovery/` (Git-ignored). The original PDF was found locally in Downloads. No PDF contents or source-derived questions are included in this tracked document.

| Check | Observed result |
|---|---|
| PDF | 62 pages, 187,910 bytes; metadata creation date September 6, 2026 |
| Text extraction | 62 nonempty pages; 167,938 extracted characters; no empty pages |
| SQL ingestion | 62 page-based sections, 110 chunks |
| Re-extraction comparison | All section IDs, chunk indices, page numbers and text match current SQL exactly |
| Pinecone | All 110 SQL chunk IDs fetched; document ID, active generation, embedding signature and 768-dimensional values match |
| Float tolerance | Maximum absolute SQL/Pinecone vector difference about 7e-9, below the 1e-6 comparison bound |
| Embeddings | `openrouter:openai/text-embedding-3-small:768` |
| Chunking | 2,400 characters with 240-character overlap, independently within each page |
| Provenance gaps | SQL edition is only `Uploaded`; source URI is empty; no stored PDF checksum or source-code commit |

The PDF claims 18 chapters plus request traces and a glossary. It includes prose, code/configuration, tables, numeric conditions and explicit limitations, making it useful for multiple question types. Extraction preserves text but flattens table rows and includes repeating headers/footers, contents-page entries and occasional bullet artifacts. Page 34 was also rendered and visually checked: its multi-column table corresponds to extracted row text, but the index has no table-specific structure. This is a spot check, not a visual audit of every page.

**Critical mapping difference:** uploaded section IDs are PDF page numbers. A handbook heading such as “10.2” is not an indexed section ID. Do not reuse the sample's section-prefix matcher or consider a table of contents mention sufficient evidence. Map curated semantic headings to page/spans and current chunks. Chunk IDs and vector generations change on reingestion; durable gold references must use corpus hash plus page/span and text hash, with a separate current-index binding.

Pinecone contains vector metadata, not authoritative text. SQL hydration must still enforce selected document and active-generation filters. Fetch alignment proves storage consistency, not retrieval recall or handbook factual correctness. No live retrieval-quality or answer-quality evaluation was performed for #10.

## Proposed case and corpus contracts

Version both independently. Private manifest fields:

- `schema_version`, `corpus_id`, PDF SHA-256, private source location, source owner/permission status, edition label and creation metadata; source-code revision null when unknown.
- Extraction library/version, normalization rules, per-page hashes, character/page counts, chunk size/overlap, embedding model/dimensions/signature, document ID, active vector generation and binding timestamp.
- A corpus hash mismatch invalidates the binding; a generation change requires rebinding even when the PDF is unchanged.

Case fields (draft v0.1; #11 implements validation):

| Field | Contract |
|---|---|
| `id`, `schema_version`, `category`, `group_id` | Unique stable case ID; explicit schema version; one primary category, optional secondary tags; semantic family for leakage control |
| `question`, optional `history` | Natural user wording; history is test input, never ground-truth evidence |
| `corpus_sha256`, `document_id`, `document_edition` | Scope anchored to frozen source; runtime document binding checked separately |
| `expected_answerability` | sufficient / partial / not_in_document / needs_clarification; cannot infer absence just because retrieval missed |
| `required_facts`, `prohibited_claims` | Semantic rubric including conditions, units, scope, negation and conflicting qualifications; optional reference answer derived from source |
| `evidence[]` | Page, semantic heading if curated, indexed section ID, exact extracted character interval, quote hash, private quote and current chunk IDs; validate every entry |
| `expected_web_fallback` | avoid_if_retrieved / attempt_if_available / do_not_search_for_clarification; actual fallback errors counted separately from activation correctness |
| `review` | Reviewer identity/role, method, status, date, disagreements and adjudication; do not equate machine span checks with human review |
| `split` | pilot-development / development / held-out; assigned by semantic group and frozen before tuning |

For comparisons needing multiple facts, give each fact its supporting evidence references; first-hit retrieval alone cannot pass a multi-source case. For negative cases, retain the review's absence-search method and corpus scope rather than an invented supporting quote. For partial cases, score supported and unsupported parts separately. For conflicting sources, absence of precedence must remain explicit.

## Pilot proposal

Private `pilot.jsonl` has eight cases spanning direct lookup, cross-page explanation, table relations, numeric qualifications, configuration, false premise, unanswerable measurement and follow-up resolution. Seven cases have direct supporting spans; the negative case deliberately requests a measurement not supplied by the document. Its absence check plus source reading supports a provisional negative label, not a formal proof of absence. Two related cases share one leakage-control group.

All positive supporting spans match both PDF extraction and at least one SQL chunk. Quotes and source-derived questions stay private. Review state is `assistant_source_reviewed_pending_human`; a human should inspect the rendered pages, numeric interpretations, table rows and negative case before approving the pilot. The pilot is development material forever; do not move these exposed cases into held-out evaluation.

## Coverage and dataset size proposal

Start with **96 cases**, subject to human source audit rather than filling quotas with duplicates:

| Primary category | Proposed cases | Basis |
|---|---:|---|
| Direct facts | 36 | Two distinct facts per claimed chapter |
| Paraphrase/concept | 18 | One per chapter; grouped with related direct cases |
| Cross-section/traces | 12 | Multiple dependencies and request-flow narratives |
| Tables/structured relationships | 8 | Curated rows, validated visually before inclusion |
| Numeric/conditional | 8 | Units, timeouts, scopes and conditions |
| Missing information/false premises | 6 | Reviewed absence; distinguish internal facts from generic external knowledge |
| Adversarial retrieved instructions | 4 | Synthetic injected passages in isolated fixtures, never mutate the handbook corpus |
| Follow-ups/ambiguity | 4 | Bounded context and clarification behavior |

Approximately two-thirds development and one-third held out, assigned by topic/fact/paraphrase family, not random individual rows. Quotas and split sizes may move by a few cases to preserve family isolation. Cover every chapter in development and a broad topic range in held out; neither copy the pilot nor use the same fact with new wording across splits. Author from the PDF, independently review, adjudicate disagreements, then freeze. Hold-out access belongs to the evaluator; tuning uses development only. Record exclusions for unreadable/ambiguous content instead of inventing labels.

## Evaluators and release policy for #11

1. **Source validator:** verify schema, duplicate IDs/families, corpus hash, every span, every reference and active index binding. Unknown/outdated references fail visibly; no empty denominator reported as perfect.
2. **Retrieval:** invoke `Storage.search` through current scoped embedding/search infrastructure; report hit@1/3/5, MRR, per-fact evidence recall and all-required-evidence coverage. Deduplicate overlap before scoring. Exclude truly unanswerable cases from positive retrieval denominators but report their count separately. Do not reuse the sample's numeric heading prefix rule.
3. **End-to-end:** call `/query` with selected document IDs, consume session/progress/token/result/error SSE, score the final replacement only. Use isolated evaluation conversations and cleanup by recorded test-created IDs; never delete user threads. Measure source-attributed claims, correct evidence, false-sufficient/insufficient outcomes, abstention and contradictions. Streaming contract checks remain separate from semantic scoring.
4. **Automatic fallback:** measure necessary versus unnecessary search against annotated answerability AND observed retrieval coverage. A document-answerable case that misses retrieval and falls back is a retrieval failure, not automatically a routing defect. Missing internal measurements must not become claims sourced from general web guidance. Verify separate sections, public links, two-attempt cap, failed calls and restored-chat behavior.
5. **Timing/cost:** time-to-first-token, completion p50/p95, error rate, provider/chat/embedding/web attempts, model/config versions. Existing usage does not supply billed token costs; label estimates and add instrumentation in #11 before claiming exact cost.
6. **Judging:** lexical checks only for unambiguous exact identifiers/numbers; semantic human rubric for paraphrases, negation and support. Optional model judge receives all relevant reference spans, is blind to system variant, and is calibrated against human labels. Judge scores alone do not close regressions.

Use an initial eight-case live smoke run before a full baseline. At current configured defaults, eight requests have upper bounds of 48 chat attempts, 104 embedding attempts and 16 Tavily attempts; actual usage should be lower. These are call caps, not dollar budgets. Runtime bounds and concurrency also apply. External evaluators/judges need an additional explicit budget. Run no live CI without configured budget/credentials. Do not silently substitute a different model after failure.

Offline CI uses synthetic fixtures without secrets; nightly/manual live runs use private reviewed data and sanitized aggregate artifacts. Gate schema validity, source scope, cap violations, fabricated references and persistence leaks immediately. Set quality thresholds only after a repeated reviewed baseline with paired before/after comparisons; report all changed cases and require no newly adjudicated unsupported internal claims. Do not copy .95/.90 from the sample or treat 1–2 cases on a small set as established gains.

## Privacy and outstanding decisions

The original PDF, extracted pages, SQL text, exact private index identifiers, manifest and pilot are Git-ignored under `.local/golden-discovery`. This is a local working location, not a durable encrypted team artifact store. #11 must establish the private artifact destination, access control and retention policy. Keep only generic schemas, sanitized fixture examples and aggregate reports in Git. Never persist web URLs, snippets or generated web answers in eval logs/reports; score them in memory and retain aggregate/source-type outcomes.

Still needed before release-grade dataset approval: independent handbook reviewer; permission to distribute private artifacts; durable private storage and CI access; confirmation of PDF edition/source-code revision if current-code accuracy is desired; user-question distribution to adjust category quotas; accepted live run budget. These are implementation/release inputs, not reasons to invent missing provenance or abandon the discovery findings.

## Dependency-only implementation handoff

#11 remains the implementation ticket. Execute its phases in order:
1. Freeze private manifest and schema; confirm reviewer/storage/budget.
2. Review pilot, author remaining cases, adjudicate and freeze grouped splits.
3. Implement source validator and index rebinding.
4. Implement retrieval evaluator and baseline.
5. Implement end-to-end/fallback evaluator and privacy-safe reports.
6. Calibrate gates and integrate offline/live CI.

Do not create competing priority rankings. #10 adds no production code, reindexing, bulk dataset or evaluation runner. Keep #11's 15 planned test cases and add explicit coverage for page-ID versus heading-ID mismatch, full-reference validation and independent reviewed split enforcement.
