const test = require('node:test');
const assert = require('node:assert/strict');
const Ind = require('../js/indicators.js');

const close = (a, b, eps = 1e-6) => assert.ok(Math.abs(a - b) < eps, `${a} != ${b}`);

test('sma', () => {
  const r = Ind.sma([1, 2, 3, 4, 5], 3);
  assert.deepEqual(r.slice(0, 2), [null, null]);
  close(r[2], 2); close(r[3], 3); close(r[4], 4);
});

test('ema seeds with sma then smooths', () => {
  const r = Ind.ema([1, 2, 3, 4], 3);
  close(r[2], 2);
  close(r[3], 4 * 0.5 + 2 * 0.5);
});

test('rsi: all gains = 100, all losses = 0, flat = 50', () => {
  const up = Array.from({ length: 20 }, (_, i) => i + 1);
  assert.equal(Ind.rsi(up)[19], 100);
  assert.equal(Ind.rsi(up.slice().reverse())[19], 0);
  assert.equal(Ind.rsi(new Array(20).fill(5))[19], 50);
});

test('rsi matches reference value (Wilder)', () => {
  // 고전 예제 (Wilder/StockCharts) 첫 RSI ≈ 70.53 (평균을 반올림한 값, 정밀 계산 시 70.46)
  const c = [44.34, 44.09, 44.15, 43.61, 44.33, 44.83, 45.10, 45.42, 45.84, 46.08, 45.89, 46.03, 45.61, 46.28, 46.28];
  close(Ind.rsi(c)[14], 70.46, 0.01);
});

test('bollinger width is zero on flat series', () => {
  const b = Ind.bollinger(new Array(25).fill(10));
  close(b.up[24], 10); close(b.lo[24], 10);
});

test('crosses detects up and down', () => {
  const x = Ind.crosses([1, 2, 3, 2, 1], [2, 2, 2, 2, 2]);
  assert.deepEqual(x, [{ i: 2, dir: 1 }, { i: 4, dir: -1 }]);
});

test('analyze returns verdict, levels and signals', () => {
  const bars = [];
  for (let i = 0; i < 120; i++) {
    const c = 100 + i * 0.5 + Math.sin(i / 4) * 3;
    bars.push({ d: `2026-01-${String(i).padStart(3, '0')}`, o: c - 0.5, h: c + 1, l: c - 1, c, v: 1000 });
  }
  const A = Ind.analyze(bars);
  assert.ok(A.score > 0, 'uptrend should score positive');
  assert.ok(A.levels.support20 < A.levels.resist20);
  assert.ok(A.signals.length > 0);
  assert.ok(['매수 우위', '약한 매수 우위'].includes(A.verdict));
});

test('all app scripts parse (syntax check)', () => {
  const fs = require('node:fs'), path = require('node:path'), vm = require('node:vm');
  for (const f of ['indicators.js', 'chart.js', 'app.js']) {
    const src = fs.readFileSync(path.join(__dirname, '..', 'js', f), 'utf8');
    assert.doesNotThrow(() => new vm.Script(src, { filename: f }), f);
  }
  new vm.Script(fs.readFileSync(path.join(__dirname, '..', 'sw.js'), 'utf8'));
});
