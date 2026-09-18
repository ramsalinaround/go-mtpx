'use strict';
// Feature: matching (contract 02 — POST /swipes returns the match for a mutual
// like; DELETE /matches/{id} unmatches and closes the thread both sides).
// Guards: overlay only on mutual like, both overlay actions, seeded matches,
// the matches strip, and unmatch via the safety sheet.

const { suite, assert, freshApp, signUp, storedState } = require('./harness');

suite('Matching', async ({ page, test }) => {

  await test('liking a mutual-like profile opens the match overlay', async () => {
    await freshApp(page);
    await signUp(page);
    await page.waitForSelector('.deck-card');
    // top card is Priya (mutual like)
    await page.click('#btn-like');
    await page.waitForSelector('#match-overlay.open');
    assert(/Priya/.test(await page.textContent('#mo-text')), 'overlay does not name the match');
  });

  await test('match is recorded with the two seeded matches', async () => {
    const s = await storedState(page);
    const ids = s.matches.map(m => m.id);
    assert(ids.includes('priya'), 'priya not in matches');
    assert(ids.includes('maya') && ids.includes('jonah'), 'seeded matches missing');
  });

  await test('keep swiping closes the overlay and returns to the deck', async () => {
    await page.click('#btn-keep-swiping');
    assert(!(await page.locator('#match-overlay.open').count()), 'overlay still open');
    assert(await page.locator('.deck-card').count() >= 1, 'deck gone');
  });

  await test('liking a non-mutual profile does not open the overlay', async () => {
    // next card is Theo (no mutual like)
    await page.click('#btn-like');
    await page.waitForTimeout(500);
    assert(!(await page.locator('#match-overlay.open').count()), 'overlay opened without mutual like');
  });

  await test('new match appears in the Matches tab strip', async () => {
    await page.click('#tab-btn-matches');
    await page.waitForSelector('#view-matches.active');
    await page.waitForSelector('.new-face');
    assert(await page.locator('.new-face:has-text("Priya")').isVisible(), 'Priya not in new-matches strip');
  });

  await test('say hello routes into the chat with that match', async () => {
    await page.click('#tab-btn-discover');
    // next mutual like in the deck is Amara
    for (let i = 0; i < 6; i++) {
      if (await page.locator('#match-overlay.open').count()) break;
      await page.click('#btn-like');
      await page.waitForTimeout(420);
    }
    await page.waitForSelector('#match-overlay.open');
    await page.click('#btn-say-hi');
    await page.waitForSelector('#screen-chat.active');
    assert(/Amara/.test(await page.textContent('#chat-name')), 'chat opened with wrong person');
  });

  await test('unmatch from chat closes the conversation', async () => {
    await page.click('#btn-chat-safety');
    await page.waitForSelector('#safety-backdrop.open');
    assert(!(await page.locator('#safety-unmatch-wrap[hidden]').count()), 'unmatch option hidden for a match');
    await page.click('#btn-unmatch-open');
    assert(/closes for both/.test(await page.textContent('#safety-unmatch-note')), 'no consequence copy');
    await page.click('#btn-unmatch-confirm');
    await page.waitForSelector('#view-matches.active');
    const s = await storedState(page);
    assert(!s.matches.some(m => m.id === 'amara'), 'match not closed');
    assert(s.seen.amara === 'like', 'unmatch should not erase the swipe');
  });
});
