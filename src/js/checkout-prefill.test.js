// checkout-prefill.test.js — whose contact is in the checkout form?
//
// WHY THIS IS A TEST. `src/js/shop/checkout.js` keeps buyerName/buyerEmail/
// buyerPhone at MODULE SCOPE, and the account switcher does NOT reload the page
// (account-switch.js has no location.reload). The original prefill was
//
//     if (!state.buyerEmail) state.buyerEmail = user.email || '';
//
// which never overwrites — so signing into a second account and opening
// checkout left the FIRST person's email in the form. That is the documented
// "module-scope caches make an in-place account switch show two accounts at
// once" class (docs/mistakes/app-state.md), and on this screen it ends with a
// stranger's address stored as the only channel staff have for the order.
//
// It became worth a ratchet when the checkout grew a contact recap above the
// confirm button: the stale value stopped being a quiet default and became the
// thing the buyer is explicitly asked to approve.
//
// The two rules pull in opposite directions, which is why "just always
// overwrite" is wrong: typed edits must survive the re-render that every slip
// upload triggers.
import { describe, it, expect } from 'vitest';
import { applyBuyerPrefill } from './shop/checkout.js';

const blank = () => ({
  buyerName: '', buyerEmail: '', buyerPhone: '', prefillUid: null,
});
const somchai = {
  id: 'uid-somchai', name: 'สมชาย ใจดี', email: 'somchai@kkumail.com', phone: '081-111-1111',
};
const malee = {
  id: 'uid-malee', name: 'มาลี รักเรียน', email: 'malee@gmail.com', phone: '082-222-2222',
};

describe('checkout buyer prefill', () => {
  it('fills an empty form from the signed-in profile', () => {
    const s = applyBuyerPrefill(blank(), somchai);
    expect(s.buyerEmail).toBe('somchai@kkumail.com');
    expect(s.buyerPhone).toBe('081-111-1111');
    expect(s.prefillUid).toBe('uid-somchai');
  });

  it('does NOT clobber what the buyer typed, on a re-render', () => {
    const s = applyBuyerPrefill(blank(), somchai);
    s.buyerEmail = 'somchai.personal@gmail.com';
    applyBuyerPrefill(s, somchai);
    expect(s.buyerEmail).toBe('somchai.personal@gmail.com');
  });

  it('REPLACES every field when the account changes — the bug', () => {
    const s = applyBuyerPrefill(blank(), somchai);
    applyBuyerPrefill(s, malee);
    expect(s.buyerEmail, "malee must not inherit somchai's email").toBe('malee@gmail.com');
    expect(s.buyerName).toBe('มาลี รักเรียน');
    expect(s.buyerPhone).toBe('082-222-2222');
    expect(s.prefillUid).toBe('uid-malee');
  });

  it('replaces a TYPED value too when the account changes', () => {
    // The dangerous case: somchai typed an address, then switched to malee.
    // Keeping a typed value would be indistinguishable from keeping a prefilled
    // one to the person now looking at the form.
    const s = applyBuyerPrefill(blank(), somchai);
    s.buyerEmail = 'typed-by-somchai@example.com';
    applyBuyerPrefill(s, malee);
    expect(s.buyerEmail).toBe('malee@gmail.com');
  });

  it('re-prefills after a placed order blanked the fields', () => {
    // placeOrder() clears these so the next order starts fresh; the same
    // account must get its details back rather than an empty form.
    const s = applyBuyerPrefill(blank(), somchai);
    s.buyerName = ''; s.buyerEmail = ''; s.buyerPhone = '';
    applyBuyerPrefill(s, somchai);
    expect(s.buyerEmail).toBe('somchai@kkumail.com');
  });

  it('leaves the form alone when there is no user', () => {
    const s = blank();
    s.buyerEmail = 'typed@example.com';
    applyBuyerPrefill(s, null);
    expect(s.buyerEmail).toBe('typed@example.com');
  });

  it('handles an account with NO email — the anonymous route', () => {
    // auth.js stores '' for a username/password account's synthetic email, and
    // the checkout notice + the recap both depend on that staying empty rather
    // than inheriting whoever was signed in before.
    const s = applyBuyerPrefill(blank(), somchai);
    applyBuyerPrefill(s, { id: 'uid-anon', name: 'anon', email: '', phone: '' });
    expect(s.buyerEmail).toBe('');
    expect(s.buyerPhone).toBe('');
  });
});
