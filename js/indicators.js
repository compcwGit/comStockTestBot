/* 기술적 지표 계산 & 분석 (브라우저/Node 공용) */
(function (root) {
  'use strict';

  function sma(v, n) {
    const out = new Array(v.length).fill(null);
    let sum = 0;
    for (let i = 0; i < v.length; i++) {
      sum += v[i];
      if (i >= n) sum -= v[i - n];
      if (i >= n - 1) out[i] = sum / n;
    }
    return out;
  }

  // 앞부분 null 허용. 첫 n개 값의 단순평균으로 시작.
  function ema(v, n) {
    const out = new Array(v.length).fill(null);
    const k = 2 / (n + 1);
    let prev = null, cnt = 0, sum = 0;
    for (let i = 0; i < v.length; i++) {
      const x = v[i];
      if (x == null) continue;
      if (prev == null) {
        sum += x; cnt++;
        if (cnt === n) { prev = sum / n; out[i] = prev; }
      } else {
        prev = x * k + prev * (1 - k);
        out[i] = prev;
      }
    }
    return out;
  }

  function bollinger(v, n = 20, m = 2) {
    const mid = sma(v, n);
    const up = new Array(v.length).fill(null);
    const lo = new Array(v.length).fill(null);
    for (let i = n - 1; i < v.length; i++) {
      let s = 0;
      for (let j = i - n + 1; j <= i; j++) s += (v[j] - mid[i]) ** 2;
      const sd = Math.sqrt(s / n);
      up[i] = mid[i] + m * sd;
      lo[i] = mid[i] - m * sd;
    }
    return { mid, up, lo };
  }

  // Wilder RSI
  function rsi(v, n = 14) {
    const out = new Array(v.length).fill(null);
    if (v.length <= n) return out;
    let g = 0, l = 0;
    for (let i = 1; i <= n; i++) {
      const d = v[i] - v[i - 1];
      if (d > 0) g += d; else l -= d;
    }
    g /= n; l /= n;
    const val = () => (l === 0 ? (g === 0 ? 50 : 100) : 100 - 100 / (1 + g / l));
    out[n] = val();
    for (let i = n + 1; i < v.length; i++) {
      const d = v[i] - v[i - 1];
      g = (g * (n - 1) + Math.max(d, 0)) / n;
      l = (l * (n - 1) + Math.max(-d, 0)) / n;
      out[i] = val();
    }
    return out;
  }

  function macd(v, f = 12, s = 26, sig = 9) {
    const ef = ema(v, f), es = ema(v, s);
    const line = v.map((_, i) => (ef[i] != null && es[i] != null ? ef[i] - es[i] : null));
    const signal = ema(line, sig);
    const hist = line.map((x, i) => (x != null && signal[i] != null ? x - signal[i] : null));
    return { line, signal, hist };
  }

  // a가 b를 상향(1)/하향(-1) 돌파한 지점
  function crosses(a, b) {
    const out = [];
    for (let i = 1; i < a.length; i++) {
      if (a[i] == null || b[i] == null || a[i - 1] == null || b[i - 1] == null) continue;
      const p = a[i - 1] - b[i - 1], c = a[i] - b[i];
      if (p <= 0 && c > 0) out.push({ i, dir: 1 });
      else if (p >= 0 && c < 0) out.push({ i, dir: -1 });
    }
    return out;
  }

  function levelCross(a, level) {
    return crosses(a, a.map(x => (x == null ? null : level)));
  }

  function analyze(bars) {
    const c = bars.map(b => b.c);
    const n = c.length - 1;
    const ma5 = sma(c, 5), ma20 = sma(c, 20), ma60 = sma(c, 60);
    const bb = bollinger(c, 20, 2);
    const r = rsi(c, 14);
    const m = macd(c);
    const ind = { ma5, ma20, ma60, bbU: bb.up, bbM: bb.mid, bbL: bb.lo, rsi: r, macd: m.line, macdSig: m.signal, macdHist: m.hist };

    const signals = [];
    const push = (i, type, dir, text) => signals.push({ i, date: bars[i].d, type, dir, text });
    crosses(ma5, ma20).forEach(x => push(x.i, 'ma', x.dir, x.dir > 0 ? '단기 골든크로스 (5일선 ↑ 20일선)' : '단기 데드크로스 (5일선 ↓ 20일선)'));
    crosses(ma20, ma60).forEach(x => push(x.i, 'ma', x.dir, x.dir > 0 ? '중기 골든크로스 (20일선 ↑ 60일선)' : '중기 데드크로스 (20일선 ↓ 60일선)'));
    crosses(m.line, m.signal).forEach(x => push(x.i, 'macd', x.dir, x.dir > 0 ? 'MACD 매수 신호 (시그널선 상향 돌파)' : 'MACD 매도 신호 (시그널선 하향 돌파)'));
    levelCross(r, 30).forEach(x => x.dir > 0
      ? push(x.i, 'rsi', 1, 'RSI 과매도 탈출 (30 상향 돌파)')
      : push(x.i, 'rsi', 0, 'RSI 과매도 진입 (30 하향)'));
    levelCross(r, 70).forEach(x => x.dir < 0
      ? push(x.i, 'rsi', -1, 'RSI 과매수 이탈 (70 하향 돌파)')
      : push(x.i, 'rsi', 0, 'RSI 과매수 진입 (70 상향)'));
    for (let i = 1; i <= n; i++) {
      if (bb.lo[i] == null || bb.lo[i - 1] == null) continue;
      if (c[i] < bb.lo[i] && c[i - 1] >= bb.lo[i - 1]) push(i, 'bb', 0, '볼린저밴드 하단 이탈 (과매도 구간)');
      if (c[i] > bb.up[i] && c[i - 1] <= bb.up[i - 1]) push(i, 'bb', 0, '볼린저밴드 상단 돌파 (과열 또는 강한 추세)');
    }
    signals.sort((a, b) => b.i - a.i);

    const L = {
      close: c[n], prev: n > 0 ? c[n - 1] : null,
      ma5: ma5[n], ma20: ma20[n], ma60: ma60[n],
      rsi: r[n], macd: m.line[n], signal: m.signal[n], hist: m.hist[n],
      bbU: bb.up[n], bbM: bb.mid[n], bbL: bb.lo[n],
    };
    L.change = L.prev ? (L.close / L.prev - 1) * 100 : null;

    // 점수화
    const items = [];
    if (L.ma5 != null && L.ma20 != null) {
      if (L.ma60 != null) {
        if (L.ma5 > L.ma20 && L.ma20 > L.ma60) items.push({ label: '이동평균 배열', value: '정배열 (5 > 20 > 60)', pts: 2 });
        else if (L.ma5 < L.ma20 && L.ma20 < L.ma60) items.push({ label: '이동평균 배열', value: '역배열 (5 < 20 < 60)', pts: -2 });
        else items.push({ label: '이동평균 배열', value: '혼조', pts: 0 });
      } else {
        items.push({ label: '단기 추세', value: L.ma5 > L.ma20 ? '5일선 > 20일선' : '5일선 < 20일선', pts: L.ma5 > L.ma20 ? 1 : -1 });
      }
      items.push({ label: '종가 vs 20일선', value: L.close >= L.ma20 ? '20일선 위' : '20일선 아래', pts: L.close >= L.ma20 ? 1 : -1 });
    }
    if (L.macd != null && L.signal != null) {
      items.push({ label: 'MACD', value: L.macd > L.signal ? '시그널선 위 (상승 모멘텀)' : '시그널선 아래 (하락 모멘텀)', pts: L.macd > L.signal ? 1 : -1 });
    }
    if (L.rsi != null) {
      const v = L.rsi.toFixed(1);
      if (L.rsi < 30) items.push({ label: 'RSI', value: `${v} 과매도 (반등 가능성)`, pts: 1 });
      else if (L.rsi > 70) items.push({ label: 'RSI', value: `${v} 과매수 (조정 가능성)`, pts: -1 });
      else if (L.rsi >= 50) items.push({ label: 'RSI', value: `${v} 강세 구간`, pts: 1 });
      else items.push({ label: 'RSI', value: `${v} 약세 구간`, pts: 0 });
    }
    if (L.bbU != null) {
      const pb = (L.close - L.bbL) / ((L.bbU - L.bbL) || 1);
      L.percentB = pb;
      if (pb < 0) items.push({ label: '볼린저밴드', value: '하단 이탈', pts: 1 });
      else if (pb > 1) items.push({ label: '볼린저밴드', value: '상단 돌파 (과열)', pts: -1 });
      else items.push({ label: '볼린저밴드', value: `밴드 내 ${(pb * 100).toFixed(0)}% 위치`, pts: 0 });
    }
    const score = items.reduce((a, x) => a + x.pts, 0);
    const verdict = score >= 3 ? '매수 우위' : score >= 1 ? '약한 매수 우위' : score === 0 ? '중립' : score >= -2 ? '약한 매도 우위' : '매도 우위';

    // 지지/저항
    const lowOf = b => (b.l != null ? b.l : b.c);
    const highOf = b => (b.h != null ? b.h : b.c);
    const win = k => bars.slice(Math.max(0, bars.length - k));
    const w20 = win(20), w60 = win(60);
    const levels = {
      support20: Math.min(...w20.map(lowOf)),
      resist20: Math.max(...w20.map(highOf)),
      support60: Math.min(...w60.map(lowOf)),
      resist60: Math.max(...w60.map(highOf)),
    };
    levels.stop = levels.support20 * 0.97;

    return { ind, signals, latest: L, items, score, verdict, levels };
  }

  const api = { sma, ema, bollinger, rsi, macd, crosses, analyze };
  root.Ind = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
