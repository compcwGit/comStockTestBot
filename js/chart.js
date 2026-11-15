/* 캔버스 차트: 가격(캔들/라인 + 이동평균 + 볼린저), 거래량, RSI, MACD */
(function (root) {
  'use strict';

  function fmtAxis(v) {
    const a = Math.abs(v);
    if (a >= 1000) return Math.round(v).toLocaleString('ko-KR');
    if (a >= 100) return v.toFixed(1);
    return v.toFixed(2);
  }

  function niceTicks(min, max, count) {
    const span = max - min;
    if (!(span > 0)) return [min];
    const raw = span / count;
    const mag = Math.pow(10, Math.floor(Math.log10(raw)));
    const norm = raw / mag;
    const st = (norm < 1.5 ? 1 : norm < 3 ? 2 : norm < 7 ? 5 : 10) * mag;
    const out = [];
    for (let v = Math.ceil(min / st) * st; v <= max + 1e-9; v += st) out.push(+v.toFixed(10));
    return out;
  }

  function withAlpha(color, a) {
    const m = color.match(/^#([0-9a-f]{6})$/i);
    if (!m) return color;
    const n = parseInt(m[1], 16);
    return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`;
  }

  function draw(cv, bars, A, opt) {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const W = cv.clientWidth, H = cv.clientHeight;
    cv.width = Math.round(W * dpr);
    cv.height = Math.round(H * dpr);
    const ctx = cv.getContext('2d');
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, W, H);

    const st = getComputedStyle(cv);
    const C = name => st.getPropertyValue(name).trim() || '#888888';
    const col = {
      fg: C('--fg'), muted: C('--muted'), grid: C('--grid'), up: C('--up'), down: C('--down'),
      ma5: C('--ma5'), ma20: C('--ma20'), ma60: C('--ma60'), bb: C('--bb'), accent: C('--accent'), card: C('--card'),
    };

    const n = bars.length;
    const range = opt.range > 0 ? opt.range : n;
    const start = Math.max(0, n - range);
    const cnt = n - start;
    const I = A.ind;
    const view = bars.slice(start);

    const padL = 4, padR = 58, padT = 4, padB = 16;
    const hasVol = view.some(b => b.v > 0);
    const hasOHLC = view.filter(b => b.o != null && b.h != null && b.l != null).length > cnt * 0.5;

    const panels = [{ k: 'price', w: 5 }];
    if (hasVol) panels.push({ k: 'vol', w: 1.1 });
    panels.push({ k: 'rsi', w: 1.5 }, { k: 'macd', w: 1.6 });
    const gap = 10;
    const avail = H - padT - padB - gap * (panels.length - 1);
    const tw = panels.reduce((a, p) => a + p.w, 0);
    let yy = padT;
    for (const p of panels) { p.top = yy; p.h = avail * p.w / tw; yy += p.h + gap; }
    const P = name => panels.find(p => p.k === name);

    const plotW = W - padL - padR;
    const step = plotW / cnt;
    const X = i => padL + (i - start + 0.5) * step;
    const bw = Math.max(1, Math.min(step * 0.7, 10));

    ctx.font = '10px -apple-system, BlinkMacSystemFont, sans-serif';
    ctx.textBaseline = 'middle';

    const line = (arr, color, yf, width = 1.2, dash = null) => {
      ctx.beginPath();
      let on = false;
      for (let i = start; i < n; i++) {
        const v = arr[i];
        if (v == null) { on = false; continue; }
        const x = X(i), y = yf(v);
        if (!on) { ctx.moveTo(x, y); on = true; } else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = color; ctx.lineWidth = width;
      ctx.setLineDash(dash || []);
      ctx.stroke();
      ctx.setLineDash([]);
    };

    const frame = (p, min, max, ticks, label) => {
      const yf = v => p.top + (max - v) / ((max - min) || 1) * p.h;
      ctx.lineWidth = 1;
      ctx.textAlign = 'left';
      for (const t of ticks) {
        const y = Math.round(yf(t)) + 0.5;
        ctx.strokeStyle = col.grid;
        ctx.beginPath(); ctx.moveTo(padL, y); ctx.lineTo(W - padR, y); ctx.stroke();
        ctx.fillStyle = col.muted;
        ctx.fillText(fmtAxis(t), W - padR + 4, y);
      }
      ctx.strokeStyle = col.grid;
      ctx.strokeRect(padL + 0.5, Math.round(p.top) + 0.5, plotW - 1, Math.round(p.h));
      if (label) {
        ctx.fillStyle = col.muted; ctx.textBaseline = 'top';
        ctx.fillText(label, padL + 4, p.top + 3);
        ctx.textBaseline = 'middle';
      }
      return yf;
    };

    // ── 가격 패널
    const pp = P('price');
    let lo = Infinity, hi = -Infinity;
    for (let i = start; i < n; i++) {
      const b = bars[i];
      lo = Math.min(lo, b.l != null ? b.l : b.c);
      hi = Math.max(hi, b.h != null ? b.h : b.c);
      for (const a of [I.ma5, I.ma20, I.ma60, I.bbU, I.bbL]) {
        if (a[i] != null) { lo = Math.min(lo, a[i]); hi = Math.max(hi, a[i]); }
      }
    }
    const pv = (hi - lo) * 0.06 || hi * 0.02 || 1;
    lo -= pv; hi += pv;
    const yP = frame(pp, lo, hi, niceTicks(lo, hi, 4), null);

    // 볼린저 밴드 영역
    let firstBB = -1;
    for (let i = start; i < n; i++) if (I.bbU[i] != null) { firstBB = i; break; }
    if (firstBB >= 0) {
      ctx.beginPath();
      for (let i = firstBB; i < n; i++) (i === firstBB ? ctx.moveTo : ctx.lineTo).call(ctx, X(i), yP(I.bbU[i]));
      for (let i = n - 1; i >= firstBB; i--) ctx.lineTo(X(i), yP(I.bbL[i]));
      ctx.closePath();
      ctx.fillStyle = withAlpha(col.bb, 0.12);
      ctx.fill();
      line(I.bbU, withAlpha(col.bb, 0.7), yP, 1, [3, 3]);
      line(I.bbL, withAlpha(col.bb, 0.7), yP, 1, [3, 3]);
    }

    if (hasOHLC) {
      for (let i = start; i < n; i++) {
        const b = bars[i];
        const o = b.o != null ? b.o : b.c, h = b.h != null ? b.h : Math.max(o, b.c), l = b.l != null ? b.l : Math.min(o, b.c);
        const color = b.c >= o ? col.up : col.down;
        const x = X(i);
        ctx.strokeStyle = color; ctx.lineWidth = 1;
        ctx.beginPath(); ctx.moveTo(x, yP(h)); ctx.lineTo(x, yP(l)); ctx.stroke();
        const y1 = yP(Math.max(o, b.c)), y2 = yP(Math.min(o, b.c));
        ctx.fillStyle = color;
        ctx.fillRect(x - bw / 2, y1, bw, Math.max(1, y2 - y1));
      }
    } else {
      line(bars.map(b => b.c), col.fg, yP, 1.6);
    }
    line(I.ma5, col.ma5, yP, 1.2);
    line(I.ma20, col.ma20, yP, 1.4);
    line(I.ma60, col.ma60, yP, 1.4);

    // 골든/데드크로스 표시
    for (const s of A.signals) {
      if (s.type !== 'ma' || s.i < start) continue;
      const b = bars[s.i], x = X(s.i);
      ctx.fillStyle = s.dir > 0 ? col.up : col.down;
      ctx.beginPath();
      if (s.dir > 0) {
        const y = yP(b.l != null ? b.l : b.c) + 6;
        ctx.moveTo(x, y); ctx.lineTo(x - 5, y + 8); ctx.lineTo(x + 5, y + 8);
      } else {
        const y = yP(b.h != null ? b.h : b.c) - 6;
        ctx.moveTo(x, y); ctx.lineTo(x - 5, y - 8); ctx.lineTo(x + 5, y - 8);
      }
      ctx.closePath(); ctx.fill();
    }

    // 마지막 가격 라벨
    const last = bars[n - 1].c, ly = yP(last);
    ctx.setLineDash([2, 3]); ctx.strokeStyle = col.accent; ctx.lineWidth = 1;
    ctx.beginPath(); ctx.moveTo(padL, ly); ctx.lineTo(W - padR, ly); ctx.stroke(); ctx.setLineDash([]);
    ctx.fillStyle = col.accent;
    ctx.fillRect(W - padR + 1, ly - 8, padR - 2, 16);
    ctx.fillStyle = '#ffffff'; ctx.textAlign = 'left';
    ctx.fillText(fmtAxis(last), W - padR + 4, ly);

    // ── 거래량
    if (hasVol) {
      const vp = P('vol');
      let vmax = 0;
      for (let i = start; i < n; i++) vmax = Math.max(vmax, bars[i].v || 0);
      const yV = frame(vp, 0, vmax || 1, [], '거래량');
      for (let i = start; i < n; i++) {
        const b = bars[i];
        if (!(b.v > 0)) continue;
        const prevC = i > 0 ? bars[i - 1].c : b.c;
        const up = b.o != null ? b.c >= b.o : b.c >= prevC;
        ctx.fillStyle = withAlpha(up ? col.up : col.down, 0.55);
        const y = yV(b.v);
        ctx.fillRect(X(i) - bw / 2, y, bw, vp.top + vp.h - y);
      }
    }

    // ── RSI
    const rp = P('rsi');
    const yR = frame(rp, 0, 100, [30, 70], 'RSI(14)');
    ctx.fillStyle = withAlpha(col.accent, 0.06);
    ctx.fillRect(padL, yR(70), plotW, yR(30) - yR(70));
    line(I.rsi, col.accent, yR, 1.4);

    // ── MACD
    const mp = P('macd');
    let mlo = 0, mhi = 0;
    for (let i = start; i < n; i++) for (const a of [I.macd, I.macdSig, I.macdHist]) {
      if (a[i] != null) { mlo = Math.min(mlo, a[i]); mhi = Math.max(mhi, a[i]); }
    }
    const mpad = (mhi - mlo) * 0.08 || 1;
    const yM = frame(mp, mlo - mpad, mhi + mpad, [0], 'MACD(12,26,9)');
    for (let i = start; i < n; i++) {
      const h = I.macdHist[i];
      if (h == null) continue;
      ctx.fillStyle = withAlpha(h >= 0 ? col.up : col.down, 0.5);
      const y0 = yM(0), y1 = yM(h);
      ctx.fillRect(X(i) - bw / 2, Math.min(y0, y1), bw, Math.max(1, Math.abs(y1 - y0)));
    }
    line(I.macd, col.accent, yM, 1.3);
    line(I.macdSig, col.ma5, yM, 1.3);

    // ── 날짜 라벨
    ctx.fillStyle = col.muted; ctx.textBaseline = 'bottom';
    const labelsN = Math.max(2, Math.min(cnt, Math.floor(plotW / 78)));
    for (let k = 0; k < labelsN; k++) {
      const i = start + Math.round(k * (cnt - 1) / (labelsN - 1 || 1));
      ctx.textAlign = k === 0 ? 'left' : k === labelsN - 1 ? 'right' : 'center';
      const x = k === 0 ? padL : k === labelsN - 1 ? W - padR : X(i);
      ctx.fillText(bars[i].d.slice(2).replace(/-/g, '.'), x, H);
    }

    // ── 커서
    if (opt.cursor != null && opt.cursor >= start && opt.cursor < n) {
      const x = X(opt.cursor);
      ctx.strokeStyle = col.fg; ctx.globalAlpha = 0.45; ctx.lineWidth = 1; ctx.setLineDash([3, 3]);
      ctx.beginPath(); ctx.moveTo(x, padT); ctx.lineTo(x, H - padB); ctx.stroke();
      const cy = yP(bars[opt.cursor].c);
      ctx.beginPath(); ctx.moveTo(padL, cy); ctx.lineTo(W - padR, cy); ctx.stroke();
      ctx.setLineDash([]); ctx.globalAlpha = 1;
    }

    return {
      start,
      indexAt: px => Math.max(start, Math.min(n - 1, start + Math.floor((px - padL) / step))),
    };
  }

  root.StockChart = { draw };
})(window);
