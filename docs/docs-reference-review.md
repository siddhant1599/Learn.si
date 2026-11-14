# Docs reference review and implementation decisions (#15)

Reviewed 2026-11-13. Scope: the English documentation navigation at
https://deerflow.tech/en/docs, including its Introduction, Harness, App,
Tutorials, Reference and Posts entries. Retrieved 36 unique HTML pages.
Translated copies and external provider/reference links were excluded; this is
not an audit of every page in the upstream repository or every external link.
Four entries below expose only a title or brief placeholder. No request failed.
Text extraction does not prove all client-only interactions work; UI behavior
in our implementation is verified separately with headless browser checks.

## Findings and adaptation

The overview directs readers by intent. Conceptual explanations precede detailed
configuration, while tutorials use prerequisites, steps and next links. Harness
material covers reusable runtime capabilities; App material covers operations
and user workflows. Configuration and troubleshooting use tables and runnable
examples. The long provider-safety post explains an implementation boundary;
the weekly/release pages were sparse. Some reference pages are title-only.

Rendered navigation exposes grouped sidebar entries, a current section, heading
anchors and an on-page contents list, search, language/theme controls, and links
to source. These are observations of rendered HTML, not proof of all interaction
behavior. Avoid copying upstream product claims (sandbox, tools, multi-user auth,
learned memory): Document Lab does not implement those capabilities.

### Source-verified implementation

Public source inspected under `bytedance/deer-flow/main/frontend`:
- [package.json](https://github.com/bytedance/deer-flow/blob/main/frontend/package.json): Next.js, Nextra and nextra-theme-docs; build runs a search-index script.
- [next.config.js](https://github.com/bytedance/deer-flow/blob/main/frontend/next.config.js): wraps Next configuration in Nextra.
- [docs layout](https://github.com/bytedance/deer-flow/blob/main/frontend/src/app/%5Blang%5D/docs/layout.tsx): Nextra Layout, localized page map, Search in shared header, language filters.
- [catch-all page](https://github.com/bytedance/deer-flow/blob/main/frontend/src/app/%5Blang%5D/docs/%5B%5B...mdxPath%5D%5D/page.tsx): imports MDX content and metadata/TOC through Nextra, generates static parameters.
- [search build](https://github.com/bytedance/deer-flow/blob/main/frontend/scripts/build-search-index.mjs): Pagefind indexes generated HTML, rewrites language metadata and rebuilds public/_pagefind.
- The overview Edit link points to frontend/src/content/en/index.mdx.

These facts establish the public source approach, not the exact deployed build
revision. The website's extraction and public main branch can differ. No upstream
code or prose is copied into the feature; original content and existing project
components are used, so no new third-party code licensing obligation is added.

### Document Lab approach

Use typed repository content in web/src/content/docs.ts (title, stable slug,
section IDs, paragraphs, code examples and links). A shared static Next.js
optional catch-all renders all pages with metadata and notFound for unknown
slugs. The small collection does not justify adding Nextra/MDX/Pagefind dependencies.
Tradeoff: structured content is less flexible for prose authors than Markdown;
it keeps headings, navigation and search destinations deterministic and testable.
If the docs grow substantially, revisit MDX plus a build-time search index.

Groups: Start here (overview, workspace); Using Document Lab (evidence/privacy,
deletion); Developers (local setup, architecture, API/SSE, evaluation, operations).
Client search indexes only these authored sections, with literal term matching,
keyboard focusable results and section links. It never scans uploads, environment
files, private evaluation material or chat storage. Use the existing theme and
Radix dialog, native mobile disclosure, accessible TOC and bounded code scrolling.
English only, no release feed or copy-page control for this initial collection.

## Page inventory

| URL | Review result |
| --- | --- |
| https://deerflow.tech/en/docs | Read rendered main content |
| https://deerflow.tech/en/docs/application | Read rendered main content |
| https://deerflow.tech/en/docs/application/agents-and-threads | Read rendered main content |
| https://deerflow.tech/en/docs/application/configuration | Read rendered main content |
| https://deerflow.tech/en/docs/application/deployment-guide | Read rendered main content |
| https://deerflow.tech/en/docs/application/operations-and-troubleshooting | Read rendered main content |
| https://deerflow.tech/en/docs/application/quick-start | Read rendered main content |
| https://deerflow.tech/en/docs/application/workspace-usage | Read rendered main content |
| https://deerflow.tech/en/docs/harness | Read rendered main content |
| https://deerflow.tech/en/docs/harness/configuration | Read rendered main content |
| https://deerflow.tech/en/docs/harness/customization | Read rendered main content |
| https://deerflow.tech/en/docs/harness/design-principles | Read rendered main content |
| https://deerflow.tech/en/docs/harness/integration-guide | Read rendered main content |
| https://deerflow.tech/en/docs/harness/lead-agent | Read rendered main content |
| https://deerflow.tech/en/docs/harness/mcp | Read rendered main content |
| https://deerflow.tech/en/docs/harness/memory | Read rendered main content |
| https://deerflow.tech/en/docs/harness/middlewares | Read rendered main content |
| https://deerflow.tech/en/docs/harness/quick-start | Read rendered main content |
| https://deerflow.tech/en/docs/harness/sandbox | Read rendered main content |
| https://deerflow.tech/en/docs/harness/skills | Read rendered main content |
| https://deerflow.tech/en/docs/harness/subagents | Read rendered main content |
| https://deerflow.tech/en/docs/harness/tools | Read rendered main content |
| https://deerflow.tech/en/docs/introduction | Read rendered main content |
| https://deerflow.tech/en/docs/introduction/core-concepts | Read rendered main content |
| https://deerflow.tech/en/docs/introduction/harness-vs-app | Read rendered main content |
| https://deerflow.tech/en/docs/introduction/why-deerflow | Read rendered main content |
| https://deerflow.tech/en/docs/posts/provider-safety-termination-in-tool-agents | Read rendered main content |
| https://deerflow.tech/en/docs/posts/releases/2_0_rc | Title/brief placeholder only; no substantive guide available |
| https://deerflow.tech/en/docs/posts/weekly/2026-04-06 | Title/brief placeholder only; no substantive guide available |
| https://deerflow.tech/en/docs/reference/model-providers | Title/brief placeholder only; no substantive guide available |
| https://deerflow.tech/en/docs/reference/model-providers/ark | Title/brief placeholder only; no substantive guide available |
| https://deerflow.tech/en/docs/tutorials/create-your-first-harness | Read rendered main content |
| https://deerflow.tech/en/docs/tutorials/deploy-your-own-deerflow | Read rendered main content |
| https://deerflow.tech/en/docs/tutorials/first-conversation | Read rendered main content |
| https://deerflow.tech/en/docs/tutorials/use-tools-and-skills | Read rendered main content |
| https://deerflow.tech/en/docs/tutorials/work-with-memory | Read rendered main content |

## Project accuracy and maintenance

Verified against app/models.py, app/config.py, app/api.py, app/uploads.py,
app/workflow.py, app/progress.py, app/deletions.py, frontend proxy/privacy code,
README.md, PINECONE.md and docs/evaluation/README.md. #11 remains open; do not
represent development smoke runs as a reviewed release-quality baseline.

When editing docs, add stable section IDs and update content tests. Run the docs
unit tests, typecheck, build and scripts/check_web_docs.py on the restarted app.
The tests validate published links/anchors and search destinations. Examples are
synthetic and configuration values are placeholders. No private data is needed.
