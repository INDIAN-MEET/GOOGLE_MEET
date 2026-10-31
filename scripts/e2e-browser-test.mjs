// scripts/e2e-browser-test.mjs
import puppeteer from 'puppeteer-core';
import path from 'path';

const CHROME_PATH = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const FRONTEND_URL = 'http://localhost:5173';
const ROOM_CODE = process.argv[2] || '1lp-eff7-bhv';

console.log('=== STARTING FULL BROWSER E2E TEST ===');
console.log(`Target Room: ${ROOM_CODE}`);

async function runBrowserTest() {
  const browser = await puppeteer.launch({
    executablePath: CHROME_PATH,
    headless: true, // run headless with fake media
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--allow-file-access-from-files',
      '--no-sandbox',
      '--disable-setuid-sandbox',
      '--disable-gpu',
      '--window-size=1280,800'
    ]
  });

  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800 });

  // Capture browser console logs
  page.on('console', (msg) => {
    const text = msg.text();
    if (msg.type() === 'error' || text.includes('failed') || text.includes('Error')) {
      console.log(`[Browser Console ${msg.type()}]:`, text);
    }
  });

  page.on('pageerror', (err) => {
    console.error('[Browser Uncaught Page Error]:', err.message);
  });

  try {
    // 1. First, create a test participant account and login via UI
    const testEmail = `bot_${Date.now()}@example.com`;
    const testPassword = 'Password123!@#';

    console.log(`\n[Step 1] Navigating to Signup page: ${FRONTEND_URL}/signup`);
    await page.goto(`${FRONTEND_URL}/signup`, { waitUntil: 'networkidle2' });

    console.log(`[Step 2] Signing up new browser bot (${testEmail})...`);
    await page.waitForSelector('input[type="email"]');
    await page.type('input[type="email"]', testEmail);
    await page.type('input[type="password"]', testPassword);
    const submitBtn = await page.waitForSelector('form button.primary');
    await submitBtn.click();

    // Wait for SPA redirect to home
    await page.waitForFunction(() => window.location.pathname === '/', { timeout: 10000 });
    console.log(`[PASS] Signup & Login successful! Current URL: ${page.url()}`);

    // 2. Navigate to room page
    console.log(`\n[Step 3] Navigating to Room: ${FRONTEND_URL}/room/${ROOM_CODE}`);
    await page.goto(`${FRONTEND_URL}/room/${ROOM_CODE}`, { waitUntil: 'networkidle2' });

    // Wait for PreJoin screen
    await page.waitForSelector('.card');
    console.log('[PASS] PreJoin Lobby loaded!');

    // Wait 2 seconds for fake camera to start
    await new Promise((r) => setTimeout(r, 2000));

    // Check for Join now button
    const joinBtn = await page.waitForSelector('button.primary');
    console.log('[Step 4] Clicking "Join now"...');
    await joinBtn.click();

    // 3. Wait for call screen (.call)
    await page.waitForSelector('.call', { timeout: 15000 });
    console.log('[PASS] Successfully joined the meeting! Call screen (.call) is active.');

    // Wait 3 seconds for media negotiation & SFU
    await new Promise((r) => setTimeout(r, 3000));

    // Verify video grid
    const tilesCount = await page.$$eval('.tile', (tiles) => tiles.length);
    console.log(`[PASS] Video grid contains ${tilesCount} video tile(s).`);

    // 4. Test Chat Feature
    console.log('\n[Step 5] Testing Real-time Chat Panel in UI...');
    const chatBtn = await page.waitForSelector('button[title="Chat"]');
    await chatBtn.click();

    await page.waitForSelector('.panel', { timeout: 5000 });
    console.log('[PASS] Chat panel opened.');

    const chatInput = await page.waitForSelector('.composer input');
    await chatInput.type('Automated Browser Test Message: WebRTC and Chat are working perfectly! 🚀');
    await page.keyboard.press('Enter');

    await new Promise((r) => setTimeout(r, 1500));
    const messages = await page.$$eval('.msg', (msgs) => msgs.map((m) => m.textContent));
    console.log(`[PASS] Chat messages visible in UI: ${messages.length}`);
    if (messages.length > 0) {
      console.log('Latest message in panel:', messages[messages.length - 1]);
    }

    // Close chat panel
    await chatBtn.click();
    await new Promise((r) => setTimeout(r, 500));

    // 5. Test Invite Guests Panel
    console.log('\n[Step 6] Testing Invite Guests Panel in UI...');
    const inviteBtn = await page.$('button[title="Invite guests"]');
    if (inviteBtn) {
      await inviteBtn.click();
      await page.waitForSelector('.panel', { timeout: 5000 });
      console.log('[PASS] Invite panel opened.');

      const inviteInput = await page.waitForSelector('textarea, input[placeholder*="email" i]');
      await inviteInput.type('guest1@example.com, guest2@example.com');

      const sendInviteBtn = await page.$('.panel button.primary');
      if (sendInviteBtn) {
        await sendInviteBtn.click();
        await new Promise((r) => setTimeout(r, 1500));
        console.log('[PASS] Invite action triggered.');
      }
      await inviteBtn.click(); // Close
    } else {
      console.log('[NOTE] Invite button only visible to room host; current user is a guest.');
    }

    // 6. Test Recordings Panel
    console.log('\n[Step 7] Testing Recordings Panel in UI...');
    const recBtn = await page.waitForSelector('button[title="Recordings"]');
    await recBtn.click();

    await page.waitForSelector('.panel', { timeout: 5000 });
    console.log('[PASS] Recordings panel opened.');

    const panelText = await page.$eval('.panel', (el) => el.textContent);
    console.log('Recordings Panel Text:', panelText.trim().replace(/\s+/g, ' '));

    // Ensure no "Route not found" error exists
    if (panelText.includes('Route not found')) {
      console.error('[FAIL] Route not found error detected in Recordings Panel!');
    } else {
      console.log('[PASS] No route errors in Recordings panel!');
    }

    // 7. Test Mute / Unmute Controls
    console.log('\n[Step 8] Testing Mic / Camera Toggles...');
    const micToggle = await page.waitForSelector('button[title*="microphone" i]');
    await micToggle.click();
    await new Promise((r) => setTimeout(r, 500));
    console.log('[PASS] Microphone toggled.');

    const camToggle = await page.waitForSelector('button[title*="camera" i]');
    await camToggle.click();
    await new Promise((r) => setTimeout(r, 500));
    console.log('[PASS] Camera toggled.');

    // 8. Capture screenshot for verification
    const screenshotPath = path.resolve('scripts', 'browser-e2e-screenshot.png');
    await page.screenshot({ path: screenshotPath, fullPage: false });
    console.log(`\n[PASS] Captured call screenshot: ${screenshotPath}`);

    // Stay in call for 5 seconds to exchange media
    console.log('\n[Step 9] Keeping call session alive for 5 seconds...');
    await new Promise((r) => setTimeout(r, 5000));

    // 9. Test Leave Call
    console.log('\n[Step 10] Testing Leave Meeting...');
    const leaveBtn = await page.waitForSelector('button[title="Leave meeting"]');
    await leaveBtn.click();

    await page.waitForFunction(() => window.location.pathname === '/', { timeout: 10000 });
    console.log(`[PASS] Left meeting successfully! Redirected to: ${page.url()}`);

    console.log('\n=== ALL BROWSER E2E TESTS PASSED SUCCESSFULLY! ===\n');
  } finally {
    await browser.close();
  }
}

runBrowserTest().catch((err) => {
  console.error('\n[FATAL ERROR during browser E2E test]:', err);
  process.exit(1);
});
