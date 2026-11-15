/* iPhone 화면으로 앱을 띄워 주요 흐름을 점검하는 스모크 테스트
 * 사용: node tests/ui-smoke.cjs [스크린샷폴더]   (Playwright 필요) */
const { chromium, devices } = require('playwright');
const http = require('http');
const fs = require('fs');
const path = require('path');
const assert = require('assert/strict');

const ROOT = path.join(__dirname, '..');
const OUT = process.argv[2];
const TYPES = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.svg': 'image/svg+xml', '.png': 'image/png', '.webmanifest': 'application/manifest+json' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(new URL(req.url, 'http://x').pathname);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f)) { res.writeHead(404); return res.end(); }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

(async () => {
  await new Promise(r => server.listen(0, r));
  const url = `http://localhost:${server.address().port}/`;
  const browser = await chromium.launch();
  const ctx = await browser.newContext({ ...devices['iPhone 14'] });
  const page = await ctx.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  page.on('console', m => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('dialog', d => d.accept());
  const shot = async n => { if (OUT) await page.screenshot({ path: path.join(OUT, `${n}.png`) }); };

  await page.goto(url);
  await page.waitForSelector('.empty');
  await shot('0-empty');

  // 매수 기록 (새 종목)
  await page.click('[data-action="new-trade"][data-type="buy"]');
  await page.fill('#tf [name=name]', '테스트전자');
  await page.fill('#tf [name=qty]', '10');
  await page.fill('#tf [name=price]', '70000');
  await page.click('#tf button.primary');
  // 2차 매수
  await page.click('[data-action="new-trade"][data-type="buy"]');
  await page.fill('#tf [name=qty]', '10');
  await page.fill('#tf [name=price]', '60000');
  await page.fill('#tf [name=fee]', '0');
  await page.click('#tf button.primary');

  let st = await page.evaluate(() => window.StockNote.state);
  assert.equal(st.trades.length, 2);
  const fee1 = 10 * 70000 * 0.015 / 100;
  const book = await page.evaluate(() => [...window.StockNote.computeBook().pos.values()][0]);
  assert.equal(book.qty, 20);
  assert.ok(Math.abs(book.cost - (700000 + fee1 + 600000)) < 1e-6);

  // 매도 → 실현손익
  await page.click('[data-action="new-trade"][data-type="sell"]');
  await page.fill('#tf [name=qty]', '5');
  await page.fill('#tf [name=price]', '80000');
  await page.fill('#tf [name=fee]', '0');
  await page.click('#tf button.primary');
  const b2 = await page.evaluate(() => [...window.StockNote.computeBook().pos.values()][0]);
  const avg = (1300000 + fee1) / 20;
  assert.equal(b2.qty, 15);
  assert.ok(Math.abs(b2.realized - (400000 - avg * 5)) < 1e-6);

  // 현재가 입력
  await page.click('[data-action="symbol"]');
  await page.click('[data-sa="price"]');
  await page.fill('#pf [name=price]', '75000');
  await page.click('#pf button.primary');
  await page.waitForSelector('.summary');
  await shot('1-portfolio');

  // 일지
  await page.click('.tabbar [data-tab=journal]');
  assert.equal(await page.locator('#view .item').count(), 3);
  await shot('2-journal');

  // 계산기
  await page.click('.tabbar [data-tab=calc]');
  await page.fill('#calc-avg [name=q0]', '10');
  await page.fill('#calc-avg [name=a0]', '70000');
  await page.fill('#calc-avg .calc-row [name=p]', '50000');
  await page.fill('#calc-avg .calc-row [name=q]', '10');
  const avgTxt = await page.textContent('#out-avg .hl');
  assert.equal(avgTxt.trim(), '60,000');
  await page.fill('#calc-target [name=tq]', '10');
  await page.fill('#calc-target [name=ta]', '70000');
  await page.fill('#calc-target [name=tp]', '50000');
  await page.fill('#calc-target [name=tt]', '60000');
  assert.match(await page.textContent('#out-target .hl'), /^10주/);
  await page.fill('#calc-goal [name=ga]', '60000');
  await shot('3-calc');

  // CSV 붙여넣기 + 차트
  await page.click('.tabbar [data-tab=chart]');
  await page.click('[data-action="csv"]');
  const lines = ['일자\t종가\t시가\t고가\t저가\t거래량'];
  let p = 50000;
  for (let i = 0; i < 90; i++) {
    const d = new Date(Date.UTC(2026, 5, 1 + i)).toISOString().slice(0, 10);
    const o = p; p = Math.round(p * (1 + Math.sin(i / 6) * 0.02 + 0.003));
    lines.push(`${d}\t"${p.toLocaleString('en-US')}"\t${o}\t${Math.max(o, p) + 300}\t${Math.min(o, p) - 300}\t${100000 + i * 1000}`);
  }
  await page.fill('#cf [name=t]', lines.join('\n'));
  assert.match(await page.textContent('#cf-prev'), /인식: 90일/);
  await page.click('#cf button.primary');
  await page.waitForSelector('#cv');
  const hist = await page.evaluate(() => window.StockNote.state.symbols[0].history);
  assert.equal(hist.length, 90);
  const b = hist.find(x => x.d === '2026-06-01');
  assert.ok(b.o != null && b.h >= b.c && b.l <= b.c);
  await page.locator('#cv').tap({ position: { x: 150, y: 100 } });
  await shot('4-chart');
  await page.evaluate(() => window.scrollTo(0, 99999));
  await shot('5-analysis');

  // 관심종목 / 설정 / 샘플
  await page.click('.tabbar [data-tab=watch]');
  await page.click('#btn-settings');
  await page.click('#st-sample');
  await page.click('.tabbar [data-tab=watch]');
  assert.ok(await page.locator('.item.watch').count() >= 1);
  await shot('6-watch');
  await page.click('.tabbar [data-tab=chart]');
  await shot('7-sample-chart');

  // 새로고침 후 유지
  await page.reload();
  st = await page.evaluate(() => window.StockNote.state);
  assert.equal(st.symbols.length, 2);

  // 모든 탭이 화면 폭 안에 들어오는지 (가로 넘침 시 아이폰에서 화면이 축소되고 탭바가 밀려남)
  for (const tab of ['portfolio', 'journal', 'calc', 'watch', 'chart']) {
    await page.click(`.tabbar [data-tab=${tab}]`);
    const w = await page.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth, visualViewport.width]);
    assert.ok(w[0] <= w[2] + 1 && w[1] <= w[2] + 1, `${tab} 탭 가로 넘침: ${w}`);
  }

  assert.deepEqual(errors, []);
  console.log('UI smoke test passed');
  await browser.close();
  server.close();
})().catch(e => { console.error(e); process.exit(1); });
