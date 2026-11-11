# AI Research Tool mode (temporary public site)

From 2026-11-10 itemassist.com presents Item Assist as a product identification, replacement research and market pricing tool:
the homepage is the conversational research workspace plus one contact form. The commercial marketing site ("Startup - Commercial")
is **archived in git and restorable**; nothing below depends on local files.

## What is where

| Item | Reference |
| --- | --- |
| Startup - Commercial V7 (approved marketing site: homepage, sample report, PDF, services/about, inquiry form) | branch `archive/startup-commercial-v7-2026-11-10`, annotated tag `startup-commercial-v7-2026-11-10`, commit `9e7f4938df8991ab1c2021b30287643ff92b055f` |
| Startup - Commercial V3 (the Production site before this change; includes PR #21) | annotated tag `startup-commercial-v3-production-2489d34`, commit `2489d3476c76bba227086ab1bb940a8cfea8d7dc` |
| Production rollback deployment (V3, the last commercial Production build) | Vercel project `joeybs-projects-251953f7/itemassist`, `dpl_DAzeB8WHvu5nC2Wk1CbtUzVRidDH` (`itemassist-136c3es0k-joeybs-projects-251953f7.vercel.app`) |
| AI-only branch | `feat/ai-research-only-site` |
| AI-only Production commit and deployment | the merge commit tagged `ai-research-only-production-2026-11-10`; the tag message records the Production deployment ID |

Never delete or move the two `startup-commercial-*` tags or the archive branch. Never force-push `main`.

## What changed in AI-only mode

- `index.html` is the research workspace (the former `/replacement-finder` page) with the heading "Product Identification & Market Pricing
  Research", a header "Contact" link, one contact form and a minimal footer. The research tool itself (`replacement-finder.js`,
  `assets/js/rf-*.js`, `api/itemassist-research.js` and its limits, cache and engine proxy) is unchanged.
- Contact form: `consultation.js` and `api/consultation-request.js` (Turnstile, validation, rate limit, double-submit guard, UTM attribution,
  Resend notification) gained three additive request types: `human_research`, `paid_access`, `general_question`. Only name, email and the
  request type are required. The earlier types (`consultation`, `research_request`, `exploring`) still work unchanged, so the archived
  commercial form keeps working against the same API. Each type has its own notification subject, id prefix (`HR-`, `PA-`, `GQ-`), banner and
  `lead_type` tag.
- Removed from the deployed site: `about`, `services`, `report`, `request-age-verification`, the LKQ and AV-receiver articles, `script.js`,
  the old social image, the report preview and the screenshots. Their URLs, with and without `.html`, and `/replacement-finder` redirect
  (307, temporary) to `/`. `/privacy` and the 404 page remain, with neutral navigation; the privacy policy was updated to describe the
  research workspace and the new contact form.
- `sitemap.xml` lists `/` and `/privacy` only. `robots.txt` still allows everything on purpose: retired URLs must stay crawlable so search
  engines can see the redirects.
- `api/**` other than the consultation additions is untouched. `api/age-verification-request.js` and `api/contact.js` are still deployed
  but no page links to them.
- No billing, checkout or subscription exists. The contact form says paid access is not available online.

## Restore the commercial site

### A. Fastest: roll Production back to the last commercial deployment (no git change, about a minute)

1. Vercel dashboard > project `itemassist` > Deployments > `dpl_DAzeB8WHvu5nC2Wk1CbtUzVRidDH` > Promote to Production, or run
   `vercel rollback https://itemassist-136c3es0k-joeybs-projects-251953f7.vercel.app --scope joeybs-projects-251953f7`.
2. This restores V3 (not V7) with the API code it shipped with. Check `https://itemassist.com/`, `/report` and the inquiry form.
3. Note that a later push to `main` creates a new Production deployment and supersedes the rollback. Fix `main` next (B).

### B. Restore V7 (the approved commercial site) through `main`

Everything is derived from the archive tag; no local file is needed.

```sh
git fetch origin --tags
git switch -c restore/startup-commercial origin/main
git revert -m 1 <AI-only merge commit>              # the commit tagged ai-research-only-production-2026-11-10; back to V3
git merge --no-ff startup-commercial-v7-2026-11-10  # forward to V7 (it was built on V3, so this is conflict-free)
git diff --stat startup-commercial-v7-2026-11-10 HEAD   # must print nothing, or only changes made on main since
```

Open a PR from `restore/startup-commercial`, check its Preview (homepage, `/report`, the PDF, the inquiry form), then merge. If other
commits landed on `main` after the AI-only merge, `git revert` may report conflicts in files they touched: resolve toward the archive tag.
To restore V3 only, skip the `git merge` line.

### C. Re-enable commercial pages while keeping the AI workspace

Take what is needed from the tag instead of reverting:

```sh
git checkout startup-commercial-v7-2026-11-10 -- about.html services.html report.html request-age-verification.html request-age-verification.js \
  what-does-lkq-mean-contents-claims.html discontinued-av-receiver-replacement-research.html script.js assets screenshot1.jpg screenshot2.jpg screenshot3.jpg
```

Then, by hand:

1. `vercel.json`: delete the `redirects` entries for the routes being re-enabled.
2. `sitemap.xml`: re-add the pages (see the tag's copy).
3. Navigation: add links to the restored pages in `index.html` (header and footer) and `privacy.html`, `404.html`; the tag's `index.html` and
   `privacy.html` show the original navigation and footer.
4. Move the workspace back to `/replacement-finder` if the commercial homepage returns to `/`: copy `index.html` to `replacement-finder.html`,
   restore the `noindex` meta and the `/replacement-finder` entry in `vercel.json` `headers`, and drop its redirect.
5. `assets/og-image.png` is the old social preview; point the metadata of the pages you restore at it.
6. `privacy.html`: the commercial wording (assignment files, consultation form) is in the tag's copy; reconcile it with whatever the site then collects.
7. Run `npm test` and the Playwright suites. The commercial specs (`homepage-content`, `site-consistency`, `request-age-verification`, `responsive`)
   are in the tag.

## Operating the research tool

Unchanged by this mode. Production variables (names only): `ITEMASSIST_RESEARCH_ENABLED`, `ITEMASSIST_RESEARCH_LIVE_CONTRACT`,
`ITEMASSIST_RESEARCH_HASH_SALT`, `ITEMASSIST_REPLACEMENT_ENGINE_URL`, `ITEMASSIST_REPLACEMENT_API_TOKEN`, `REPLACEMENT_FINDER_ENABLED`.
Per-visitor and per-IP daily limits default to 5 and 20 (`ITEMASSIST_RESEARCH_VISITOR_DAILY_LIMIT`, `ITEMASSIST_RESEARCH_IP_DAILY_LIMIT`).
`GET /api/itemassist-research` reports `{ enabled, dailyLimit }` without calling any provider. To pause AI research quickly, set
`ITEMASSIST_RESEARCH_ENABLED` to anything other than `true` and redeploy; the workspace then falls back to the classic lookup.
