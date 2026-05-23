# Multi-project architecture (proposal — DEFERRED)

**Status**: deferred. The full refactor is multi-week and the current
code works. We're keeping this doc as future reference; in the meantime
make targeted improvements as we touch each module (readable variable
names, extract small helpers, fix obvious dup). Revisit this proposal
when there's appetite for a planned multi-week refactor or when
project N=3 actually appears.

When revisiting: red-pen everything below and answer the five "Open
questions" at the bottom before any code.

## Goal

Build one shared engine that supports many projects shaped like PR /
Vital Sound: user submits a form → ticket lands in Supabase → Discord
ping → staff manages status/remarks → user tracks updates. Expect ~10
projects over time.

## Non-goals

- We are not generalizing the *form layout*. PR's form has too much
  conditional UI to express declaratively. Each project ships its own
  form module — the engine only handles submit/track/staff lifecycle.
- We are not introducing a build-time DSL, schema validator library, or
  any framework. Vanilla ES modules + Bootstrap stay.
- We are not doing a big-bang rewrite. Strangler — engine ships
  alongside, migrate PR first, then VS, then retire the old modules.

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│                        src/core/  (the engine)                       │
│  ┌──────────────┐ ┌──────────────┐ ┌──────────────┐ ┌─────────────┐  │
│  │  submit.js   │ │  tracking.js │ │   staff.js   │ │  notify.js  │  │
│  │              │ │              │ │              │ │  (already)  │  │
│  │ ticket id +  │ │ track-by-id  │ │ status FSM   │ │ Discord     │  │
│  │ idempotent   │ │ + history    │ │ remarks/log  │ │ dispatch    │  │
│  │ insert       │ │              │ │              │ │             │  │
│  └──────┬───────┘ └──────┬───────┘ └──────┬───────┘ └──────┬──────┘  │
│         │                │                │                │         │
│         └────────────────┴────────────────┴────────────────┘         │
│                                  │                                   │
│                          ┌───────▼────────┐                          │
│                          │  registry.js   │ ← looks up project by id │
│                          └───────┬────────┘                          │
└──────────────────────────────────┼───────────────────────────────────┘
                                   │
        ┌──────────────────────────┴──────────────────────────┐
        │                                                     │
┌───────▼──────────────────┐                  ┌───────────────▼─────────────┐
│  src/projects/pr/        │                  │  src/projects/vs/           │
│    index.js   ← config   │                  │    index.js   ← config      │
│    form.js    ← submit   │                  │    form.js    ← submit      │
│    staff.js   ← kanban   │                  │    staff.js   ← dashboard   │
│    routing.js ← rules    │                  │    routing.js ← SE triage   │
│    discord.js ← embed    │                  │    discord.js ← per-dept    │
└──────────────────────────┘                  └─────────────────────────────┘
```

Engine owns the boring plumbing. Each project module owns the bespoke
parts. **Adding project N+1 is dropping a new directory under
`src/projects/` and one row in the `projects` table — no engine changes.**

## File tree (proposed)

```
src/
  core/
    registry.js        # central project registry; export getProject(id)
    submit.js          # generic ticket insert (engine.submit)
    tracking.js        # track-by-id, history-by-user
    staff.js           # status transitions, remarks, RLS-checked writes
    timeline.js        # shared timeline rendering
    fsm.js             # status FSM helper (accepts statuses[] + transitions[])
  projects/
    pr/
      index.js         # project config (id, label, statuses, hooks)
      form.js          # form module (initForm, handleSubmit)
      staff.js         # staff dashboard (uses core/staff under the hood)
      routing.js       # routeTicket(row) → returns initial target_dept
      discord.js       # formatEmbed(ticket, event)
    vs/
      ...same shape
  notify.js            # ← stays; engine calls into it
  uploads.js           # ← stays; per-project decides whether to use
  auth.js              # ← stays
  db.js                # ← stays
  main.js              # ← thinner; wires per-project window bindings
  html/                # ← per-project tab HTML stays here for now
```

The HTML partials (`tab-pr.html`, `tab-vitalsound.html`) stay where they
are — each project still owns its tab markup. Engine doesn't render UI.

## Schema (proposed)

Consolidate `pr_tickets` + `vs_tickets` into one `tickets` table:

```sql
create table tickets (
  id              text primary key,            -- "PR-XXXXXX" / "VS-..."
  project_id      text not null
                     references projects(id),

  status          text not null,               -- validated app-side per project
  target_dept     text,                        -- current "owner" group
  requested_dept  text,                        -- what the user picked
  is_emergency    boolean default false,

  submitter_id    uuid references auth.users(id),
  submitter_label text,                        -- email or @username

  data            jsonb not null default '{}', -- per-project fields
  remarks         jsonb not null default '[]', -- timeline entries
  attachments     jsonb,                       -- [{url, kind}]
  publish_date    timestamptz,                 -- nullable (PR uses it)

  silent_notify   boolean default false,

  created_at      timestamptz default now(),
  updated_at      timestamptz default now()
);

create table projects (
  id          text primary key,           -- 'pr', 'vs', ...
  label       text not null,
  active      boolean default true,
  created_at  timestamptz default now()
);
```

### Why one table + JSONB

- New project = `INSERT INTO projects` + ship a config file. No DDL.
- Common columns (status, submitter, timestamps, remarks) stay
  relational so they're easy to query + index.
- Project-specific fields (PR's `posting_channel`, VS's `problem`) live
  in `data` JSONB. Querying within a single project still works fine
  with PostgREST.
- Trade-off: lose Postgres-level column type enforcement on `data`. We
  validate in the project's `form.js submit` path before insert.
- For our scale (probably <10k tickets/year per project) JSONB indexing
  is plenty fast.

### Why not keep per-project tables

- 10 projects = 10 nearly-identical CREATE TABLE blocks + 10 sets of
  RLS policies, all drifting over time.
- Any common-column change (add `is_emergency`, rename `submitter_label`)
  becomes 10 migrations.
- Querying "all open tickets for a user across projects" becomes a 10-
  table UNION.

### Why not Postgres enums for status

- Each project has its own status set. Enums-per-project means a new
  enum type per project + a CHECK constraint per project = a migration
  per project. Validating in the app (FSM lookup in config) is simpler.
- We *do* keep `status` as `text not null` so the column itself is
  enforced; project config validates the value.

### Migration is one file

```sql
-- 0003_unify_tickets.sql
create table projects (...);
insert into projects (id, label) values ('pr', 'งาน PR'), ('vs', 'Vital Sound');
create table tickets (...);                 -- as above
insert into tickets (id, project_id, status, ...) select ... from pr_tickets;
insert into tickets (id, project_id, status, ...) select ... from vs_tickets;
-- keep pr_tickets / vs_tickets around for one release as rollback
-- net delete in 0004_drop_legacy_tickets.sql after cutover
```

## Project config interface

```js
// src/projects/_types.js (JSDoc only; no TS)

/**
 * @typedef ProjectConfig
 * @property {string} id                       Stable identifier, 'pr' / 'vs'
 * @property {string} label                    Thai-display label
 * @property {string} theme                    CSS accent class ('pink', 'teal')
 * @property {string[]} statuses               Allowed status values
 * @property {Transition[]} transitions        Allowed FSM moves
 * @property {string[]} staffRoles             Roles that can edit
 * @property {() => string} ticketIdFormat     Generate a fresh ticket id
 * @property {RoutingHook} routing             Decide initial target_dept
 * @property {DiscordHook} discord             Webhook URL + embed
 * @property {(data) => string|null} validate  App-side data validation
 */

/**
 * @typedef Transition
 * @property {string} from                     Source status (or '*' for any)
 * @property {string} to                       Target status
 * @property {string[]} roles                  Which roles can apply this
 */

/**
 * @typedef RoutingHook
 * @property {(row) => string} initialTargetDept
 *   Given the inserted row's data, return which dept "owns" it.
 *   PR returns row.data.department. VS returns 'SE' (or
 *   row.routing.requested_dept if is_emergency).
 */

/**
 * @typedef DiscordHook
 * @property {(ticket) => string} resolveWebhook
 *   Return the webhook URL for this ticket. PR always returns
 *   GAS_API_URL. VS looks up WEBHOOK_MAP[ticket.target_dept].
 * @property {(ticket, event) => object} embed
 *   Return the Discord embed payload. 'event' is 'submit' / 'consult' /
 *   'status_change'.
 */
```

## Worked example — PR as a project module

```js
// src/projects/pr/index.js
import { routing } from './routing.js';
import { discord } from './discord.js';

export default {
  id: 'pr',
  label: 'งาน PR',
  theme: 'pink',

  statuses: [
    'รอ PR รับเรื่อง',
    'กำลังทำ',
    'แก้ไขงาน',
    'ตีกลับ',
    'เสร็จสิ้น',
  ],

  transitions: [
    { from: 'รอ PR รับเรื่อง', to: 'กำลังทำ',  roles: ['pr_staff','dev'] },
    { from: 'รอ PR รับเรื่อง', to: 'ตีกลับ',    roles: ['pr_staff','dev'] },
    { from: 'กำลังทำ',         to: 'แก้ไขงาน',  roles: ['pr_staff','dev'] },
    { from: 'กำลังทำ',         to: 'เสร็จสิ้น', roles: ['pr_staff','dev'] },
    { from: 'แก้ไขงาน',         to: 'กำลังทำ',  roles: ['pr_staff','dev'] },
    // remarks-only edits use '*' → status doesn't change
  ],

  staffRoles: ['pr_staff', 'dev'],

  ticketIdFormat: () => {
    const a = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
    return 'PR-' + Array.from({length:6}, () => a[Math.floor(Math.random()*36)]).join('');
  },

  routing,
  discord,

  validate(data) {
    if (!data.department) return 'department required';
    if (!data.content_name) return 'content name required';
    return null;
  },
};
```

```js
// src/projects/pr/routing.js
export const routing = {
  initialTargetDept: (row) => row.data.department,
};
```

```js
// src/projects/pr/discord.js
import { GAS_API_URL } from '../../config.js';

export const discord = {
  resolveWebhook: () => GAS_API_URL,
  embed(ticket, event) {
    if (event === 'submit') {
      return {
        title: `📨 PR ใหม่: ${ticket.id}`,
        fields: [
          { name: 'ฝ่าย',    value: ticket.data.department },
          { name: 'ชื่องาน', value: ticket.data.content_name },
          { name: 'รูปแบบ',  value: ticket.data.job_type },
        ],
      };
    }
    // ... other events
  },
};
```

```js
// src/projects/pr/form.js
import { submit as engineSubmit } from '../../core/submit.js';
import { getProject } from '../../core/registry.js';

const pr = getProject('pr');

export async function handlePrFormSubmit(e) {
  e.preventDefault();
  // ...existing field gathering, file upload, etc. — all PR-specific
  const data = {
    department: formData.get('department'),
    content_name: formData.get('content'),
    /* ... */
  };
  const validationError = pr.validate(data);
  if (validationError) return showError(validationError);

  // Engine handles: ID generation, dbRest insert, Discord notify dispatch
  const ticket = await engineSubmit(pr, { data, attachments, silentNotify });
  showSuccess(ticket.id);
}
```

The engine's `submit.js`:

```js
// src/core/submit.js
import { dbRest } from '../db.js';
import { sendNotify } from '../notify.js';

export async function submit(project, { data, attachments, silentNotify }) {
  const id = project.ticketIdFormat();
  const target_dept = project.routing.initialTargetDept({ data });
  const row = {
    id,
    project_id: project.id,
    status: project.statuses[0],     // first status is "initial"
    target_dept,
    requested_dept: data.department || null,
    data,
    attachments: attachments || null,
    silent_notify: !!silentNotify,
  };

  await insertIdempotent(row);       // raw-fetch + retry (existing pattern)

  if (!silentNotify) {
    sendNotify(project.id, { event: 'submit', ticketId: id, ticket: row });
  }
  return row;
}
```

VS would look almost identical — config plus a slightly different
`routing.initialTargetDept` (emergency vs. SE triage) and a webhook map
in `discord.resolveWebhook`. Same engine call.

## Migration plan (strangler)

| Step | What | Risk |
|---|---|---|
| 1 | Create `src/core/` skeleton + `src/projects/_types.js`. No production code calls it yet. | None — additive |
| 2 | Ship migration `0003_unify_tickets.sql` that creates `projects` + `tickets`. Backfill from existing `pr_tickets` / `vs_tickets`. Don't drop the old tables yet. | Low — additive on prod; old code still reads old tables |
| 3 | Implement PR project config + `src/projects/pr/`. Make the PR submit/tracking/staff modules call the engine. PR writes go to **both** old and new tables (dual-write) until cutover. | Medium — dual-write code is the riskiest piece |
| 4 | Verify PR end-to-end on the preview deploy for a week. Watch for divergence. | None — observation |
| 5 | Flip PR reads to `tickets`. Stop dual-writing. Drop `pr-form.js`/`pr-tracking.js`/`pr-staff.js`. | Medium — point of no return for PR |
| 6 | Repeat 3–5 for VS. | Same |
| 7 | `0004_drop_legacy_tickets.sql` removes `pr_tickets` / `vs_tickets`. | High — irreversible. Hold for 2+ weeks after step 6. |

Estimate: ~2 weeks calendar time, mostly waiting at observation steps.

## Open questions (need your decision before code)

1. **Schema unification: one `tickets` table, yes/no?** Recommended yes
   (see "Why one table" above). The main reason to say no is if you
   want column-level RLS that varies by project. I don't think we do —
   RLS is by `project_id` + role + ownership, which works fine on one
   table.

2. **Account verification (VS-only today):** VS has its own
   username/password flow (`verifyAccount` → GAS endpoint). Do we
   (a) keep it VS-specific, or (b) generalize "pre-submit auth hook"
   into the engine? **Recommendation**: keep VS-specific. Adding a hook
   point now without a second consumer = premature abstraction.

3. **File uploads:** Only PR currently uploads to Drive via GAS. Do we
   (a) leave `uploads.js` as a per-project utility each project opts
   into, or (b) make "attach files" a generic engine feature?
   **Recommendation**: leave per-project. Engine accepts `attachments`
   in `submit()` but doesn't care how they got there.

4. **Theme/CSS:** Today PR is pink, VS is teal, per-tab scoped via the
   `.an-tab` / `.vs-tab` body class. With 10 projects we'll need a more
   systematic approach. **Recommendation**: each project declares
   `theme: <token>` in config; engine adds a `data-project="<id>"`
   attribute to the tab pane; CSS targets `[data-project="vs"]
   --pink-500 { color: teal }`. No new CSS infra.

5. **Status FSM enforcement: client-only, or also in the DB?**
   Recommendation: **client-only**, validated by the project's
   `transitions[]` config before the PATCH. DB-side, the column stays
   `text`. If we ever need server-enforced transitions, we can add a
   Postgres trigger that reads from a `project_transitions` table — but
   not yet.

## What this gets us

- Adding project N+1 → ~200 LOC: one config, one form module, one
  routing hook, one Discord embed. Engine code untouched.
- All cross-project queries (cross-project user history, "any ticket
  with status X", admin dashboards) become trivial — one table.
- Status / lifecycle bugs fix once, all projects benefit.

## What it costs

- ~2 weeks calendar time during strangler migration.
- One JSONB `data` column instead of typed columns per project.
- A small mental tax for new contributors: "where does the PR form's
  date field live? In `src/projects/pr/form.js`, validated by the
  project, persisted to `tickets.data.publish_date` via the engine."
  Worth a one-paragraph onboarding note.
