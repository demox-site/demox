# Demox SEO/GEO Analysis

Audit date: 2026-08-11 (Asia/Singapore)

Target: <https://www.demox.site/>

This report follows the installed `seo-geo` skill. Scores are transparent heuristics, not Google ranking data. Google Search Console and AI-platform citation telemetry were not available for this audit.

## 1. GEO readiness score

| State | Citability | Structure | Multi-modal | Authority | Technical | Total |
|---|---:|---:|---:|---:|---:|---:|
| Production baseline | 3/25 | 1/20 | 5/15 | 5/20 | 4/20 | **18/100** |
| Local candidate | 20/25 | 16/20 | 8/15 | 10/20 | 18/20 | **72/100** |

The baseline is low because the production HTML contains an empty React root and only the title `Demox`; non-JavaScript crawlers cannot read the product explanation. In addition, `/index` and `/doc` return HTTP 404, while `robots.txt` and `sitemap.xml` still identify `ai-builder.aigc.sx.cn` as the canonical site.

The local candidate fixes the crawlability and entity-description layer. The remaining score gap is mainly first-party evidence, dated authorship, independent brand mentions, and production verification.

## 2. Platform breakdown

| Platform | Baseline | Local candidate | Main remaining dependency |
|---|---:|---:|---|
| Google Search / AI Overviews | 20/100 | 76/100 | Deploy, validate indexing, and inspect Search Console |
| ChatGPT Search | 15/100 | 70/100 | Deploy, then measure whether Demox is cited for target queries |
| Perplexity | 15/100 | 70/100 | Deploy, then verify crawling and citations |
| Bing / Copilot | 18/100 | 72/100 | Submit and validate the corrected sitemap in Bing Webmaster Tools |

## 3. AI crawler access

Production currently permits all crawlers through `User-agent: *`, so GPTBot, OAI-SearchBot, ClaudeBot, and PerplexityBot are not blocked. The local `robots.txt` makes those search crawlers explicit while excluding authentication and console routes. Explicit rules improve auditability; they do not create a ranking boost by themselves.

## 4. `llms.txt` status

Production returns HTTP 404 for `/llms.txt`. The local candidate adds a concise file linking the homepage, CLI/MCP documentation, changelog, repositories, package names, and supported inputs.

This is optional developer-documentation support, not a Google ranking tactic. Google's AI optimization guidance says Google Search ignores `llms.txt`, including for generative AI features.

## 5. Brand mention analysis

- Confirmed first-party presence: the `demox-site/demox` and `demox-site/skill` GitHub repositories.
- The product UI says the Demox X account is not yet available.
- Wikipedia, Reddit, YouTube, LinkedIn, third-party reviews, and independent citations were not verified in this audit.
- No independent authority score is claimed. A future audit should measure real mentions and referral/citation traffic rather than manufacture mentions for GEO.

## 6. Passage-level citability

The local static homepage shell adds a self-contained product definition near the start of the raw HTML. It states what Demox is, supported inputs, deployment surfaces, operational benefits, intended use cases, public/private behavior, and the boundary that Demox does not replace a full CI/CD platform.

The local docs shell adds an answer-first distinction between CLI and MCP, followed by exact package names and minimal commands. These passages are available without JavaScript and match the visible application content.

## 7. Server-side rendering check

Demox is a client-rendered Vite/React application and does not use SSR. The local change does not introduce an SSR framework; it generates route-specific static HTML shells after the Vite build. This is the smallest reversible change that makes the key public routes readable to non-JavaScript crawlers while preserving the existing application runtime.

## 8. Top five highest-impact changes

1. Generate HTTP-200 static route shells for `/doc`, `/pricing`, `/log`, `/terms`, `/privacy`, and the legacy `/index` alias.
2. Put a factual, crawlable product definition in the initial HTML instead of an empty React root.
3. Replace the obsolete host in `robots.txt` and `sitemap.xml` with `https://www.demox.site` and remove hash URLs.
4. Add canonical URLs, index/noindex controls, Open Graph URLs, correct Twitter-card attributes, and route-specific metadata.
5. Add Organization, WebSite, SoftwareApplication, and WebPage JSON-LD that reflects confirmed product facts.

## 9. Schema recommendations

Implemented locally:

- `Organization` for the Demox entity and GitHub identity.
- `WebSite` for the canonical domain and supported languages.
- `SoftwareApplication` for the developer deployment product.
- `WebPage` for each generated public route.

Not added:

- Review, rating, user-count, uptime, or customer schema because no current evidence was provided.
- FAQ rich-result markup because it is not a general commercial-site ranking lever and the visible FAQ content remains client-rendered.
- Offer markup because pricing can drift and should only be emitted from a maintained pricing source of truth.

## 10. Content recommendations

- Add dated, first-party case studies with measurable deployment outcomes and methodology.
- Add a maintained comparison page that states when Demox is and is not a fit; avoid unsupported competitor claims.
- Give changelog entries stable URLs and publication/update dates.
- Publish troubleshooting pages for common deployment failures, using exact error messages and verified remedies.
- Measure target-query impressions, indexed pages, and AI referrals after deployment before making further content changes.

## Verification evidence and limits

- Baseline HTTP checks: `/` 200; `/pricing` 200; `/index` 404; `/doc` 404; `/llms.txt` 404.
- Baseline source: raw homepage HTML has no description, canonical, structured data, or crawlable body content.
- `npm run test:seo` passes both route-generation and sitemap-contract tests.
- A focused snapshot built from `origin/master` passes `npm ci` and `npm run build` without adding the unrelated `@demox-site/sdk` consumer dependency.
- Browser smoke passes for `/` and `/doc`: React replaces the static fallback, each route retains exactly one description/canonical/robots tag, `/doc` renders its real H1, and no browser console errors were observed. `/mcp-authorize` retains `noindex, nofollow` after React starts.
- Deployment, production crawl, Search Console indexing, Bing indexing, and actual AI citations remain out of scope until the code is committed and pushed through the repository's GitHub Actions release path.

## Primary guidance

- Google AI optimization guide: <https://developers.google.com/search/docs/fundamentals/ai-optimization-guide>
- Google helpful content guidance: <https://developers.google.com/search/docs/fundamentals/creating-helpful-content>
- Schema.org: <https://schema.org/>
