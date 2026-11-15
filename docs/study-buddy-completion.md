# Study Buddy epic verification

Epic #18 brings the existing Ask workspace and the document-grounded Master learning flow together. Tickets #19–#32 implement the core behavior. Ticket #34 completes the landing presentation.

## Final integration

- Kept the interactive Ask illustration and the Master lesson, ordering exercise, quiz and progress preview in the existing scroll sequence. Both are explicitly labeled as scripted illustrations with no model calls. The landing ordering exercise is a browser-only example; generated Master lessons still use the documented Your turn review workflow.
- Added three usage steps for each mode and screenshots of the real frontend rendered with fictional Archive Handbook fixtures. Screenshot links open the full-size images. No user documents, chats or provider calls are used for these assets.
- Shared landing privacy text with the Evidence and privacy documentation so wording cannot drift. The copy distinguishes local storage from external provider requests and retention, and explains deletion and transient web findings.
- Added the final workspace CTA, repository/docs/workspace/footer license links, preserved the quote, and retained the established static hero plus constellation section. All learning CTAs lead to `/workspace`, never directly to a mode.
- Fixed the plan header to offer Continue when the first lesson is already in progress, even before any lesson is completed.

## Verification

Verified on the rebuilt local frontend on 2026-11-15:

- 278 frontend unit tests and 6 legacy tests pass; production build includes TypeScript checking.
- Backend baseline immediately before this frontend-only work: 594 passed, 7 skipped. Skipped integration tests require a dedicated test database. No backend implementation changed in this integration.
- Headless checks: docs, landing, modes, frontend, streaming, research, deletions, persistence and Master mode.
- Master flow covers course creation, generation progress, lesson rendering, Your turn, document-only tutor, failed quiz, fresh retake, pass, unlocking and progress. View checks cover 1440/390 px and light/dark themes.
- Landing checks cover image loading and intrinsic dimensions, privacy/footer sections, keyboard tabs and chooser CTA, reduced motion, and desktop/mobile layouts. Screenshots were visually inspected.

The browser regressions use controlled fixtures. These results do not establish live provider availability or teaching quality. The opt-in credit-consuming `check_web_live` was not run. The independent golden-dataset work in #11 remains open.

## Reproduce the product screenshots

With the production frontend running on port 3001:

```sh
uv run --with playwright python -m scripts.capture_landing_product
```

This overwrites only `web/public/images/product-ask.png` and `product-master.png` using isolated browser storage and intercepted fixture API responses. The rendered UI is real; the content and model responses are examples. Rebuild the frontend after changing images to publish them with the site.
