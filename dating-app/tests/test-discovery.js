'use strict';
// Feature: discovery deck (spec 01/06 — filtered candidates, distance as rounded km,
// like/pass via gesture and buttons, empty state). Guards: card content, both swipe
// inputs, verdict recording, deck exhaustion empty state.

const { suite, assert, freshApp, signUp, dragCard, topCardId, storedState } = require('./harness');

suite('Discovery deck', async ({ page, test }) => {

  await test('deck renders cards with name, age, rounded km and tags', async () => {
    await freshApp(page);
    await signUp(page);
    await page.waitForSelector('.deck-card');
    const top = page.locator('.deck-card >> nth=-1');
    assert(/\d+/.test(await top.locator('.card-name .age').textContent()), 'no age');
    assert(/km away/.test(await top.locator('.card-meta').textContent()), 'no rounded-km distance');
    assert(await top.locator('.card-tags .tag').count() >= 1, 'no interest tags');
  });

  await test('pass button advances the deck and records a pass', async () => {
    const before = await topCardId(page);
    await page.click('#btn-pass');
    await page.waitForTimeout(400);
    assert((await topCardId(page)) !== before, 'top card unchanged');
    assert((await storedState(page)).seen[before] === 'pass', 'pass not recorded');
  });

  await test('drag right likes the card', async () => {
    // current top after passing priya is theo (likesYou: false — no overlay)
    const before = await topCardId(page);
    await dragCard(page, 'like');
    assert((await topCardId(page)) !== before, 'top card unchanged after drag');
    assert((await storedState(page)).seen[before] === 'like', 'like not recorded');
  });

  await test('drag left passes the card', async () => {
    // dismiss a match overlay if the previous like opened one
    if (await page.locator('#match-overlay.open').count()) {
      await page.click('#btn-keep-swiping');
    }
    const before = await topCardId(page);
    await dragCard(page, 'pass');
    assert((await storedState(page)).seen[before] === 'pass', 'pass not recorded');
  });

  await test('a small drag snaps back without a verdict', async () => {
    const before = await topCardId(page);
    const box = await page.locator('.deck-card >> nth=-1').boundingBox();
    const cx = box.x + box.width / 2, cy = box.y + box.height / 2;
    await page.mouse.move(cx, cy);
    await page.mouse.down();
    await page.mouse.move(cx + 30, cy);
    await page.mouse.up();
    await page.waitForTimeout(300);
    assert((await topCardId(page)) === before, 'card advanced on a below-threshold drag');
  });

  await test('exhausting the deck shows the caught-up empty state', async () => {
    for (let i = 0; i < 12; i++) {
      if (!(await page.locator('.deck-card').count())) break;
      await page.click('#btn-pass');
      await page.waitForTimeout(320);
      if (await page.locator('#match-overlay.open').count()) {
        await page.click('#btn-keep-swiping');
      }
    }
    await page.waitForSelector('.deck-empty');
    assert(/caught up/i.test(await page.textContent('.deck-empty h3')), 'empty state copy missing');
    assert(await page.locator('.deck-empty button:has-text("Adjust filters")').isVisible(),
      'no filters shortcut in empty state');
  });
});
