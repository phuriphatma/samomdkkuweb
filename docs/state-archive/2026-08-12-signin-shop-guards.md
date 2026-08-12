# 2026-08-12 (second half) — 0149, 0150, the sign-in rebuild, and two blind guards

Moved out of `STATE.md` to keep it inside its ~200-line budget. `git log` is the
chronology; this is the reasoning that does not fit in a commit message.

---

## 0149 — PR delete refused a ทีม SAMO member who held the grant

Reported: *"โมนา got pr permission in teamsamo but she can't delete pr ticket"*
with `{"code":"42501","message":"not authorized to delete PR tickets"}`.

`soft_delete_pr_ticket()` gated on `current_user_role() in ('pr_staff','dev')`.
0043 had introduced that check as a deliberate hand-copy of "the EXACT current
delete authorization" — but copied 0001's version, when 0014 had already taught
`pr_tickets_delete_staff` `or current_user_has_permission('pr')` **twenty-nine
migrations earlier**. The copy was stale the day it was typed and survived 106
migrations, because every tester holds the ROLE (which satisfies both spellings)
and because the VS twin in the same migration, `soft_delete_vs_ticket`, DID
consult the permission — so the pair read as permission-aware on review.

Swept the whole class afterwards, live: 14 SECURITY DEFINER functions raise
42501, and this was the only one deciding on role alone. `vs_tags` looked like a
second instance (its read policy is role-only) but is not — `vs_tags_write_scoped`
is `FOR ALL`, which covers SELECT, probed 9/9 with an ungranted control at 0.
`projects/manage.js` looked like the UI half and is not — `projectSeatRole()`
resolves the `vpa` seat to `vp_admin` before `renderManage` sees it.

Left deliberately unfixed, in `docs/NEXT.md` §0c: `users_update_staff`,
`notify_log_select_staff`, `reserved_staff_usernames_read_staff` are role-only
lists that no UI path reaches. §0d records the one-shared-predicate refactor
(`current_user_vs_scope()` is the model) worth copying next time that area opens.

## 0150 — a buyer could not correct the email on their own order

`shop_orders_self_update_guard` (0100's column guard, added after a row-level
UPDATE policy with no column guard let a buyer rewrite prices) whitelisted
`buyer_phone` but not `buyer_email`, while its own error message reads
"ผู้ซื้อแก้ไขได้เฉพาะสลิปและ**ข้อมูลติดต่อ**ของตนเองเท่านั้น". The message promised
contact data and delivered half.

The body in 0150 was copied from `pg_get_functiondef`, NOT from the migration
that first defined the trigger. The live body carried four guards a
reconstruction-from-memory dropped: a `jsonb_typeof` check, a 200-entry timeline
cap, a 200-character label cap, and its own Thai messages.

**The proof for it was wrong in an instructive way.** Its first draft resolved
"an order in a buyer-editable status, `order by id limit 1`" — and all six
orders in this database belong to shop ADMINS, for whom the guard early-returns.
Every case, ALLOW and DENY alike, measured an admin. It reported that a buyer
could set an order total to ฿1. The subject is manufactured now (a real order
cloned onto a real non-admin account inside the rollback) and "the subject is NOT
a shop admin" is an assertion in the output. Write-up in
`docs/mistakes/tooling-proofs.md`.

## The sign-in modal — six reports, one mechanism

Every report was text that is accurate to us and ambiguous to somebody who has
never seen the site.

1. The password form was hidden behind a `.collapse`.
2. "เลือกบัญชีที่ลงท้ายด้วย @kkumail.com" — an imperative, read as a rule.
3. The rewrite named บุคคลทั่วไป but **bolded the two KKU domains**, the only
   emphasis on the line. Emphasis is a claim, and it contradicted the sentence.
4. Removing the bold left the LIST. *"this'll make normal people who glance
   think @gmail.com cant sign in."* A list of domains is read as a whitelist
   whatever the sentence says. **The caption is deleted.** No caption exists on
   the standard button anywhere else on the web, and a line that does not exist
   cannot be misread.
5. "ยังไม่มีบัญชี? สร้างบัญชี…" — a question about a STATE every newcomer shares,
   so all of them took it as their instruction. Now it asks about a WANT:
   "ไม่ต้องการเปิดเผยตัวตน?".
6. "เข้าสู่ระบบด้วย Google" reads as *for people who already have an account* — a
   newcomer does not know Google needs no registration. Now
   "สร้างบัญชีและเข้าสู่ระบบด้วย Google".

Separately, the button was **non-compliant** with Google's branding guidelines
(brand-green fill, monochrome Bootstrap glyph; the guidelines permit white
`#FFFFFF`+`#747775`, dark `#131314` or neutral `#F2F2F2` only, and require the
four-colour G at its own size on white). That is most of why the screen felt
unfamiliar — every other site shows the white button.

Also this pass: the modal header carried the PR form's pink wash, because
`.modal-header` in `modals.css` paints EVERY modal `--pink-50` (the account
switcher had already opted out, with a comment saying why); the password reveal
showed an OPEN eye while hidden and the owner read it as backwards, so the icon
now shows STATE while `aria-label` keeps naming the ACTION; and the screen used
two verbs for one action (สร้างบัญชี / สมัครสมาชิก), now one.

An intermediate design — a tinted panel with a segmented control — passed every
test and was still wrong; it read as a second app bolted under the divider.
Reverted to the convention. Login screen: 659px → 465px.

⚠ The Google label is long. Measured 231px of text in a 337px button at 390px
(fine) but it WRAPPED at 320px, so a font step sits under `@media (max-width:
360px)` — and the first version of that step was placed ABOVE `.signin-google`,
where at equal specificity the base rule won and it changed nothing while
matching. Measured, not assumed.

## Two guards that were blind

**`strip-comments.js`.** Four ratchets each carried
`.replace(/\/\*[\s\S]*?\*\//g, '')`. `main.js` contains `input.accept =
'image/*'`, so the "comment" opened inside that string and ran to the next
close-marker: 13,839 characters of `main.js`, 2,321 of `admin-main.js`, ~6,000
across `my-seat.js` — ~24,000 characters no assertion could see, and
`native-dialog.test.js` (whose whole job is finding dialogs in those modules) was
one of the blinded readers. Now one shared scanner with a mode stack.
Its own first draft skipped backtick-to-backtick, ignoring that `${…}` holds real
code; a multi-line template in `house/my-house.js` put it out of phase for the
rest of the file. After un-blinding, no new real violations were found.

**`definer-authz.test.js`.** Written to catch 0149's shape, its first pattern
matched the role-list SYNTAX (`current_user_role() in (…)`) and stayed GREEN when
the bug was reintroduced, because 0045 had captured the call into `v_role` and
tested the variable. Match the CHANNEL, not one spelling.

## The checkout kept the previous account's contact

Found by review. `checkout.js` holds `buyerName/Email/Phone` at module scope and
prefilled with `if (!state.buyerEmail) …`, and `account-switch.js` never reloads
— so an in-place account switch left the previous person's contact in the form.
The contact recap shipped an hour earlier turned that from a stale default into
the value the buyer is explicitly asked to approve. `applyBuyerPrefill()` now
replaces all three when `user.id` differs from the `prefillUid` the state was
filled from, and fills only what is empty within one account.

## `npm run proofs`

The 15 live proofs emit four different output shapes (`verdict` / `result` /
`status` + an `ALL PASS` SCORE row / a single JSON blob / plain `.mjs` text).
Checking them with an ad-hoc parser produced **two false alarms in a row** —
"0/23 FAIL" on a fully green proof, then four more as N-1/N because each file's
own summary row was counted as a case. `tools/run-proofs.mjs` normalises all of
them, and reports UNKNOWN (exit 1) rather than PASS for output it cannot read.
