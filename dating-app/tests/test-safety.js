'use strict';
// Feature: safety (spec 01 non-negotiables 2+3 — report and block reachable from
// every surface showing another user's content: deck card, match row, chat; report
// shows the reason picker and the 24-hour moderation commitment; block is
// immediate, both directions, and persists).

const { suite, assert, freshApp, signUp, topCardId, storedState } = require('./harness');

suite('Safety: report & block', async ({ page, test }) => {

  await test('deck card exposes a safety entry point', async () => {
    await freshApp(page);
    await signUp(page);
    await page.waitForSelector('.deck-card');
    await page.click('.deck-card >> nth=-1 >> .card-safety');
    await page.waitForSelector('#safety-backdrop.open');
    assert(/Report Priya/.test(await page.textContent('#safety-report-label')), 'report option not named');
    assert(/Block Priya/.test(await page.textContent('#safety-block-label')), 'block option not named');
  });

  await test('report shows a reason picker', async () => {
    await page.click('#btn-report-open');
    assert(await page.locator('#reason-list .safety-opt').count() === 6, 'expected 6 reasons');
    assert(/confidential/.test(await page.textContent('#safety-reasons-note')), 'no confidentiality note');
  });

  await test('report confirmation states the 24-hour moderation commitment', async () => {
    await page.click('#reason-list .safety-opt:has-text("Fake profile or spam")');
    await page.waitForSelector('#safety-report-done:not([hidden])');
    assert(/within 24 hours/.test(await page.textContent('#safety-report-done')),
      'moderation commitment missing');
    const reports = (await storedState(page)).reports;
    assert(reports.length === 1 && reports[0].id === 'priya' && reports[0].reason === 'Fake profile or spam',
      'report not recorded');
  });

  await test('report alone does not block — profile stays in the deck', async () => {
    await page.click('#btn-safety-done');
    assert(!(await page.locator('#safety-backdrop.open').count()), 'sheet still open');
    assert((await topCardId(page)) === 'priya', 'reported profile removed without a block');
  });

  await test('block from the deck removes the card immediately', async () => {
    await page.click('.deck-card >> nth=-1 >> .card-safety');
    await page.click('#btn-block-open');
    assert(/can't be undone/.test(await page.textContent('#safety-block-note')), 'no consequence copy');
    await page.click('#btn-block-confirm');
    await page.waitForTimeout(300);
    assert((await topCardId(page)) !== 'priya', 'blocked profile still on top of deck');
    assert((await storedState(page)).blocked.priya === true, 'block not recorded');
  });

  await test('blocked users are excluded when filters rebuild the deck', async () => {
    await page.click('#btn-filters');
    await page.waitForSelector('#filter-backdrop.open');
    await page.click('#btn-apply-filters');
    const toast = await page.waitForSelector('#toast.show');
    assert(/11 people/.test(await toast.textContent()), 'blocked user still counted in deck');
  });

  await test('block from a match row removes the conversation', async () => {
    await page.click('#tab-btn-matches');
    await page.waitForSelector('.match-row:has-text("Maya")');
    await page.click('.match-row:has-text("Maya") >> .row-menu');
    await page.waitForSelector('#safety-backdrop.open');
    await page.click('#btn-block-open');
    await page.click('#btn-block-confirm');
    await page.waitForTimeout(300);
    assert(!(await page.locator('.match-row:has-text("Maya")').count()), 'Maya row still listed');
  });

  await test('block from inside a chat exits and removes the match', async () => {
    await page.click('.match-row:has-text("Jonah")');
    await page.waitForSelector('#screen-chat.active');
    await page.click('#btn-chat-safety');
    await page.waitForSelector('#safety-backdrop.open');
    await page.click('#btn-block-open');
    await page.click('#btn-block-confirm');
    await page.waitForSelector('#view-matches.active');
    assert(!(await page.locator('.match-row:has-text("Jonah")').count()), 'Jonah row still listed');
    assert(await page.locator('.empty-note').isVisible(), 'expected empty matches state');
  });

  await test('blocking clears unread badges from that user', async () => {
    assert(await page.locator('#dot-matches.show').count() === 0, 'unread badge from blocked user');
  });

  await test('"also block" is offered on the report confirmation', async () => {
    await page.click('#tab-btn-discover');
    await page.waitForSelector('.deck-card');
    const target = await topCardId(page);
    await page.click('.deck-card >> nth=-1 >> .card-safety');
    await page.click('#btn-report-open');
    await page.click('#reason-list .safety-opt:has-text("Made me feel unsafe")');
    await page.click('#btn-report-block');
    await page.waitForTimeout(300);
    assert((await storedState(page)).blocked[target] === true, 'also-block did not block');
    assert((await topCardId(page)) !== target, 'card not removed after also-block');
  });

  await test('blocks persist across reload', async () => {
    await page.reload();
    await page.waitForSelector('#screen-app.active');
    const blocked = (await storedState(page)).blocked;
    assert(blocked.priya && blocked.maya && blocked.jonah, 'blocked set lost on reload');
    await page.click('#tab-btn-matches');
    await page.waitForTimeout(200);
    assert(!(await page.locator('.match-row').count()), 'blocked matches reappeared');
  });
});
