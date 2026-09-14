# Demox SEO/GEO Analysis

Audit date: 2026-09-14 (Asia/Singapore)

Target: <https://www.demox.site/>

This report follows the installed `seo-geo` skill. Scores are transparent heuristics, not Google ranking data. Google Search Console and AI-platform citation telemetry were not re-checked in this pass.

## 1. GEO readiness score

| State | Citability | Structure | Multi-modal | Authority | Technical | Total |
|---|---:|---:|---:|---:|---:|---:|
| Production baseline (2026-08-11) | 3/25 | 1/20 | 5/15 | 5/20 | 4/20 | **18/100** |
| Local candidate after crawlable shells (2026-08-24) | 20/25 | 16/20 | 8/15 | 10/20 | 18/20 | **72/100** |
| Local candidate after content refresh (2026-09-14) | 23/25 | 18/20 | 8/15 | 13/20 | 18/20 | **80/100** |
| Local candidate after intent landings (2026-09-14) | 24/25 | 19/20 | 8/15 | 13/20 | 18/20 | **82/100** |

The remaining score gap is still first-party metrics, independent brand mentions, Search Console/AI citation proof, and multi-modal assets. This pass does not invent usage numbers or third-party mentions.

A later 2026-09-14 check (without using the brand name) found npm, Glama, and a TRAE community post, but not Demox on generic queries such as “免费 静态网站 发布 CLI MCP” or “free static website hosting MCP CLI AI deploy”. `site:demox.site` was empty in that check. Brand search works; unbranded intent search does not. This pass adds dedicated intent URLs and search-shaped homepage copy. It does not prove indexing. npm README changes are local until those packages are published. New www routes are in the edge allowlist source; the live edge function still has to pick that list up or those paths can 404.

## 2. Platform breakdown

| Platform | Previous local | 2026-09-14 local | Main remaining dependency |
|---|---:|---:|---|
| Google Search / AI Overviews | 76/100 | 82/100 | Deploy, then inspect Search Console stored crawl and snippets |
| Google AI Mode | 70/100 | 78/100 | Fresh dated articles plus entity consistency after deploy |
| ChatGPT Search | 70/100 | 76/100 | Measure citations for “what is Demox” and deploy-error queries |
| Perplexity | 70/100 | 76/100 | Same; Reddit/Wikipedia presence is still absent |
| Bing / Copilot | 72/100 | 78/100 | Submit the updated sitemap after deploy |

## 3. AI crawler access

Unchanged and still correct: `robots.txt` allows GPTBot, OAI-SearchBot, ClaudeBot, PerplexityBot, and `User-agent: *`, while excluding `/console/` and auth routes.

## 4. `llms.txt` status

Present locally at `/llms.txt`. It now points at the comparison, troubleshooting, and self-host pages, plus functions. Google Search ignores `llms.txt`; keep it as optional agent navigation.

## 5. Brand mention analysis

- First-party: `demox-site/demox`, `demox-site/skill`, and `https://x.com/a_phos` (linked from the pricing page). Organization JSON-LD `sameAs` now includes those three URLs.
- Wikipedia, Reddit, YouTube, LinkedIn, and independent reviews were not verified in this pass.
- No usage, uptime, or customer counts are claimed.

## 6. Passage-level citability

New self-contained answer blocks:

- Homepage: what Demox is, including Node functions and explicit non-fits.
- `/when-to-use-demox`: fit table plus a first-party self-host pointer.
- `/deploy-troubleshooting`: exact `MISSING_ENTRYPOINT`, `CONTENT_BLOCKED`, `INVALID_STATIC_SITE`, and `Access denied` text with verified remedies.
- `/how-demox-hosts-itself`: the current `demox deploy` + `demox functions push` path from AGENTS.md, with an explicit non-claim on metrics.

## 7. Server-side rendering check

Unchanged architecture: Vite/React SPA plus post-build static HTML shells. Non-JavaScript crawlers can read the new routes after `npm run build`.

## 8. Top five highest-impact changes in this pass

1. Correct the crawlable product definition so Node functions are part of Demox, not “always use another backend”.
2. Add `/when-to-use-demox` with a comparison table and non-fit boundaries.
3. Add `/deploy-troubleshooting` that quotes real error codes and messages.
4. Add `/how-demox-hosts-itself` as dated first-party evidence, without fabricated metrics.
5. Refresh sitemap, `llms.txt`, SoftwareApplication schema, internal links, and homepage/guide copy so JS and no-JS views agree.

## 9. Schema recommendations

Implemented:

- Existing Organization / WebSite / SoftwareApplication / WebPage graph, with an updated SoftwareApplication description.
- TechArticle on the guide, comparison, troubleshooting, and self-host pages, with `datePublished` / `dateModified`.
- `sameAs` for GitHub repos and the public X profile already linked from pricing.

Still not added:

- Review, rating, user-count, or Offer markup.
- FAQ rich-result markup. Visible FAQ copy remains; commercial FAQ schema is still withheld.

## 10. Content recommendations

Done locally in this pass:

- Comparison page that states when Demox is and is not a fit.
- Troubleshooting page with exact error messages.
- Dated first-party self-host case with methodology and explicit limits.

Still open:

- Changelog entries still share `/log` instead of stable per-entry URLs.
- No independent case study with measured outcomes from a customer site.
- No original survey, video, or diagram assets beyond the existing OG image.
- Production crawl, Search Console stored HTML, and actual AI citations remain unverified until this candidate is deployed.

## Verification evidence and limits

- `npm run test:seo` is the contract for route shells and sitemap membership.
- Browser verification in this pass covers the new React routes locally; it does not prove production indexing.
- Do not treat this file update as a ranking or citation result.

## Primary guidance

- Google AI optimization guide: <https://developers.google.com/search/docs/fundamentals/ai-optimization-guide>
- Google helpful content guidance: <https://developers.google.com/search/docs/fundamentals/creating-helpful-content>
- Schema.org: <https://schema.org/>
