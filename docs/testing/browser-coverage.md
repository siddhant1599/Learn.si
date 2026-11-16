# Browser coverage matrix (#35)

Every in-scope, user-visible frontend behavior from #12–#17, #18–#32, #33 and #34,
mapped to executable browser tests. Run them all with
`uv run python -m scripts.run_browser_suite` (see [browser-suite.md](browser-suite.md)).

Status: **Covered** (existing regression), **New** (added in #35), **N/A** (not
applicable, with reason), **Outstanding** (known gap, tracked). Test IDs are pytest
node IDs under `e2e/`; `existing:<name>` is `e2e/test_existing_checks.py::test_existing_browser_check[<name>]`,
which runs `scripts/<name>.py`.

All tests use fixture APIs (`e2e/router.py`). They verify frontend behavior, request
contracts and browser storage, **not** real database persistence, provider
availability or AI teaching quality: those are covered by backend tests
(`uv run pytest`), the opt-in `check_web_live` and the golden-dataset work (#11).

Viewports and themes: Chromium only. Desktop is 1440×900 unless noted; phone is 390 px.
Workspace views are checked in light and dark; the landing page is intentionally
dark-only.

## Landing and docs (#12, #13, #15, #19, #33, #34)

| Behavior | Tests | Viewports / themes | Status |
|---|---|---|---|
| Every learning CTA reaches the chooser; no per-mode landing CTA | `test_landing.py::test_every_learning_cta_goes_to_the_chooser_never_to_a_mode`, `existing:check_web_landing` | 1440 | New + Covered |
| Header, mobile menu and footer links | `test_landing.py::test_header_footer_and_mobile_menu_links`, `existing:check_web_docs` | 1440, 390 | New + Covered |
| Product images load with reserved dimensions; full-size links resolve | `test_landing.py::test_product_images_load_with_reserved_dimensions`, `existing:check_web_landing` | 1440 | New + Covered |
| Landing privacy wording matches the docs | `test_landing.py::test_privacy_wording_on_landing_matches_the_docs` | 1440 | New |
| Scripted-illustration labels; Ask demo replay; keyboard tabs | `test_landing.py::test_demos_are_labeled_scripted_and_replay_restarts_the_run`, `existing:check_web_landing`, `existing:check_web_frontend` | 1440 | New + Covered |
| Ordering exercise: correct and incorrect | `existing:check_web_landing` | 1440, 390 | Covered |
| Ordering exercise: partial verdict, movement limits, reveal | `test_landing.py::test_ordering_partial_verdict_boundaries_and_reveal` | 1440 | New |
| Demo quiz fail → retake → pass updates demo progress | `existing:check_web_landing` | 1440, 390 | Covered |
| Hero, scroll stage, reduced motion | `existing:check_web_landing`, `existing:check_web_frontend` | 1440, 390, reduced motion | Covered |
| Docs navigation, search, anchors, history, refresh, 404, all 14 pages | `existing:check_web_docs` | 1440, 390, light/dark | Covered |
| Landing in light theme | — | — | N/A: the landing page is intentionally dark |

## Mode chooser and navigation (#20)

| Behavior | Tests | Viewports / themes | Status |
|---|---|---|---|
| Keyboard selection; remembered mode without auto-skip; Ask/Master switching; deep links; back/forward; collapsed rail; mobile sidebar | `existing:check_web_modes` | 1440, 390, light/dark | Covered |
| Master empty state | `existing:check_web_modes`, `test_courses.py::test_course_deletion_cancel_failure_retry_and_source_kept` | 1440 | Covered |
| Loading and error states with retry | `test_courses.py::test_library_loading_error_and_retry`, `test_progress.py::test_overview_loading_empty_error_and_refresh` | 1440 | New |

## Ask and live activity (#9, #14, #17)

| Behavior | Tests | Viewports / themes | Status |
|---|---|---|---|
| Upload validation, backend error message, retry, status, auto-selection | `test_ask.py::test_upload_validation_backend_error_and_retry` | 1440 | New |
| Native file chooser; sending requires a source | `existing:check_web_frontend` | 1440 | Covered |
| Source selection limit (5) | `test_ask.py::test_source_limit_is_five` | 1440 | New |
| Send / Stop | `test_ask.py::test_stop_interrupts_a_streaming_answer` | 1440 | New |
| Incremental tokens before the result; final text replaces the draft | `existing:check_web_streaming` | 1440, 390 | Covered |
| Out-of-order / stale activity, concurrent tasks, recovery, late failure | `existing:check_web_streaming` | 1440, 390 | Covered |
| Incomplete or malformed streams and HTTP errors surface an error; retry succeeds | `test_ask.py::test_incomplete_stream_is_an_error_not_a_silent_success`, `test_ask.py::test_malformed_stream_and_http_errors_are_reported` | 1440 | New |
| Final citations; bounded follow-up request with server thread ID | `existing:check_web_frontend`, `existing:check_web_streaming` | 1440 | Covered |
| Sufficient-document path vs automatic web fallback; separate sections and citations; web data excluded after reload | `existing:check_web_research` | 1440, 390 | Covered |
| Missing (deleted) source blocks follow-ups; unavailable citations | `existing:check_web_deletions` | 1440, 390 | Covered |
| Ask journey on a phone | `test_accessibility.py::test_ask_journey_on_a_phone` | 390 | New |

## Courses and plans (#21, #22, #27, #28)

| Behavior | Tests | Viewports / themes | Status |
|---|---|---|---|
| Create from upload; generation progress; plan appears | `existing:check_web_master`, `test_accessibility.py::test_master_journey_on_a_phone_in_dark` | 1440, 390 dark | Covered + New |
| Create from an existing source | `test_courses.py::test_create_from_existing_source_and_no_duplicate` | 1440 | New |
| Duplicate course: a source with a course is not offered again | `test_courses.py::test_create_from_existing_source_and_no_duplicate` | 1440 | New (the API returns the existing course rather than 409, so there is no conflict response to render) |
| Events stream ends → polling fallback; leave, return and refresh resume | `test_courses.py::test_generation_polls_after_the_stream_ends_and_survives_leave_and_refresh` | 1440 | New |
| Planning failure with reason and retry | `test_courses.py::test_failed_plan_shows_reason_and_retries` | 1440 | New |
| Modules, lesson locks (not links, `aria-disabled`, hint), estimates | `test_courses.py::test_plan_locks_estimates_and_start_then_continue`, `existing:check_web_master` | 1440, 390, light/dark | New + Covered |
| First lesson: Start → Continue after opening, before completion | `test_courses.py::test_plan_locks_estimates_and_start_then_continue` | 1440 | New |
| Next-lesson navigation | `existing:check_web_master`, `test_quiz.py::test_pass_unlocks_exactly_the_next_lesson_in_the_plan_without_reload` | 1440 | Covered + New |
| Course deletion: cancel, failure, retry; source kept | `test_courses.py::test_course_deletion_cancel_failure_retry_and_source_kept` | 1440 | New |

## Lessons and tutor (#23, #25, #29)

| Behavior | Tests | Viewports / themes | Status |
|---|---|---|---|
| Generated blocks, citations and rendered Mermaid diagram | `existing:check_web_master`, `test_accessibility.py::test_axe_has_no_violations[lesson-*]` | 1440, 390, light/dark | Covered |
| Generation loading state; quiz disabled meanwhile | `existing:check_web_master` | 1440 | Covered |
| Generation failure with reason and retry; regeneration confirm/cancel; daily limit | `test_lessons.py::test_failed_generation_retries_and_regeneration_respects_the_limit` | 1440 | New |
| Limited-source note | `test_lessons.py::test_limited_source_note_is_shown` | 1440 | New |
| Your turn: empty disabled, partial, correct, reveal; request bodies; live region | `test_lessons.py::test_your_turn_empty_partial_correct_and_reveal` | 1440 | New |
| Tutor: guidance first, direct answer on request, lesson-scoped request contract | `test_lessons.py::test_tutor_guides_first_answers_on_request_and_keeps_history`, `existing:check_web_master` | 1440 | New + Covered |
| Tutor history reloads with the lesson | `test_lessons.py::test_tutor_guides_first_answers_on_request_and_keeps_history` | 1440 | New |
| No web activity or web citations in Master | `test_lessons.py::test_tutor_guides_first_answers_on_request_and_keeps_history`, `existing:check_web_master` | 1440 | New + Covered |
| Server-only answers absent from responses before reveal | `test_lessons.py::test_lesson_responses_never_carry_server_only_answers`, `test_lessons.py::test_tutor_guides_first_answers_on_request_and_keeps_history` | 1440 | New |
| Lesson text and tutor answers absent from browser storage | `test_lessons.py::test_tutor_guides_first_answers_on_request_and_keeps_history` | 1440 | New |

## Quiz and unlocking (#24, #30)

| Behavior | Tests | Viewports / themes | Status |
|---|---|---|---|
| Exactly 3 questions × 4 options; submit disabled until complete | `test_quiz.py::test_structure_keyboard_and_submit_gate` | 1440 | New |
| Keyboard selection (arrows move, Space selects) | `test_quiz.py::test_structure_keyboard_and_submit_gate`, `existing:check_web_master` | 1440 | New + Covered |
| 0/3 fails, 3/3 passes; 1/3 and 2/3 | `test_quiz.py::test_zero_of_three_fails_and_three_of_three_passes_with_explanations`, `existing:check_web_master` | 1440 | New + Covered |
| Chosen vs correct answers, explanations, citations; focus moves to the summary | `test_quiz.py::test_zero_of_three_fails_and_three_of_three_passes_with_explanations` | 1440 | New |
| Retake presents different stems | `existing:check_web_master` | 1440 | Covered |
| Refresh resumes the same attempt | `test_quiz.py::test_refresh_resumes_and_network_failure_keeps_answers` | 1440 | New |
| Network failure keeps answers; retry submits | `test_quiz.py::test_refresh_resumes_and_network_failure_keeps_answers` | 1440 | New |
| Superseded attempt (409) offers a new attempt | `test_quiz.py::test_superseded_attempt_offers_a_new_one` | 1440 | New |
| Attempt history | `test_quiz.py::test_zero_of_three_fails_and_three_of_three_passes_with_explanations` | 1440 | New |
| Pass unlocks exactly the next lesson; plan and progress update without a full reload | `test_quiz.py::test_pass_unlocks_exactly_the_next_lesson_in_the_plan_without_reload`, `existing:check_web_master` | 1440 | New + Covered |
| Quiz journey on a phone | `test_accessibility.py::test_master_journey_on_a_phone_in_dark` | 390 dark | New |

## Progress and study time (#26, #31)

| Behavior | Tests | Viewports / themes | Status |
|---|---|---|---|
| Overview totals, course cards, mastery labels, recent activity, time formatting | `test_progress.py::test_overview_values_mastery_and_formatting`, `existing:check_web_master` | 1440 | New + Covered |
| Course progress tab: lessons table, quiz metrics, question-type breakdown, level definitions | `test_progress.py::test_course_progress_tab_quiz_metrics_and_levels` | 1440 | New |
| Loading, empty, error, retry and refresh | `test_progress.py::test_overview_loading_empty_error_and_refresh` | 1440 | New |
| Heartbeat only while visible and focused; ≤ 60 s per beat; stops on leaving | `test_progress.py::test_heartbeat_only_while_visible_and_focused` | 1440 | New |
| No countdown or time locking | `test_progress.py::test_overview_values_mastery_and_formatting`, `test_progress.py::test_course_progress_tab_quiz_metrics_and_levels` | 1440 | New |
| Views at 1440/390 in light and dark | `existing:check_web_master`, `test_accessibility.py::test_axe_has_no_violations[progress-*]` | 1440, 390, light/dark | Covered |

## Deletion and persistence (#16, #17)

| Behavior | Tests | Viewports / themes | Status |
|---|---|---|---|
| Chat and source confirmation, cancellation, failure, retry | `existing:check_web_deletions` | 1440, 390 | Covered |
| Course confirmation, cancellation, failure, retry | `test_courses.py::test_course_deletion_cancel_failure_retry_and_source_kept` | 1440 | New |
| Pending vector cleanup and retry | `existing:check_web_deletions` | 1440 | Covered |
| Active chat cancellation and redirect; unavailable historical citations | `existing:check_web_deletions` | 1440 | Covered |
| Cross-tab reconciliation; stale caches cannot resurrect deleted items | `existing:check_web_deletions`, `existing:check_web_persistence` | 1440 | Covered |
| Malformed storage recovery; independent chats survive reload | `existing:check_web_persistence` | 1440 | Covered |

## Responsive and accessible UI

| Behavior | Tests | Viewports / themes | Status |
|---|---|---|---|
| Critical Ask and Master journeys at 1440 and 390 | `existing:check_web_master`, `existing:check_web_research`, `test_accessibility.py::test_master_journey_on_a_phone_in_dark`, `test_accessibility.py::test_ask_journey_on_a_phone` | 1440, 390 | Covered + New |
| Automated accessibility (axe-core, WCAG 2.0/2.1 A and AA) on chooser, courses, plan, course progress, lesson, quiz, progress, Ask and docs | `test_accessibility.py::test_axe_has_no_violations[*-light|dark]` (18 cases) | 1440, light/dark | New |
| Dialog focus moves in, stays in, returns to the opener | `test_accessibility.py::test_dialogs_trap_and_restore_focus`, `test_lessons.py::test_failed_generation_retries_and_regeneration_respects_the_limit` | 1440 | New |
| Accessible names and live feedback | `test_lessons.py::test_your_turn_empty_partial_correct_and_reveal` (live region), `test_quiz.py::test_zero_of_three_fails_and_three_of_three_passes_with_explanations` (summary focus), `existing:check_web_streaming` | 1440 | New + Covered |
| Reduced motion | `test_accessibility.py::test_reduced_motion_stops_spinners`, `existing:check_web_frontend`, `existing:check_web_landing` | reduced motion | New + Covered |
| No page-level horizontal overflow | `test_accessibility.py::test_axe_has_no_violations` (each view), phone journeys, `existing:check_web_master`, `existing:check_web_docs` | 1440, 390 | New + Covered |

Accessibility exceptions reviewed: none. axe found three real defects while the suite
was being built, and they were fixed instead of excluded: light-theme muted text
measured 4.27:1 on the sidebar (now ≥ 4.5:1 on every light surface), the chat
disclaimer was faded to 2.8:1, and the Ask page had no level-1 heading. A fourth,
found by the focus test: controlled dialogs dropped focus to the page on close.

## Suite safety nets

| Guard | Test |
|---|---|
| Unexpected `/api/rag` requests and other hosts fail the test | `test_suite_guards.py::test_unexpected_api_and_external_requests_are_caught` |
| Console and page errors fail unless the provoking test allows them | `test_suite_guards.py::test_console_errors_fail_unless_allowed_by_the_test` |
| Delayed (held) and retried responses behave deterministically | `test_suite_guards.py::test_held_responses_and_retry_sequences` |

## Outside this matrix

- **N/A, browser engines:** Chromium only. The app targets evergreen browsers; Firefox and WebKit are not part of the release gate.
- **N/A, real data:** real persistence, provider calls and model output quality are verified by backend tests, `check_web_live` (opt-in, uses credits) and #11.
- **Outstanding:** none at the time of writing.
