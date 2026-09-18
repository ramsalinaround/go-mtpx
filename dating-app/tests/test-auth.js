'use strict';
// Feature: auth & session (contract 02 — phone OTP signup/login, token pair,
// session persistence, logout). Guards: E.164 validation, invalid_otp handling,
// resend cooldown, the server-enforced 18+ hard stop, onboarding routing.

const { suite, assert, freshApp, logIn, storedState, birthdateForAge, OTP_CODE } = require('./harness');

suite('Auth & session (OTP)', async ({ page, test }) => {

  await test('welcome screen offers phone signup', async () => {
    await freshApp(page);
    assert(await page.locator('#btn-get-started').isVisible(), 'no get-started button');
  });

  await test('a non-E.164 phone number is rejected', async () => {
    await page.click('#btn-get-started');
    await page.fill('#ph-number', '303-555');
    await page.click('#btn-send-code');
    await page.waitForFunction(() => document.getElementById('ph-error').textContent.length > 0);
    assert(/E\.164|\+1/.test(await page.textContent('#ph-error')), 'no format hint');
    assert(await page.locator('#screen-phone.active').count() === 1, 'left phone screen');
  });

  await test('a valid number moves to the code screen with a resend cooldown', async () => {
    await page.fill('#ph-number', '+13035550142');
    await page.click('#btn-send-code');
    await page.waitForSelector('#screen-otp.active');
    assert(/\+13035550142/.test(await page.textContent('#otp-phone')), 'phone not echoed');
    assert(await page.locator('#btn-resend').isDisabled(), 'resend not on cooldown');
    assert(/\(\d+s\)/.test(await page.textContent('#btn-resend')), 'no countdown label');
  });

  await test('a wrong code shows invalid_otp feedback', async () => {
    await page.fill('#otp-code', '000000');
    await page.click('#form-otp button[type=submit]');
    await page.waitForFunction(() => document.getElementById('otp-error').textContent.length > 0);
    assert(/didn't match/.test(await page.textContent('#otp-error')), 'wrong error copy');
  });

  await test('the right code routes a new account to profile setup', async () => {
    await page.fill('#otp-code', OTP_CODE);
    await page.click('#form-otp button[type=submit]');
    await page.waitForSelector('#screen-setup.active');
  });

  await test('setup requires name and at least 3 interests', async () => {
    await page.click('#form-setup button[type=submit]');
    assert(/first name/i.test(await page.textContent('#set-error')), 'expected name error');
    await page.fill('#set-name', 'Kid');
    await page.fill('#set-birthdate', birthdateForAge(25));
    await page.click('#form-setup button[type=submit]');
    assert(/3 interests/.test(await page.textContent('#set-error')), 'expected interests error');
  });

  await test('the server hard-stops underage birthdates (18+ non-negotiable)', async () => {
    for (const t of ['Coffee', 'Film', 'Hiking']) {
      await page.click(`#setup-interests .chip:has-text("${t}")`);
    }
    await page.fill('#set-birthdate', birthdateForAge(17));
    await page.click('#form-setup button[type=submit]');
    await page.waitForFunction(() => /18 or older/.test(document.getElementById('set-error').textContent));
    assert(await page.locator('#screen-setup.active').count() === 1, 'left setup screen');
    const s = await storedState(page);
    assert(s.matches.length === 0, 'onboarding completed for an underage profile');
  });

  await test('an adult birthdate completes onboarding into the app', async () => {
    await page.fill('#set-birthdate', birthdateForAge(25));
    await page.click('#form-setup button[type=submit]');
    await page.waitForSelector('#screen-app.active');
    const s = await storedState(page);
    assert(s.user.name === 'Kid', 'profile not saved');
  });

  await test('session persists across reload', async () => {
    await page.reload();
    await page.waitForSelector('#screen-app.active');
    assert((await storedState(page)).user.name === 'Kid', 'session lost');
  });

  await test('logout returns to welcome and clears the session', async () => {
    await page.click('#tab-btn-profile');
    await page.click('#btn-logout');
    await page.waitForSelector('#screen-welcome.active');
    assert(!(await storedState(page)), 'session not cleared');
    await page.reload();
    await page.waitForSelector('#screen-welcome.active');
  });

  await test('logging back in with the same phone skips setup', async () => {
    await logIn(page, '+13035550142');
    const s = await storedState(page);
    assert(s.user.name === 'Kid', 'wrong account after re-login');
  });
});
