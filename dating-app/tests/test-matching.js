'use strict';
// Feature: matching (spec 01 — match modal on mutual like, path into chat).
// Guards: overlay opens only on mutual like, both overlay actions, match
// recorded, new match visible in the Matches tab strip.

const { suite, assert, freshApp, signUp, storedState } = require('./harness');

suite('Matching', async ({ page, test }) => {

  await test('liking a mutual-like profile opens the match overlay', async () => {
    await freshApp(page);
    await signUp(page);
    await page.waitForSelector('.deck-card');
    // top card is Priya (pre-flagged mutual like)
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
    // next card is Theo (likesYou: false)
    await page.click('#btn-like');
    await page.waitForTimeout(500);
    assert(!(await page.locator('#match-overlay.open').count()), 'overlay opened without mutual like');
  });

  await test('new match appears in the Matches tab strip', async () => {
    await page.click('#tab-btn-matches');
    await page.waitForSelector('#view-matches.active');
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
});
