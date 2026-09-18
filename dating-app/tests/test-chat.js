'use strict';
// Feature: matches list + chat (spec 01/07 — conversation list with previews and
// unread badge, 1:1 text chat). Guards: seeded conversations, unread dot
// lifecycle, sending, the auto-reply loop, preview updates.

const { suite, assert, freshApp, signUp } = require('./harness');

suite('Matches list & chat', async ({ page, test }) => {

  await test('seeded conversations appear with previews', async () => {
    await freshApp(page);
    await signUp(page);
    await page.click('#tab-btn-matches');
    await page.waitForSelector('.match-row');
    assert(await page.locator('.match-row').count() >= 2, 'seeded conversations missing');
    const previews = await page.locator('.match-row .preview').allTextContents();
    assert(previews.every(t => t.trim().length > 0), 'empty preview');
  });

  await test('unread state shows a tab badge and a row dot', async () => {
    assert(await page.locator('#dot-matches.show').count() === 1, 'tab unread badge missing');
    const jonahRow = page.locator('.match-row:has-text("Jonah")');
    assert(await jonahRow.locator('.unread.show').count() === 1, 'row unread dot missing');
  });

  await test('opening the chat clears the unread state', async () => {
    await page.click('.match-row:has-text("Jonah")');
    await page.waitForSelector('#screen-chat.active');
    assert(/Jonah/.test(await page.textContent('#chat-name')), 'wrong chat opened');
    assert(await page.locator('.bubble.them').count() >= 1, 'history missing');
    await page.click('#screen-chat [data-back]');
    await page.waitForSelector('#view-matches.active');
    assert(await page.locator('#dot-matches.show').count() === 0, 'unread badge not cleared');
  });

  await test('send button enables only with text', async () => {
    await page.click('.match-row:has-text("Jonah")');
    await page.waitForSelector('#screen-chat.active');
    assert(await page.locator('#chat-send').isDisabled(), 'send enabled while empty');
    await page.fill('#chat-input', 'hello');
    assert(!(await page.locator('#chat-send').isDisabled()), 'send still disabled with text');
  });

  await test('sending appends my bubble with a timestamp', async () => {
    const before = await page.locator('.bubble.me').count();
    await page.fill('#chat-input', 'Flat white, oat milk. Judge away.');
    await page.click('#chat-send');
    await page.waitForTimeout(200);
    assert(await page.locator('.bubble.me').count() === before + 1, 'message not appended');
    assert(/\d{1,2}:\d{2}/.test(await page.locator('.bubble.me .t').last().textContent()), 'no timestamp');
    assert((await page.inputValue('#chat-input')) === '', 'input not cleared');
  });

  await test('typing indicator then auto-reply arrives', async () => {
    await page.waitForSelector('.bubble.typing');
    await page.waitForFunction(
      () => !document.querySelector('.bubble.typing'),
      null, { timeout: 6000 }
    );
    const last = await page.locator('.bubble.them').last().textContent();
    assert(last.trim().length > 0, 'no reply text');
  });

  await test('matches list preview updates to the latest message', async () => {
    const latest = (await page.locator('.bubble').last().textContent()).replace(/\d{1,2}:\d{2}.*$/, '').trim();
    await page.click('#screen-chat [data-back]');
    await page.waitForSelector('#view-matches.active');
    const preview = await page.locator('.match-row:has-text("Jonah") .preview').textContent();
    assert(preview.includes(latest.slice(0, 12)), 'preview not updated: ' + preview);
  });

  await test('conversation persists across reload', async () => {
    await page.reload();
    await page.waitForSelector('#screen-app.active');
    await page.click('#tab-btn-matches');
    await page.click('.match-row:has-text("Jonah")');
    await page.waitForSelector('#screen-chat.active');
    assert(await page.locator('.bubble.me').count() >= 1, 'sent message lost on reload');
  });
});
