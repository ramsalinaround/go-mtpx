'use strict';
// Feature: auth & session (spec 01 — OTP signup/login, session persistence; mocked
// here as email/password). Guards: validation incl. the 18+ hard stop, signup flow,
// session persistence across reload, login, logout.

const { suite, assert, freshApp, signUp, storedState } = require('./harness');

suite('Auth & session', async ({ page, test }) => {

  await test('welcome screen offers signup and login', async () => {
    await freshApp(page);
    assert(await page.locator('#btn-goto-signup').isVisible(), 'no signup button');
    assert(await page.locator('#btn-goto-login').isVisible(), 'no login button');
  });

  await test('signup rejects empty name', async () => {
    await page.click('#btn-goto-signup');
    await page.click('#form-signup button[type=submit]');
    const err = await page.textContent('#su-error');
    assert(/first name/i.test(err), 'expected name error, got: ' + err);
  });

  await test('signup hard-stops underage input (18+ non-negotiable)', async () => {
    await page.fill('#su-name', 'Kid');
    await page.fill('#su-age', '17');
    await page.fill('#su-email', 'kid@example.com');
    await page.fill('#su-password', 'longenough');
    await page.click('#form-signup button[type=submit]');
    const err = await page.textContent('#su-error');
    assert(/18 or older/.test(err), 'expected 18+ error, got: ' + err);
    assert(await page.locator('#screen-signup.active').count() === 1, 'left signup screen');
  });

  await test('signup rejects malformed email and short password', async () => {
    await page.fill('#su-age', '27');
    await page.fill('#su-email', 'not-an-email');
    await page.click('#form-signup button[type=submit]');
    assert(/email/i.test(await page.textContent('#su-error')), 'expected email error');
    await page.fill('#su-email', 'ok@example.com');
    await page.fill('#su-password', 'abc');
    await page.click('#form-signup button[type=submit]');
    assert(/6 characters/.test(await page.textContent('#su-error')), 'expected password error');
  });

  await test('profile setup requires at least 3 interests', async () => {
    await page.fill('#su-password', 'longenough');
    await page.click('#form-signup button[type=submit]');
    await page.waitForSelector('#screen-setup.active');
    await page.click('#form-setup button[type=submit]');
    assert(/3 interests/.test(await page.textContent('#set-error')), 'expected interests error');
  });

  await test('completing setup enters the app', async () => {
    for (const t of ['Coffee', 'Film', 'Hiking']) {
      await page.click(`#setup-interests .chip:has-text("${t}")`);
    }
    await page.click('#form-setup button[type=submit]');
    await page.waitForSelector('#screen-app.active');
  });

  await test('session persists across reload', async () => {
    await page.reload();
    await page.waitForSelector('#screen-app.active');
    const s = await storedState(page);
    assert(s && s.user && s.user.name === 'Kid', 'stored user missing after reload');
  });

  await test('logout returns to welcome and clears the session', async () => {
    await page.click('#tab-btn-profile');
    await page.click('#btn-logout');
    await page.waitForSelector('#screen-welcome.active');
    assert(!(await storedState(page)), 'storage not cleared on logout');
    await page.reload();
    await page.waitForSelector('#screen-welcome.active');
  });

  await test('login validates email and enters the app', async () => {
    await page.click('#btn-goto-login');
    await page.fill('#li-email', 'nope');
    await page.fill('#li-password', 'x');
    await page.click('#form-login button[type=submit]');
    assert(/email/i.test(await page.textContent('#li-error')), 'expected email error');
    await page.fill('#li-email', 'back@example.com');
    await page.click('#form-login button[type=submit]');
    await page.waitForSelector('#screen-app.active');
  });
});
