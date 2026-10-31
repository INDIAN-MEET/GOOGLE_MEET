// scripts/test-first-time-join.mjs
import puppeteer from 'puppeteer-core';

async function test() {
  const browser = await puppeteer.launch({
    executablePath: 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe',
    headless: true,
    args: [
      '--use-fake-ui-for-media-stream',
      '--use-fake-device-for-media-stream',
      '--no-sandbox'
    ]
  });

  const page = await browser.newPage();
  const testEmail = `cache_test_${Date.now()}@example.com`;

  console.log(`[1] Signing up new user ${testEmail}...`);
  await page.goto('http://localhost:5173/signup', { waitUntil: 'networkidle2' });
  await page.waitForSelector('input[type="email"]');
  await page.type('input[type="email"]', testEmail);
  await page.type('input[type="password"]', 'Password123!');
  const submitBtn = await page.waitForSelector('form button.primary');
  await submitBtn.click();

  await page.waitForFunction(() => window.location.pathname === '/', { timeout: 10000 });
  console.log(`[PASS] On Dashboard: ${page.url()}`);

  console.log(`[2] Creating first room...`);
  const newBtn = await page.waitForSelector('button.primary');
  await newBtn.click();
  await page.waitForFunction(() => window.location.pathname.startsWith('/room/'), { timeout: 10000 });
  console.log(`[PASS] In Pre-join lobby: ${page.url()}`);

  console.log(`[3] Clicking 'Join now' on FIRST ATTEMPT (no reload)...`);
  // PreJoin card has "Join now" as button.primary
  const joinBtn = await page.waitForSelector('main button.primary');
  await joinBtn.click();

  // Verify call screen loaded
  await page.waitForSelector('button[title="Leave meeting"]', { timeout: 10000 });
  console.log(`[PASS] Room 1 joined on FIRST ATTEMPT without reload!`);

  // Leave room 1
  console.log(`[4] Leaving Room 1...`);
  const leaveBtn = await page.waitForSelector('button[title="Leave meeting"]');
  await leaveBtn.click();
  await page.waitForFunction(() => window.location.pathname === '/', { timeout: 10000 });
  console.log(`[PASS] Returned to dashboard: ${page.url()}`);

  // Create room 2 immediately without reload
  console.log(`[5] Creating Room 2 immediately (still no page reload)...`);
  const newBtn2 = await page.waitForSelector('button.primary');
  await newBtn2.click();
  await page.waitForFunction(() => window.location.pathname.startsWith('/room/'), { timeout: 10000 });
  console.log(`[PASS] In Room 2 lobby: ${page.url()}`);

  console.log(`[6] Clicking 'Join now' on Room 2 on FIRST ATTEMPT...`);
  const joinBtn2 = await page.waitForSelector('main button.primary');
  await joinBtn2.click();

  await page.waitForSelector('button[title="Leave meeting"]', { timeout: 10000 });
  console.log(`[PASS] Room 2 joined on FIRST ATTEMPT without reload!`);

  await browser.close();
  console.log(`\n======================================================`);
  console.log(`ALL FIRST-TIME JOINS WORK ON THE VERY FIRST CLICK NOW!`);
  console.log(`======================================================`);
}

test().catch(err => {
  console.error('Test error:', err);
  process.exit(1);
});
