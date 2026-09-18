'use strict';
// Feature: profile photos + moderation (spec 01 — 1–6 photos with reorder;
// non-negotiable 7: photos render to others only when approved, owner sees
// pending/rejected states; Profile tab shows a dot when a photo was rejected).
// Moderation is simulated (~2.5s); the "Low light" sample is always rejected.

const { suite, assert, freshApp, signUp, topCardId, storedState } = require('./harness');

const MOD_WAIT = 4000; // simulated moderation is 2.5s

async function addPhoto(page, label) {
  await page.click('.photo-add');
  await page.waitForSelector('#photo-backdrop.open');
  await page.click(`.photo-preset:has-text("${label}")`);
  await page.waitForTimeout(150);
}

function photoKinds(page) {
  return storedState(page).then(s => s.user.photos.map(p => p.kind));
}

suite('Profile photos & moderation', async ({ page, test }) => {

  await test('profile shows an empty 6-slot photo grid', async () => {
    await freshApp(page);
    await signUp(page);
    await page.click('#tab-btn-profile');
    await page.waitForSelector('#photo-grid');
    assert(await page.locator('.photo-add').count() === 1, 'no add tile');
    assert(await page.locator('.photo-empty').count() === 5, 'expected 5 empty outlines');
    assert(await page.locator('.photo-slot').count() === 0, 'unexpected photos');
  });

  await test('adding a photo starts it in review (pending)', async () => {
    await page.click('.photo-add');
    await page.waitForSelector('#photo-backdrop.open');
    assert(await page.locator('.photo-preset').count() === 8, 'expected 8 sample photos');
    await page.click('.photo-preset:has-text("Sunset")');
    await page.waitForSelector('.photo-slot[data-status="pending"]');
    assert(/In review/.test(await page.textContent('.photo-slot .ph-chip')), 'no review chip');
    assert(!(await page.locator('#photo-backdrop.open').count()), 'picker did not close');
  });

  await test('moderation approves the photo and marks it Main', async () => {
    await page.waitForSelector('.photo-slot[data-status="approved"]', { timeout: MOD_WAIT + 3000 });
    assert(/Main/.test(await page.textContent('.photo-slot .ph-chip')), 'first approved photo not marked Main');
  });

  await test('a rejected photo shows its state and badges the Profile tab', async () => {
    await addPhoto(page, 'Low light');
    await page.waitForSelector('.photo-slot[data-status="rejected"]', { timeout: MOD_WAIT + 3000 });
    const chip = await page.textContent('.photo-slot[data-status="rejected"] .ph-chip');
    assert(/Rejected/.test(chip), 'no rejected chip: ' + chip);
    assert(await page.locator('#dot-profile.show').count() === 1, 'Profile tab dot missing');
  });

  await test('removing the rejected photo clears the badge', async () => {
    await page.click('.photo-slot[data-status="rejected"] .ph-remove');
    await page.waitForTimeout(200);
    assert(await page.locator('#dot-profile.show').count() === 0, 'dot not cleared');
    assert((await storedState(page)).user.photos.length === 1, 'photo not removed');
  });

  await test('arrows reorder photos', async () => {
    await addPhoto(page, 'Forest');
    await page.waitForFunction(
      () => document.querySelectorAll('.photo-slot[data-status="approved"]').length === 2,
      null, { timeout: MOD_WAIT + 3000 }
    );
    assert((await photoKinds(page)).join() === 'sunset,forest', 'unexpected starting order');
    await page.click('.photo-slot >> nth=0 >> .ph-right');
    await page.waitForTimeout(200);
    assert((await photoKinds(page)).join() === 'forest,sunset', 'reorder failed');
    await page.click('.photo-slot >> nth=1 >> .ph-left');
    await page.waitForTimeout(200);
    assert((await photoKinds(page)).join() === 'sunset,forest', 'reorder back failed');
  });

  await test('the grid caps at 6 photos', async () => {
    for (const label of ['Coast', 'City', 'Café', 'Mountain']) {
      await addPhoto(page, label);
    }
    assert((await storedState(page)).user.photos.length === 6, 'expected 6 photos');
    assert(await page.locator('.photo-add').count() === 0, 'add tile still present at cap');
    assert(await page.locator('.photo-empty').count() === 0, 'empty outline present at cap');
  });

  await test('photos and pending review resume across reload', async () => {
    await page.reload();
    await page.waitForSelector('#screen-app.active');
    await page.click('#tab-btn-profile');
    assert(await page.locator('.photo-slot').count() === 6, 'photos lost on reload');
    await page.waitForFunction(
      () => document.querySelectorAll('.photo-slot[data-status="pending"]').length === 0,
      null, { timeout: MOD_WAIT + 4000 }
    );
    assert(await page.locator('.photo-slot[data-status="approved"]').count() === 6,
      'pending photos did not resume moderation after reload');
  });

  await test('deck shows an approved photo as the card art', async () => {
    await page.click('#tab-btn-discover');
    await page.waitForSelector('.deck-card');
    assert((await topCardId(page)) === 'priya', 'unexpected top card');
    const top = page.locator('.deck-card >> nth=-1');
    assert((await top.getAttribute('data-photo')) === '1', 'approved photo not rendered');
    assert(await top.locator('.initials').count() === 0, 'initials shown over a photo card');
  });

  await test('non-approved photos never render for other users', async () => {
    // Theo's only photo is pending — his card must fall back to initials
    await page.click('#btn-pass');
    await page.waitForTimeout(400);
    assert((await topCardId(page)) === 'theo', 'unexpected card order');
    const top = page.locator('.deck-card >> nth=-1');
    assert((await top.getAttribute('data-photo')) === '0', 'pending photo leaked to another user');
    assert(await top.locator('.initials').count() === 1, 'fallback initials missing');
  });
});
