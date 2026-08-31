# 2026-08-31 — the docs site: its address, and its shape

Why the documentation moved to `samo.md.kku.ac.th/docs` and was then rebuilt
around what a reader wants to do. Written for whoever reopens either question.
**`STATE.md` holds the status; this file holds the reasoning.**

## 1. The address — closed, do not reopen

**KKU issues one VM and one hostname.** The owner confirmed this directly:
*"they wouldn't give me docs.samo.md.kku.ac.th, they only give me this one vm
and samo.md.kku.ac.th"*. Every plan that started with a DNS record is therefore
dead, including the CNAME recommendation that sat in `STATE.md` for two days.

That constraint decides everything else, because a third-party host (GitHub
Pages, Netlify, ReadTheDocs) can only ever serve a whole HOSTNAME. DNS points
names at servers; it cannot say "this host is us except `/docs`, which is
Netlify". Whoever answers for a name owns every path under it. So with no new
names available it is binary: **use a third-party host and accept their address,
or serve it yourself and get your own.**

Measured, rather than argued from memory (2026-08-31):

| Site | Served by | Address |
|---|---|---|
| `stripe.com/docs` | — | 301 to `docs.stripe.com`, a SUBDOMAIN |
| `vitepress.dev` | Netlify | their own name, via a DNS record |
| `docs.sentry.io` | Vercel | their own name, via a DNS record |
| `nextjs.org/docs` · `tailwindcss.com/docs` · `supabase.com/docs` · `kubernetes.io/docs` | their own site | **200 at the path** |

Serving docs at a path is mainstream, not a compromise — and the sites that do
it build the docs into their own deploy, which is now exactly what this repo
does.

### The wrong turn, kept because it is instructive

The first version was a **302 redirect** from `/docs` to GitHub Pages, chosen on
the argument that docs on the VM "would need someone on the VPN to publish".
**That argument was wrong.** CI cannot reach the VM, but the VM reaches GitHub
fine and the repository is public. Treating "nothing can push in" as "nothing
can be automatic" is the whole mistake, and it nearly settled the design.

A pull-based systemd timer was then built to prove the point, verified
end-to-end (a push from a laptop appeared on the site in 486 s, untouched), and
**removed the same day** — because the owner's answer was that docs updating on
deploy is fine. It answered a requirement nobody had.

⛔ **Do not rebuild that timer.** Pull-based deploy is a real pattern (ArgoCD,
Flux are pull-based on purpose, for exactly this topology) but it is for keeping
an APPLICATION current, not a docs page that is allowed to be one deploy behind.
If freshness is ever genuinely wanted, use a **webhook** — this host is publicly
reachable — not polling.

### What that leaves, stated plainly

GitHub Pages republishes on every push; the VM copy waits for a deploy. **The
two can disagree, with `/docs` the older one.** Accepted, deliberately, and
recorded in `server/deploy.sh`, the nginx config, `docs/CONTEXT.md` and
`STATE.md` so nobody discovers it by surprise.

## 2. The shape — rebuilt around the reader

The owner's verdict on the site as first built:

> the docs site the docs is full of technical jargon that is the memory of
> claude. start here should show how to run the project … it just hard to read
> … it doesn't look like professional docs at all

with `docs.sidestore.io` given as the reference. All of it was fair, and each
complaint was measurable:

- the landing page's primary button was **"Start here — the invariants"**
- **37 of 70 sidebar pages** were session notes and archived handoffs
- groups were named after what a document IS — "Plans, proposals and history",
  "Archive — why it was done that way"
- every page title was a name plus a summary sentence, wrapping to three lines
  in the sidebar. *"Team workflow — the plan for working with several
  developers, who would read it"*
- the contribute page opened with three paragraphs of bilingual preamble, then
  pointed at a second page that pointed back at it

The reference's shape, now copied: shallow, task-named, two levels maximum, no
preamble, short sentences, callout boxes for warnings.

**`CONTRIBUTE.md` and `STEP-BY-STEP.md` were merged away.** Splitting them was a
deliberate call made earlier the same day, on "one home for one fact" grounds,
and it was wrong: two pages that each explain why the other exists is friction,
and one page serves one-home better than two cross-referencing ones.

Titles are names now, with the old summary kept as a subtitle line so nothing is
lost — `# อีเมล` over `# Email — what sends it, what the ceilings are, and what
the VM can do`.

## 3. Three traps found while doing it

**Inline `<svg>` in markdown is worse than useless.** `md-raw-tags.test.js`
flagged the first draft's diagrams. Checked rather than exempted, against
GitHub's own renderer (`gh api -X POST /markdown`): the `<svg>` shell is
stripped and every `<text>` child SURVIVES as a bare paragraph, so a diagram
becomes a scatter of stray label words mid-prose. Diagrams live in
`docs/diagrams/*.svg` and are referenced relatively, which both renderers
handle. A fixture now blocks the tempting fix of allowlisting the SVG tags.

**`ignoreDeadLinks` had turned link checking off entirely.** The pattern
`/^\/(?!samomdkkuweb)/` ignored every absolute link that did not begin with the
base — but in markdown you write site links WITHOUT the base (`/contributing`),
and VitePress prepends it at build time. So it matched every internal link on
the site. The whole restructure could have shipped with broken navigation and a
green build. Removed; verified with a control (a deliberate `/no-such-page-xyz`
is now caught).

**`npm run deploy:owed` was blind to the docs.** It watched only `src/` and the
two entry HTMLs, so on the day the VM started serving `/docs` it answered
"NO DEPLOY OWED — production is serving current code" while `/docs` was an
entire restructure behind `main`. Failing GREEN, which is the worst direction.
`docs/`, `server/nginx-samo.conf` and `server/deploy.sh` are on its list now.
**The rule: when the deploy learns to publish something new, add it to `SHIPPED`
in the same commit.**
