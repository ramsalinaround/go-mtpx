'use strict';
// Feature: own profile (spec 01 — name, age shown (never DOB), bio, interests).
// Guards: identity display, edits via PATCH /me/profile, persistence, the
// minimum-interests rule on edit.

const { suite, assert, freshApp, signUp, storedState } = require('./harness');

suite('Profile', async ({ page, test }) => {

  await test('profile shows name, age and bio after signup', async () => {
    await freshApp(page);
    await signUp(page, { name: 'Ana', age: 30, bio: 'Original bio.', phone: '+13035550102' });
    await page.click('#tab-btn-profile');
    await page.waitForSelector('#view-profile.active');
    assert(/Ana, 30/.test(await page.textContent('#me-name')), 'name/age wrong');
    assert(/\+13035550102/.test(await page.textContent('#me-sub')), 'phone not shown');
    assert((await page.inputValue('#pf-bio')) === 'Original bio.', 'bio not shown');
  });

  await test('edited bio and interests save through the API', async () => {
    await page.fill('#pf-bio', 'Edited bio.');
    await page.click('#pf-interests .chip:has-text("Books")');
    await page.click('#form-profile button[type=submit]');
    await page.waitForTimeout(400);
    const s = await storedState(page);
    assert(s.user.bio === 'Edited bio.', 'bio not saved');
    assert(s.user.interests.includes('Books'), 'interest not saved');
  });

  await test('edits persist across reload', async () => {
    await page.reload();
    await page.waitForSelector('#screen-app.active');
    await page.click('#tab-btn-profile');
    await page.waitForFunction(() => document.getElementById('pf-bio').value.length > 0);
    assert((await page.inputValue('#pf-bio')) === 'Edited bio.', 'bio lost on reload');
  });

  await test('cannot save with fewer than 3 interests', async () => {
    const before = (await storedState(page)).user.interests.length;
    const on = page.locator('#pf-interests .chip[aria-pressed="true"]');
    while (await on.count() > 2) await on.first().click();
    await page.click('#form-profile button[type=submit]');
    await page.waitForTimeout(300);
    const after = (await storedState(page)).user.interests.length;
    assert(after === before, 'save went through with <3 interests');
  });

  await test('profile color change is applied to the avatar', async () => {
    const beforeBg = await page.evaluate(() => document.getElementById('me-avatar').style.background);
    await page.click('#pf-swatches .swatch >> nth=4');
    const chips = page.locator('#pf-interests .chip[aria-pressed="false"]');
    while (await page.locator('#pf-interests .chip[aria-pressed="true"]').count() < 3) {
      await chips.first().click();
    }
    await page.click('#form-profile button[type=submit]');
    await page.waitForTimeout(400);
    const afterBg = await page.evaluate(() => document.getElementById('me-avatar').style.background);
    assert(beforeBg !== afterBg, 'avatar gradient unchanged after color save');
  });
});
