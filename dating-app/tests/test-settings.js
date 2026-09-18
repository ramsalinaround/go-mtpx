'use strict';
// Feature: settings & compliance (contract 02 — POST /devices, POST /me/export
// 202, DELETE /me; spec 01 non-negotiables 4+5). Guards: legal at signup and in
// settings, notification toggle persistence, export, logout, deletion.

const { suite, assert, freshApp, signUp, logIn, storedState, DEFAULT_PHONE } = require('./harness');

suite('Settings & compliance', async ({ page, test }) => {

  await test('legal links are shown at signup and open the policies', async () => {
    await freshApp(page);
    await page.click('#btn-get-started');
    assert(await page.locator('#link-tos').isVisible(), 'ToS link missing from signup');
    await page.click('#link-privacy');
    await page.waitForSelector('#legal-backdrop.open');
    assert(/Privacy Policy/.test(await page.textContent('#legal-title')), 'wrong legal doc');
    assert((await page.textContent('#legal-body')).length > 200, 'policy body empty');
    await page.click('#btn-legal-close');
  });

  await test('settings screen is reachable from the profile tab', async () => {
    await page.click('[data-back="screen-welcome"]');
    await signUp(page);
    await page.click('#tab-btn-profile');
    await page.click('#btn-open-settings');
    await page.waitForSelector('#screen-settings.active');
    for (const id of ['btn-set-prefs', 'toggle-notif', 'btn-tos', 'btn-privacy',
      'btn-export', 'btn-logout-settings', 'btn-delete-account']) {
      assert(await page.locator('#' + id).count() === 1, id + ' missing');
    }
  });

  await test('support contact is visible', async () => {
    assert(/support@maktub\.app/.test(await page.textContent('#support-contact')), 'support contact missing');
  });

  await test('ToS and privacy policy open from settings', async () => {
    await page.click('#btn-tos');
    await page.waitForSelector('#legal-backdrop.open');
    assert(/Terms of Service/.test(await page.textContent('#legal-title')), 'wrong doc');
    assert(/18 or older/.test(await page.textContent('#legal-body')), 'ToS body wrong');
    await page.click('#btn-legal-close');
    await page.click('#btn-privacy');
    assert(/Privacy Policy/.test(await page.textContent('#legal-title')), 'wrong doc');
    await page.click('#btn-legal-close');
  });

  await test('discovery preferences open the filter sheet from settings', async () => {
    await page.click('#btn-set-prefs');
    await page.waitForSelector('#filter-backdrop.open');
    await page.click('#btn-apply-filters');
    await page.waitForFunction(() => !document.getElementById('filter-backdrop').classList.contains('open'));
  });

  await test('notification toggle persists across reload', async () => {
    assert(await page.isChecked('#toggle-notif'), 'toggle should default on');
    await page.click('#toggle-notif');
    await page.waitForTimeout(300);
    assert((await storedState(page)).settings.notifications === false, 'toggle not saved');
    await page.reload();
    await page.waitForSelector('#screen-app.active');
    await page.click('#tab-btn-profile');
    await page.click('#btn-open-settings');
    assert(!(await page.isChecked('#toggle-notif')), 'toggle state lost on reload');
  });

  await test('data export requests via the API and shows the account as JSON', async () => {
    await page.click('#btn-export');
    await page.waitForSelector('#export-backdrop.open');
    const json = JSON.parse(await page.inputValue('#export-json'));
    assert(/202/.test(json.export_request), 'export request not accepted');
    assert(json.me && json.me.profile.name === 'Sam', 'profile missing from export');
    assert(Array.isArray(json.matches) && json.matches.length >= 2, 'matches missing from export');
    assert(json.settings && json.settings.notifications === false, 'settings missing from export');
    const threads = Object.keys(json.messages || {});
    assert(threads.length >= 2 && json.messages[threads[0]].length >= 1, 'messages missing from export');
    await page.click('#btn-export-close');
  });

  await test('logout is available from settings', async () => {
    await page.click('#btn-logout-settings');
    await page.waitForSelector('#screen-welcome.active');
    assert(!(await storedState(page)), 'session not cleared');
  });

  await test('account deletion requires confirmation — cancel keeps the account', async () => {
    await logIn(page, DEFAULT_PHONE);
    await page.click('#tab-btn-profile');
    await page.click('#btn-open-settings');
    await page.click('#btn-delete-account');
    await page.waitForSelector('#delete-backdrop.open');
    assert(/permanently deletes/.test(await page.textContent('#delete-backdrop')), 'no consequence copy');
    assert(/not the same as logging out/.test(await page.textContent('#delete-backdrop')),
      'deletion not distinguished from logout');
    await page.click('#btn-delete-cancel');
    assert(!(await page.locator('#delete-backdrop.open').count()), 'sheet still open');
    assert((await storedState(page)) !== null, 'cancel deleted the account');
  });

  await test('confirmed deletion permanently removes the account', async () => {
    await page.click('#btn-delete-account');
    await page.click('#btn-delete-confirm');
    await page.waitForSelector('#screen-welcome.active');
    assert(!(await storedState(page)), 'account data still present');
    await page.reload();
    await page.waitForSelector('#screen-welcome.active');
  });
});
