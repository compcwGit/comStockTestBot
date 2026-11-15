/* 주식노트 - 서버 없이 기기에만 저장되는 주식 보조 앱 */
(function () {
  'use strict';

  const KEY = 'stocknote.v1';
  const $ = (s, r = document) => r.querySelector(s);
  const $$ = (s, r = document) => Array.from(r.querySelectorAll(s));
  const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const uid = () => Date.now().toString(36) + Math.random().toString(36).slice(2, 8);
  const today = () => { const d = new Date(); d.setMinutes(d.getMinutes() - d.getTimezoneOffset()); return d.toISOString().slice(0, 10); };
  const num = v => {
    if (v == null) return NaN;
    const s = String(v).replace(/[,\s원$]/g, '');
    if (s === '' || s === '-') return NaN;
    const x = Number(s);
    return Number.isFinite(x) ? x : NaN;
  };
  const posOrNull = x => { const n = Number(x); return x != null && x !== '' && Number.isFinite(n) && n > 0 ? n : null; };

  function parseDate(s) {
    if (!s) return null;
    s = String(s).trim();
    let m = s.match(/^(\d{4})[-./\s]+(\d{1,2})[-./\s]+(\d{1,2})/);
    if (!m) m = s.match(/^(\d{4})(\d{2})(\d{2})$/);
    if (!m) return null;
    const y = +m[1], mo = +m[2], d = +m[3];
    if (mo < 1 || mo > 12 || d < 1 || d > 31) return null;
    return `${y}-${String(mo).padStart(2, '0')}-${String(d).padStart(2, '0')}`;
  }

  const TABS = { portfolio: '보유 종목', journal: '매매일지', calc: '계산기', watch: '관심종목', chart: '차트 분석' };

  // ───────────────────────── 상태 ─────────────────────────
  function defaults() {
    return {
      version: 1,
      symbols: [],
      trades: [],
      settings: { buyFee: 0.015, sellFee: 0.015, sellTax: 0.20 },
      ui: { tab: 'portfolio', chartSymbol: null, chartRange: 120, journalFilter: '' },
    };
  }

  function normalize(s) {
    const d = defaults();
    if (!s || typeof s !== 'object') return d;
    const str = (x, max = 500) => String(x == null ? '' : x).slice(0, max);
    d.symbols = (Array.isArray(s.symbols) ? s.symbols : []).filter(x => x && x.id).map(x => ({
      id: str(x.id, 40),
      name: str(x.name, 60) || '이름 없음',
      code: str(x.code, 20),
      currency: x.currency === 'USD' ? 'USD' : 'KRW',
      price: posOrNull(x.price),
      priceDate: parseDate(x.priceDate) || '',
      target: posOrNull(x.target),
      stop: posOrNull(x.stop),
      memo: str(x.memo, 2000),
      watch: !!x.watch,
      history: (Array.isArray(x.history) ? x.history : []).map(b => b && ({
        d: parseDate(b.d), o: posOrNull(b.o), h: posOrNull(b.h), l: posOrNull(b.l), c: posOrNull(b.c),
        v: b.v != null && Number.isFinite(+b.v) && +b.v >= 0 ? +b.v : null,
      })).filter(b => b && b.d && b.c).sort((a, b) => a.d.localeCompare(b.d)),
    }));
    const ids = new Set(d.symbols.map(x => x.id));
    d.trades = (Array.isArray(s.trades) ? s.trades : []).filter(t => t && t.id && ids.has(String(t.symbolId))).map(t => ({
      id: str(t.id, 40),
      symbolId: String(t.symbolId),
      type: t.type === 'sell' ? 'sell' : 'buy',
      date: parseDate(t.date) || today(),
      qty: posOrNull(t.qty) || 0,
      price: posOrNull(t.price) || 0,
      fee: Number.isFinite(+t.fee) && +t.fee >= 0 ? +t.fee : 0,
      memo: str(t.memo, 2000),
      created: Number.isFinite(+t.created) ? +t.created : 0,
    })).filter(t => t.qty > 0 && t.price > 0);
    const st = s.settings || {};
    for (const k of Object.keys(d.settings)) if (Number.isFinite(+st[k]) && +st[k] >= 0) d.settings[k] = +st[k];
    if (s.ui && typeof s.ui === 'object') {
      if (TABS[s.ui.tab]) d.ui.tab = s.ui.tab;
      if (typeof s.ui.chartSymbol === 'string') d.ui.chartSymbol = s.ui.chartSymbol;
      if (Number.isFinite(+s.ui.chartRange)) d.ui.chartRange = +s.ui.chartRange;
      if (typeof s.ui.journalFilter === 'string') d.ui.journalFilter = s.ui.journalFilter;
    }
    return d;
  }

  function load() {
    try { const raw = localStorage.getItem(KEY); if (raw) return normalize(JSON.parse(raw)); } catch (e) { /* 무시 */ }
    return defaults();
  }
  function save() {
    try { localStorage.setItem(KEY, JSON.stringify(S)); }
    catch (e) { toast('저장 실패: 기기 저장공간을 확인하세요'); }
  }

  let S = load();
  const sym = id => S.symbols.find(s => s.id === id);

  // ───────────────────────── 포맷 ─────────────────────────
  function fmtMoney(v, cur) {
    if (!Number.isFinite(v)) return '-';
    if (cur === 'USD') return (v < 0 ? '-$' : '$') + Math.abs(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return Math.round(v).toLocaleString('ko-KR') + '원';
  }
  function fmtSigned(v, cur) { return Number.isFinite(v) ? (v > 0 ? '+' : '') + fmtMoney(v, cur) : '-'; }
  function fmtPrice(v, cur) {
    if (!Number.isFinite(v)) return '-';
    if (cur === 'USD') return v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
    return v.toLocaleString('ko-KR', { maximumFractionDigits: Math.abs(v) < 1000 ? 2 : 0 });
  }
  const fmtPct = v => (Number.isFinite(v) ? (v > 0 ? '+' : '') + v.toFixed(2) + '%' : '-');
  const fmtQty = v => (Number.isFinite(v) ? v.toLocaleString('ko-KR', { maximumFractionDigits: 6 }) : '-');
  const cls = v => (v > 0 ? 'up' : v < 0 ? 'down' : '');
  const curLabel = c => (c === 'USD' ? '해외 (USD)' : '국내 (KRW)');

  // ───────────────────────── 계산 ─────────────────────────
  function feeFor(type, amount, cur) {
    const s = S.settings;
    const pct = type === 'buy' ? s.buyFee : s.sellFee + (cur === 'KRW' ? s.sellTax : 0);
    return amount * pct / 100;
  }

  // 이동평균법으로 보유수량/평단/실현손익 계산
  function computeBook(excludeId) {
    const pos = new Map(), realized = new Map();
    const ts = S.trades.filter(t => t.id !== excludeId)
      .sort((a, b) => a.date.localeCompare(b.date) || (a.created || 0) - (b.created || 0));
    for (const t of ts) {
      let p = pos.get(t.symbolId);
      if (!p) { p = { qty: 0, cost: 0, realized: 0, sells: 0, wins: 0 }; pos.set(t.symbolId, p); }
      if (t.type === 'buy') {
        p.qty += t.qty;
        p.cost += t.qty * t.price + (t.fee || 0);
      } else {
        const avg = p.qty > 0 ? p.cost / p.qty : 0;
        const q = Math.min(t.qty, p.qty);
        const ratio = t.qty > 0 ? q / t.qty : 0;
        const r = (t.price * q - (t.fee || 0) * ratio) - avg * q;
        realized.set(t.id, { r, pct: avg > 0 && q > 0 ? r / (avg * q) * 100 : 0, over: t.qty > p.qty + 1e-9, avg });
        p.realized += r; p.sells++; if (r > 0) p.wins++;
        p.cost -= avg * q; p.qty -= q;
        if (p.qty < 1e-9) { p.qty = 0; p.cost = 0; }
      }
    }
    return { pos, realized };
  }

  function upsertBars(s, bars) {
    const map = new Map(s.history.map(b => [b.d, b]));
    for (const nb of bars) {
      const ex = map.get(nb.d);
      if (ex && nb.o == null && ex.o != null) {
        ex.c = nb.c; ex.h = Math.max(ex.h || nb.c, nb.c); ex.l = Math.min(ex.l || nb.c, nb.c);
        if (nb.v != null) ex.v = nb.v;
      } else {
        map.set(nb.d, { d: nb.d, o: nb.o ?? null, h: nb.h ?? null, l: nb.l ?? null, c: nb.c, v: nb.v ?? null });
      }
    }
    s.history = Array.from(map.values()).sort((a, b) => a.d.localeCompare(b.d));
    const last = s.history[s.history.length - 1];
    if (last && (!s.priceDate || last.d >= s.priceDate)) { s.price = last.c; s.priceDate = last.d; }
  }

  // ───────────────────────── UI 공통 ─────────────────────────
  let toastTimer;
  function toast(msg) {
    const t = $('#toast');
    t.textContent = msg; t.classList.add('show');
    clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('show'), 2200);
  }

  // 앱 내 확인창 (브라우저 confirm 대체)
  function ask(message, okLabel) {
    return new Promise(resolve => {
      const root = $('#dialog-root');
      const danger = /삭제|초과/.test(message);
      root.innerHTML = `<div class="backdrop"></div>
        <div class="dialog" role="alertdialog" aria-modal="true">
          <p>${esc(message)}</p>
          <div class="dialog-btns">
            <button class="btn" data-r="0">취소</button>
            <button class="btn ${danger ? 'danger-fill' : 'primary'}" data-r="1">${esc(okLabel || (danger ? '삭제' : '확인'))}</button>
          </div></div>`;
      root.classList.add('open');
      const done = v => { root.classList.remove('open'); root.innerHTML = ''; resolve(v); };
      root.querySelector('.backdrop').addEventListener('click', () => done(false));
      $$('[data-r]', root).forEach(b => b.addEventListener('click', () => done(b.dataset.r === '1')));
      root.querySelector('[data-r="1"]').focus();
    });
  }

  function openSheet(title, body, mount) {
    const root = $('#sheet-root');
    root.innerHTML = `<div class="backdrop" data-close></div>
      <div class="sheet" role="dialog" aria-modal="true" aria-label="${esc(title)}">
        <div class="sheet-head"><h2>${esc(title)}</h2><button class="icon-btn" data-close aria-label="닫기">✕</button></div>
        <div class="sheet-body">${body}</div>
      </div>`;
    root.classList.add('open');
    document.body.classList.add('noscroll');
    $$('[data-close]', root).forEach(el => el.addEventListener('click', closeSheet));
    if (mount) mount($('.sheet-body', root));
  }
  function closeSheet() {
    const root = $('#sheet-root');
    root.classList.remove('open'); root.innerHTML = '';
    document.body.classList.remove('noscroll');
  }

  function go(tab) {
    S.ui.tab = tab; save(); render();
    window.scrollTo(0, 0);
  }

  const numInput = (name, label, value, extra = '') =>
    `<label>${label}<input name="${name}" inputmode="decimal" autocomplete="off" value="${value == null || value === '' ? '' : esc(value)}" ${extra}></label>`;

  // ───────────────────────── 보유 종목 ─────────────────────────
  function viewPortfolio() {
    const { pos } = computeBook();
    const groups = {};
    for (const s of S.symbols) {
      const p = pos.get(s.id);
      if (!p) continue;
      const g = groups[s.currency] || (groups[s.currency] = { cost: 0, value: 0, realized: 0, rows: [], unpriced: 0 });
      g.realized += p.realized;
      if (p.qty > 0) {
        const avg = p.cost / p.qty;
        const has = s.price > 0;
        const value = has ? s.price * p.qty : p.cost;
        if (!has) g.unpriced++;
        g.cost += p.cost; g.value += value;
        g.rows.push({ s, p, avg, has, value, pl: value - p.cost, pct: p.cost > 0 ? (value / p.cost - 1) * 100 : 0 });
      }
    }

    let h = `<div class="actions-row">
      <button class="btn primary" data-action="new-trade" data-type="buy">+ 매수 기록</button>
      <button class="btn" data-action="new-trade" data-type="sell">매도 기록</button></div>`;

    const any = Object.values(groups).some(g => g.rows.length);
    if (!any) {
      h += `<section class="card empty">
        <div class="empty-ico">📈</div>
        <h3>아직 보유 종목이 없어요</h3>
        <p>매수 기록을 추가하면 평균단가, 평가손익, 수익률이 자동으로 계산돼요.</p>
        <button class="btn primary" data-action="new-trade" data-type="buy">첫 매수 기록하기</button>
        <button class="btn ghost" data-action="sample">샘플 데이터로 둘러보기</button>
      </section>`;
    }

    for (const cur of ['KRW', 'USD']) {
      const g = groups[cur];
      if (!g || (!g.rows.length && !g.realized)) continue;
      const pl = g.value - g.cost, pct = g.cost > 0 ? pl / g.cost * 100 : 0;
      h += `<section class="card summary">
        <div class="label">${curLabel(cur)} 총 평가금액</div>
        <div class="big">${fmtMoney(g.value, cur)}</div>
        <div class="strong ${cls(pl)}">${fmtSigned(pl, cur)} (${fmtPct(pct)})</div>
        <div class="grid3">
          <div><span>매입금액</span><b>${fmtMoney(g.cost, cur)}</b></div>
          <div><span>평가손익</span><b class="${cls(pl)}">${fmtSigned(pl, cur)}</b></div>
          <div><span>실현손익</span><b class="${cls(g.realized)}">${fmtSigned(g.realized, cur)}</b></div>
        </div>
        ${g.unpriced ? `<p class="hint">현재가를 입력하지 않은 ${g.unpriced}종목은 매입가 기준으로 계산했어요.</p>` : ''}
      </section>`;
      if (!g.rows.length) continue;
      g.rows.sort((a, b) => b.value - a.value);
      h += `<section class="card list">` + g.rows.map(r => {
        const w = g.value > 0 ? r.value / g.value * 100 : 0;
        return `<button class="item" data-action="symbol" data-id="${esc(r.s.id)}">
          <div class="item-main">
            <div class="name">${esc(r.s.name)} ${r.s.code ? `<span class="code">${esc(r.s.code)}</span>` : ''}</div>
            <div class="sub">${fmtQty(r.p.qty)}주 · 평단 ${fmtPrice(r.avg, cur)} · 현재 ${r.has ? fmtPrice(r.s.price, cur) : '<em>미입력</em>'}</div>
          </div>
          <div class="item-side">
            <div class="val">${fmtMoney(r.value, cur)}</div>
            <div class="sub ${cls(r.pl)}">${fmtSigned(r.pl, cur)} (${fmtPct(r.pct)})</div>
          </div>
          <div class="weight" title="비중 ${w.toFixed(1)}%"><i style="width:${w.toFixed(1)}%"></i><span>${w.toFixed(1)}%</span></div>
        </button>`;
      }).join('') + `</section>`;
    }
    return h;
  }

  function openSymbolSheet(id) {
    const s = sym(id);
    if (!s) return;
    const { pos } = computeBook();
    const p = pos.get(id);
    const cur = s.currency;
    let h = '<div class="kv-list">';
    if (p && p.qty > 0) {
      const avg = p.cost / p.qty;
      h += kv('보유수량', fmtQty(p.qty) + '주') + kv('평균단가', fmtPrice(avg, cur)) + kv('매입금액', fmtMoney(p.cost, cur));
      if (s.price > 0) {
        const val = s.price * p.qty, pl = val - p.cost;
        h += kv('평가금액', fmtMoney(val, cur)) + kv('평가손익', `<span class="${cls(pl)}">${fmtSigned(pl, cur)} (${fmtPct(pl / p.cost * 100)})</span>`);
      }
    }
    h += kv('현재가', s.price > 0 ? `${fmtPrice(s.price, cur)} <small>${esc(s.priceDate || '')}</small>` : '미입력');
    if (s.target) h += kv('목표가', `${fmtPrice(s.target, cur)}${s.price ? ` <small class="${cls(s.target - s.price)}">${fmtPct((s.target / s.price - 1) * 100)}</small>` : ''}`);
    if (s.stop) h += kv('손절가', `${fmtPrice(s.stop, cur)}${s.price ? ` <small class="${cls(s.stop - s.price)}">${fmtPct((s.stop / s.price - 1) * 100)}</small>` : ''}`);
    if (p && p.sells) h += kv('실현손익', `<span class="${cls(p.realized)}">${fmtSigned(p.realized, cur)}</span>`);
    h += '</div>';
    if (s.memo) h += `<p class="memo">${esc(s.memo)}</p>`;
    h += `<div class="btn-grid">
      <button class="btn primary" data-sa="price">현재가 입력</button>
      <button class="btn" data-sa="buy">매수 기록</button>
      <button class="btn" data-sa="sell">매도 기록</button>
      <button class="btn" data-sa="calc">물타기 계산</button>
      <button class="btn" data-sa="chart">차트 분석</button>
      <button class="btn" data-sa="edit">종목 정보 수정</button>
    </div>`;
    openSheet(s.name + (s.code ? ` (${s.code})` : ''), h, el => {
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-sa]');
        if (!b) return;
        const a = b.dataset.sa;
        if (a === 'price') openPriceSheet(id);
        else if (a === 'buy' || a === 'sell') openTradeForm({ type: a, symbolId: id });
        else if (a === 'calc') { closeSheet(); prefillCalc(id); go('calc'); }
        else if (a === 'chart') { S.ui.chartSymbol = id; closeSheet(); go('chart'); }
        else if (a === 'edit') openSymbolForm(id);
      });
    });
  }
  const kv = (k, v) => `<div class="kv"><span>${k}</span><b>${v}</b></div>`;

  function openPriceSheet(id) {
    const s = sym(id);
    openSheet(`${s.name} 현재가`, `<form class="form" id="pf">
      ${numInput('price', `현재가 (${s.currency === 'USD' ? '달러' : '원'})`, s.price || '', 'required')}
      <label class="check"><input type="checkbox" name="hist" ${s.history.length ? 'checked' : ''}> 차트 데이터에 종가로도 기록</label>
      <label>날짜<input type="date" name="date" value="${today()}"></label>
      <button class="btn primary block">저장</button>
    </form>`, el => {
      const f = $('#pf', el);
      f.addEventListener('submit', e => {
        e.preventDefault();
        const v = num(f.price.value);
        if (!(v > 0)) return toast('가격을 확인해 주세요');
        const d = parseDate(f.date.value) || today();
        if (f.hist.checked) upsertBars(s, [{ d, c: v }]);
        if (!f.hist.checked || d >= (s.priceDate || '')) { s.price = v; s.priceDate = d; }
        save(); closeSheet(); render(); toast('현재가를 저장했어요');
      });
    });
  }

  function openSymbolForm(id, preset = {}) {
    const s = id ? sym(id) : null;
    const v = s || { name: '', code: '', currency: 'KRW', price: null, target: null, stop: null, memo: '', watch: !!preset.watch };
    openSheet(s ? '종목 정보 수정' : '종목 추가', `<form class="form" id="sf">
      <label>종목명<input name="name" required maxlength="60" value="${esc(v.name)}" placeholder="예: 삼성전자"></label>
      <div class="row2">
        <label>종목코드<input name="code" maxlength="20" value="${esc(v.code)}" placeholder="005930 / AAPL"></label>
        <label>통화<select name="currency">
          <option value="KRW" ${v.currency === 'KRW' ? 'selected' : ''}>원 (KRW)</option>
          <option value="USD" ${v.currency === 'USD' ? 'selected' : ''}>달러 (USD)</option></select></label>
      </div>
      ${numInput('price', '현재가', v.price || '')}
      <div class="row2">${numInput('target', '목표가', v.target || '')}${numInput('stop', '손절가', v.stop || '')}</div>
      <label>메모<textarea name="memo" rows="3" maxlength="2000" placeholder="관심 이유, 체크할 이벤트 등">${esc(v.memo)}</textarea></label>
      <label class="check"><input type="checkbox" name="watch" ${v.watch ? 'checked' : ''}> 관심종목에 표시</label>
      <button class="btn primary block">저장</button>
      ${s ? '<button type="button" class="btn danger block" id="sf-del">종목 삭제</button>' : ''}
    </form>`, el => {
      const f = $('#sf', el);
      f.addEventListener('submit', e => {
        e.preventDefault();
        const name = f.name.value.trim();
        if (!name) return toast('종목명을 입력해 주세요');
        const t = s || { id: uid(), history: [], priceDate: '' };
        const price = posOrNull(num(f.price.value));
        if (price !== t.price) t.priceDate = price ? today() : '';
        Object.assign(t, {
          name, code: f.code.value.trim(), currency: f.currency.value,
          price, target: posOrNull(num(f.target.value)), stop: posOrNull(num(f.stop.value)),
          memo: f.memo.value, watch: f.watch.checked,
        });
        if (!s) S.symbols.push(t);
        save(); closeSheet(); render(); toast('저장했어요');
      });
      const del = $('#sf-del', el);
      if (del) del.addEventListener('click', async () => {
        const n = S.trades.filter(t => t.symbolId === id).length;
        if (!(await ask(`'${s.name}'을(를) 삭제할까요?${n ? `\n매매기록 ${n}건과 차트 데이터도 함께 삭제됩니다.` : ''}`))) return;
        S.symbols = S.symbols.filter(x => x.id !== id);
        S.trades = S.trades.filter(t => t.symbolId !== id);
        save(); closeSheet(); render(); toast('삭제했어요');
      });
    });
  }

  // ───────────────────────── 매매 기록 ─────────────────────────
  function openTradeForm(o = {}) {
    const t = o.id ? S.trades.find(x => x.id === o.id) : null;
    const type = t ? t.type : (o.type || 'buy');
    const symbolId = t ? t.symbolId : (o.symbolId || (S.symbols[0] && S.symbols[0].id) || '__new');
    const opts = S.symbols.map(s => `<option value="${esc(s.id)}" ${s.id === symbolId ? 'selected' : ''}>${esc(s.name)}${s.code ? ' (' + esc(s.code) + ')' : ''}</option>`).join('');
    openSheet(t ? '매매 기록 수정' : (type === 'buy' ? '매수 기록' : '매도 기록'), `<form class="form" id="tf">
      <div class="seg">
        <label><input type="radio" name="type" value="buy" ${type === 'buy' ? 'checked' : ''}><span>매수</span></label>
        <label><input type="radio" name="type" value="sell" ${type === 'sell' ? 'checked' : ''}><span>매도</span></label>
      </div>
      <label>종목<select name="symbol">${opts}<option value="__new" ${symbolId === '__new' ? 'selected' : ''}>+ 새 종목 추가</option></select></label>
      <div class="newsym" id="tf-new">
        <label>종목명<input name="name" maxlength="60" placeholder="예: 삼성전자"></label>
        <div class="row2">
          <label>종목코드<input name="code" maxlength="20" placeholder="005930 / AAPL"></label>
          <label>통화<select name="currency"><option value="KRW">원 (KRW)</option><option value="USD">달러 (USD)</option></select></label>
        </div>
      </div>
      <div class="row2">
        <label>날짜<input type="date" name="date" value="${t ? t.date : today()}" required></label>
        ${numInput('qty', '수량', t ? t.qty : '', 'required')}
      </div>
      <div class="row2">
        ${numInput('price', '단가', t ? t.price : '', 'required')}
        ${numInput('fee', '수수료·세금', t ? +t.fee.toFixed(4) : '', 'placeholder="비우면 자동"')}
      </div>
      <p class="hint" id="tf-hint"></p>
      <label>메모 (매매 이유·복기)<textarea name="memo" rows="3" maxlength="2000" placeholder="예: 20일선 지지 확인 후 분할매수">${t ? esc(t.memo) : ''}</textarea></label>
      <button class="btn primary block">${t ? '수정' : '저장'}</button>
      ${t ? '<button type="button" class="btn danger block" id="tf-del">기록 삭제</button>' : ''}
    </form>`, el => {
      const f = $('#tf', el);
      const book = computeBook(t && t.id);
      const curOf = () => (f.symbol.value === '__new' ? f.currency.value : (sym(f.symbol.value) || {}).currency || 'KRW');
      const update = () => {
        $('#tf-new', el).style.display = f.symbol.value === '__new' ? '' : 'none';
        const ty = f.type.value, cur = curOf();
        const q = num(f.qty.value), p = num(f.price.value);
        const parts = [];
        const held = f.symbol.value !== '__new' && book.pos.get(f.symbol.value);
        if (held && held.qty > 0) parts.push(`현재 보유 ${fmtQty(held.qty)}주 · 평단 ${fmtPrice(held.cost / held.qty, cur)}`);
        if (q > 0 && p > 0) {
          const amt = q * p, fee = Number.isFinite(num(f.fee.value)) ? num(f.fee.value) : feeFor(ty, amt, cur);
          parts.push(`거래금액 ${fmtMoney(amt, cur)} · 비용 ${fmtMoney(fee, cur)}`);
          if (ty === 'sell' && held && held.qty > 0) {
            const avg = held.cost / held.qty, qq = Math.min(q, held.qty);
            const r = p * qq - fee * (qq / q) - avg * qq;
            parts.push(`예상 실현손익 <b class="${cls(r)}">${fmtSigned(r, cur)} (${fmtPct(r / (avg * qq) * 100)})</b>`);
          }
        }
        $('#tf-hint', el).innerHTML = parts.join('<br>');
      };
      f.addEventListener('input', update);
      f.addEventListener('change', update);
      update();

      f.addEventListener('submit', async e => {
        e.preventDefault();
        const q = num(f.qty.value), p = num(f.price.value);
        if (!(q > 0)) return toast('수량을 확인해 주세요');
        if (!(p > 0)) return toast('단가를 확인해 주세요');
        let sid = f.symbol.value, s;
        if (sid === '__new') {
          const name = f.name.value.trim();
          if (!name) return toast('종목명을 입력해 주세요');
          s = { id: uid(), name, code: f.code.value.trim(), currency: f.currency.value, price: null, priceDate: '', target: null, stop: null, memo: '', watch: false, history: [] };
          S.symbols.push(s); sid = s.id;
        } else s = sym(sid);
        const ty = f.type.value;
        const feeIn = num(f.fee.value);
        const fee = Number.isFinite(feeIn) && feeIn >= 0 ? feeIn : feeFor(ty, q * p, s.currency);
        const held = book.pos.get(sid);
        if (ty === 'sell' && (!held || q > held.qty + 1e-9)) {
          if (!(await ask(`보유수량(${fmtQty(held ? held.qty : 0)}주)보다 많이 매도합니다. 초과분은 손익 계산에서 제외돼요. 계속할까요?`, '계속'))) return;
        }
        const rec = t || { id: uid(), created: Date.now() };
        Object.assign(rec, { symbolId: sid, type: ty, date: parseDate(f.date.value) || today(), qty: q, price: p, fee, memo: f.memo.value });
        if (!t) S.trades.push(rec);
        if (!s.price) { s.price = p; s.priceDate = rec.date; }
        save(); closeSheet(); render(); toast(t ? '수정했어요' : '기록했어요');
      });
      const del = $('#tf-del', el);
      if (del) del.addEventListener('click', async () => {
        if (!(await ask('이 매매 기록을 삭제할까요?'))) return;
        S.trades = S.trades.filter(x => x.id !== t.id);
        save(); closeSheet(); render(); toast('삭제했어요');
      });
    });
  }

  // ───────────────────────── 매매일지 ─────────────────────────
  function viewJournal() {
    const { realized } = computeBook();
    let f = S.ui.journalFilter;
    if (f && !sym(f)) f = S.ui.journalFilter = '';
    const list = S.trades.filter(t => !f || t.symbolId === f)
      .sort((a, b) => b.date.localeCompare(a.date) || (b.created || 0) - (a.created || 0));

    const month = today().slice(0, 7);
    const st = {};
    for (const t of list) {
      if (t.type !== 'sell') continue;
      const r = realized.get(t.id);
      if (!r) continue;
      const cur = (sym(t.symbolId) || {}).currency || 'KRW';
      const g = st[cur] || (st[cur] = { total: 0, month: 0, n: 0, wins: 0 });
      g.total += r.r; g.n++; if (r.r > 0) g.wins++;
      if (t.date.startsWith(month)) g.month += r.r;
    }

    let h = `<div class="actions-row">
      <button class="btn primary" data-action="new-trade" data-type="buy">+ 매수</button>
      <button class="btn primary alt" data-action="new-trade" data-type="sell">+ 매도</button>
      <select data-action="journal-filter" aria-label="종목 필터"><option value="">전체 종목</option>
        ${S.symbols.map(s => `<option value="${esc(s.id)}" ${s.id === f ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select>
    </div>`;

    for (const cur of ['KRW', 'USD']) {
      const g = st[cur];
      if (!g) continue;
      h += `<section class="card summary">
        <div class="label">${curLabel(cur)} 실현손익</div>
        <div class="big ${cls(g.total)}">${fmtSigned(g.total, cur)}</div>
        <div class="grid3">
          <div><span>이번 달</span><b class="${cls(g.month)}">${fmtSigned(g.month, cur)}</b></div>
          <div><span>매도 횟수</span><b>${g.n}회</b></div>
          <div><span>승률</span><b>${g.n ? (g.wins / g.n * 100).toFixed(0) : 0}%</b></div>
        </div></section>`;
    }

    if (!list.length) {
      return h + `<section class="card empty"><div class="empty-ico">📝</div><h3>매매 기록이 없어요</h3>
        <p>매수·매도할 때마다 이유를 함께 적어두면 나중에 복기하기 좋아요.</p></section>`;
    }

    let lastMonth = '';
    let open = false;
    for (const t of list) {
      const m = t.date.slice(0, 7);
      if (m !== lastMonth) {
        if (open) h += '</section>';
        h += `<h4 class="group-title">${m.replace('-', '년 ')}월</h4><section class="card list">`;
        lastMonth = m; open = true;
      }
      const s = sym(t.symbolId);
      const cur = s.currency;
      const r = realized.get(t.id);
      h += `<button class="item" data-action="edit-trade" data-id="${esc(t.id)}">
        <div class="item-main">
          <div class="name"><span class="badge ${t.type}">${t.type === 'buy' ? '매수' : '매도'}</span> ${esc(s.name)}</div>
          <div class="sub">${t.date.slice(5).replace('-', '/')} · ${fmtQty(t.qty)}주 × ${fmtPrice(t.price, cur)}</div>
          ${t.memo ? `<div class="memo-line">${esc(t.memo)}</div>` : ''}
        </div>
        <div class="item-side">
          <div class="val">${fmtMoney(t.qty * t.price, cur)}</div>
          ${r ? `<div class="sub ${cls(r.r)}">${fmtSigned(r.r, cur)} (${fmtPct(r.pct)})</div>${r.over ? '<div class="sub warn">보유수량 초과</div>' : ''}` : ''}
        </div></button>`;
    }
    if (open) h += '</section>';
    return h;
  }

  // ───────────────────────── 계산기 ─────────────────────────
  const calc = {
    sid: '', cur: 'KRW', q0: '', a0: '', now: '', rows: [{ p: '', q: '' }],
    tq: '', ta: '', tp: '', tt: '',
    ga: '',
  };
  function prefillCalc(id) {
    const s = sym(id);
    if (!s) return;
    const p = computeBook().pos.get(id);
    calc.sid = id; calc.cur = s.currency;
    calc.now = s.price || '';
    if (p && p.qty > 0) {
      const avg = +(p.cost / p.qty).toFixed(4);
      calc.q0 = calc.tq = p.qty; calc.a0 = calc.ta = calc.ga = avg;
    } else { calc.q0 = calc.tq = calc.a0 = calc.ta = calc.ga = ''; }
    calc.tp = s.price || '';
    calc.rows = [{ p: s.price || '', q: '' }];
  }

  function viewCalc() {
    const { pos } = computeBook();
    const held = S.symbols.filter(s => (pos.get(s.id) || {}).qty > 0);
    const c = calc;
    return `
    <section class="card">
      <label>보유 종목 불러오기<select data-action="calc-prefill">
        <option value="">직접 입력</option>
        ${held.map(s => `<option value="${esc(s.id)}" ${s.id === c.sid ? 'selected' : ''}>${esc(s.name)}</option>`).join('')}</select></label>
      <div class="seg small" id="calc-cur">
        <label><input type="radio" name="ccur" value="KRW" ${c.cur === 'KRW' ? 'checked' : ''}><span>원</span></label>
        <label><input type="radio" name="ccur" value="USD" ${c.cur === 'USD' ? 'checked' : ''}><span>달러</span></label>
      </div>
    </section>

    <section class="card calc" id="calc-avg">
      <h3>물타기 · 불타기 평단 계산</h3>
      <div class="row2">${numInput('q0', '현재 보유수량', c.q0)}${numInput('a0', '현재 평단', c.a0)}</div>
      <div class="sub-title">추가 매수 (분할)</div>
      <div id="calc-rows">${c.rows.map((r, i) => `<div class="row2 calc-row" data-i="${i}">
        ${numInput('p', `${i + 1}차 매수가`, r.p)}${numInput('q', `${i + 1}차 수량`, r.q)}</div>`).join('')}</div>
      <div class="actions-row tight">
        <button type="button" class="btn small" data-action="calc-add-row" ${c.rows.length >= 5 ? 'disabled' : ''}>+ 분할 추가</button>
        <button type="button" class="btn small ghost" data-action="calc-del-row" ${c.rows.length <= 1 ? 'disabled' : ''}>− 줄 삭제</button>
      </div>
      ${numInput('now', '현재가 (선택)', c.now)}
      <div class="result" id="out-avg"></div>
    </section>

    <section class="card calc" id="calc-target">
      <h3>목표 평단 맞추기</h3>
      <p class="hint">원하는 평단이 되려면 얼마나 사야 하는지 거꾸로 계산해요.</p>
      <div class="row2">${numInput('tq', '현재 보유수량', c.tq)}${numInput('ta', '현재 평단', c.ta)}</div>
      <div class="row2">${numInput('tp', '추가 매수가', c.tp)}${numInput('tt', '목표 평단', c.tt)}</div>
      <div class="result" id="out-target"></div>
    </section>

    <section class="card calc" id="calc-goal">
      <h3>목표 수익률별 매도가</h3>
      <p class="hint">설정된 수수료${c.cur === 'KRW' ? '·거래세' : ''}를 반영한 실제 손익 기준이에요.</p>
      ${numInput('ga', '평균단가', c.ga)}
      <div class="result" id="out-goal"></div>
    </section>`;
  }

  function mountCalc(v) {
    const fmt = x => fmtPrice(x, calc.cur);
    const money = x => fmtMoney(x, calc.cur);
    const readSection = () => {
      const a = $('#calc-avg', v), t = $('#calc-target', v), g = $('#calc-goal', v);
      calc.q0 = a.querySelector('[name=q0]').value; calc.a0 = a.querySelector('[name=a0]').value;
      calc.now = a.querySelector('[name=now]').value;
      calc.rows = $$('.calc-row', a).map(r => ({ p: r.querySelector('[name=p]').value, q: r.querySelector('[name=q]').value }));
      calc.tq = t.querySelector('[name=tq]').value; calc.ta = t.querySelector('[name=ta]').value;
      calc.tp = t.querySelector('[name=tp]').value; calc.tt = t.querySelector('[name=tt]').value;
      calc.ga = g.querySelector('[name=ga]').value;
      const cc = v.querySelector('[name=ccur]:checked');
      if (cc) calc.cur = cc.value;
    };
    const compute = () => {
      readSection();
      // 1) 물타기
      const q0 = num(calc.q0) || 0, a0 = num(calc.a0) || 0, now = num(calc.now);
      let tq = q0, tc = q0 * a0, add = 0;
      for (const r of calc.rows) { const p = num(r.p), q = num(r.q); if (p > 0 && q > 0) { tq += q; tc += p * q; add += p * q; } }
      const o1 = $('#out-avg', v);
      if (tq > 0 && add > 0) {
        const na = tc / tq;
        let h = kv('새 평균단가', `<span class="hl">${fmt(na)}</span>`)
          + kv('총 보유수량', fmtQty(tq) + '주')
          + kv('추가 투입금액', money(add))
          + kv('총 매입금액', money(tc));
        if (a0 > 0 && q0 > 0) h += kv('평단 변화', `<span class="${cls(na - a0)}">${fmt(na - a0)} (${fmtPct((na / a0 - 1) * 100)})</span>`);
        if (now > 0) {
          if (a0 > 0 && q0 > 0) h += kv('현재가 기준 수익률 (전)', `<span class="${cls(now - a0)}">${fmtPct((now / a0 - 1) * 100)}</span>`);
          h += kv('현재가 기준 수익률 (후)', `<span class="${cls(now - na)}">${fmtPct((now / na - 1) * 100)}</span>`);
          h += kv('본전까지 필요 상승률', na > now ? fmtPct((na / now - 1) * 100) : '이미 수익 구간');
        }
        o1.innerHTML = `<div class="kv-list">${h}</div>`;
      } else o1.innerHTML = '<p class="hint">추가 매수가와 수량을 입력하면 결과가 나와요.</p>';

      // 2) 목표 평단 역산
      const Q = num(calc.tq), A = num(calc.ta), P = num(calc.tp), T = num(calc.tt);
      const o2 = $('#out-target', v);
      if (Q > 0 && A > 0 && P > 0 && T > 0) {
        const need = Q * (A - T) / (T - P);
        if (T === A) o2.innerHTML = '<p class="hint">목표 평단이 현재 평단과 같아요.</p>';
        else if (!(need > 0) || !Number.isFinite(need)) {
          o2.innerHTML = `<p class="warn">불가능한 목표예요. 목표 평단은 현재 평단(${fmt(A)})과 매수가(${fmt(P)}) 사이여야 해요.</p>`;
        } else {
          const whole = calc.cur === 'KRW' ? Math.ceil(need) : need;
          o2.innerHTML = `<div class="kv-list">${kv('필요 매수수량', `<span class="hl">${fmtQty(calc.cur === 'KRW' ? whole : +need.toFixed(4))}주</span>`)
            + kv('필요 금액', money(whole * P))
            + kv('매수 후 평단', fmt((Q * A + whole * P) / (Q + whole)))
            + kv('매수 후 보유수량', fmtQty(Q + whole) + '주')}</div>`;
        }
      } else o2.innerHTML = '<p class="hint">네 칸을 모두 입력하면 결과가 나와요.</p>';

      // 3) 목표 수익률
      const ga = num(calc.ga);
      const o3 = $('#out-goal', v);
      if (ga > 0) {
        const s = S.settings;
        const sc = (s.sellFee + (calc.cur === 'KRW' ? s.sellTax : 0)) / 100;
        const bc = s.buyFee / 100;
        const rows = [30, 20, 10, 5, 3, 0, -3, -5, -10, -20].map(r => {
          const p = ga * (1 + bc) * (1 + r / 100) / (1 - sc);
          return `<tr class="${r === 0 ? 'zero' : ''}"><td class="${cls(r)}">${r === 0 ? '본전' : (r > 0 ? '+' : '') + r + '%'}</td><td>${fmt(p)}</td><td class="${cls(p - ga)}">${fmtPct((p / ga - 1) * 100)}</td></tr>`;
        }).join('');
        o3.innerHTML = `<table class="tbl"><thead><tr><th>목표</th><th>매도가</th><th>평단 대비</th></tr></thead><tbody>${rows}</tbody></table>`;
      } else o3.innerHTML = '<p class="hint">평균단가를 입력하세요.</p>';
    };
    v.addEventListener('input', e => { if (e.target.closest('.calc')) compute(); });
    $('#calc-cur', v).addEventListener('change', () => { compute(); });
    compute();
    v._calcRead = readSection;
  }

  // ───────────────────────── 관심종목 ─────────────────────────
  function viewWatch() {
    const list = S.symbols.filter(s => s.watch || s.target || s.stop);
    let h = `<div class="actions-row"><button class="btn primary" data-action="new-symbol">+ 관심종목 추가</button></div>`;
    if (!list.length) {
      return h + `<section class="card empty"><div class="empty-ico">⭐</div><h3>관심종목이 없어요</h3>
        <p>목표가와 손절가를 적어두면 현재가와의 거리를 한눈에 볼 수 있어요.</p></section>`;
    }
    h += '<section class="card list">';
    for (const s of list) {
      const cur = s.currency, p = s.price;
      const tags = [];
      if (p && s.target && p >= s.target) tags.push('<span class="tag hit">목표가 도달</span>');
      if (p && s.stop && p <= s.stop) tags.push('<span class="tag stop">손절가 도달</span>');
      const dist = (x, label) => (x ? `<div class="dist"><span>${label}</span><b>${fmtPrice(x, cur)}</b>${p ? `<small class="${cls(x - p)}">${fmtPct((x / p - 1) * 100)}</small>` : ''}</div>` : '');
      let bar = '';
      if (p && s.target && s.stop && s.target > s.stop) {
        const pos = Math.max(0, Math.min(100, (p - s.stop) / (s.target - s.stop) * 100));
        bar = `<div class="range-bar"><i style="left:${pos.toFixed(1)}%"></i></div>`;
      }
      h += `<button class="item watch" data-action="symbol" data-id="${esc(s.id)}">
        <div class="item-main">
          <div class="name">${esc(s.name)} ${s.code ? `<span class="code">${esc(s.code)}</span>` : ''} ${tags.join('')}</div>
          <div class="sub">현재가 ${p ? fmtPrice(p, cur) : '미입력'} ${s.priceDate ? `· ${esc(s.priceDate.slice(5).replace('-', '/'))}` : ''}</div>
          <div class="dists">${dist(s.target, '목표')}${dist(s.stop, '손절')}</div>
          ${bar}
          ${s.memo ? `<div class="memo-line">${esc(s.memo)}</div>` : ''}
        </div></button>`;
    }
    return h + '</section>';
  }

  // ───────────────────────── 차트 분석 ─────────────────────────
  function viewChart() {
    if (!S.symbols.length) {
      return `<section class="card empty"><div class="empty-ico">📊</div><h3>종목이 없어요</h3>
        <p>먼저 보유 종목이나 관심종목을 추가하세요.</p>
        <button class="btn primary" data-action="new-symbol">종목 추가</button>
        <button class="btn ghost" data-action="sample">샘플 데이터로 둘러보기</button></section>`;
    }
    if (!sym(S.ui.chartSymbol)) S.ui.chartSymbol = S.symbols[0].id;
    const s = sym(S.ui.chartSymbol);
    const bars = s.history;
    let h = `<div class="actions-row">
      <select data-action="chart-symbol" aria-label="종목 선택" class="grow">
        ${S.symbols.map(x => `<option value="${esc(x.id)}" ${x.id === s.id ? 'selected' : ''}>${esc(x.name)} (${x.history.length}일)</option>`).join('')}
      </select></div>`;
    const dataBtns = `<div class="actions-row">
      <button class="btn small" data-action="add-bar">+ 시세 입력</button>
      <button class="btn small" data-action="csv">CSV 붙여넣기</button>
      <button class="btn small ghost" data-action="manage-bars">데이터 관리</button></div>`;
    if (bars.length < 2) {
      return h + `<section class="card empty"><div class="empty-ico">📊</div><h3>차트 데이터가 없어요</h3>
        <p>일별 시세(종가 또는 시가·고가·저가·종가·거래량)를 직접 입력하거나, 증권사 앱·엑셀에서 복사한 표를 붙여넣으세요.</p>
        <p class="hint">이동평균·MACD 분석은 최소 30일, 60일선까지 보려면 60일 이상의 데이터가 필요해요.</p></section>` + dataBtns;
    }
    const range = S.ui.chartRange;
    h += `<section class="card chart-card">
      <div class="seg small" id="ch-range">${[[60, '3개월'], [120, '6개월'], [250, '1년'], [0, '전체']].map(([v, l]) =>
        `<label><input type="radio" name="rng" value="${v}" ${range === v ? 'checked' : ''}><span>${l}</span></label>`).join('')}</div>
      <div class="ch-info" id="ch-info"></div>
      <canvas id="cv" aria-label="${esc(s.name)} 차트"></canvas>
      <div class="legend"><span class="l-ma5">MA5</span><span class="l-ma20">MA20</span><span class="l-ma60">MA60</span><span class="l-bb">볼린저(20,2)</span><span>▲▼ 골든/데드크로스</span></div>
    </section>` + dataBtns;

    const A = Ind.analyze(bars);
    const cur = s.currency, L = A.latest, lv = A.levels;
    if (bars.length < 20) {
      h += `<section class="card"><p class="hint">분석에는 최소 20일치 데이터가 필요해요. (현재 ${bars.length}일)</p></section>`;
      return h;
    }
    const vClass = A.score >= 1 ? 'up' : A.score <= -1 ? 'down' : '';
    h += `<section class="card">
      <h3>기술적 종합 판단</h3>
      <div class="verdict ${vClass}"><b>${A.verdict}</b><span>점수 ${A.score > 0 ? '+' : ''}${A.score}</span></div>
      <div class="kv-list">${A.items.map(it => kv(it.label, `${esc(it.value)} <span class="pts ${cls(it.pts)}">${it.pts > 0 ? '+' : ''}${it.pts}</span>`)).join('')}</div>
    </section>
    <section class="card">
      <h3>매매 타점 참고 가격대</h3>
      <div class="kv-list">
        ${kv('현재가', fmtPrice(L.close, cur) + (L.change != null ? ` <small class="${cls(L.change)}">${fmtPct(L.change)}</small>` : ''))}
        ${L.ma20 != null ? kv('눌림목 매수 관심 (20일선)', fmtPrice(L.ma20, cur) + ` <small class="${cls(L.ma20 - L.close)}">${fmtPct((L.ma20 / L.close - 1) * 100)}</small>`) : ''}
        ${L.bbL != null ? kv('볼린저 하단 (과매도 관심)', fmtPrice(L.bbL, cur)) : ''}
        ${kv('단기 지지 (20일 최저)', fmtPrice(lv.support20, cur))}
        ${kv('단기 저항 (20일 최고)', fmtPrice(lv.resist20, cur))}
        ${bars.length >= 60 ? kv('중기 지지 / 저항 (60일)', `${fmtPrice(lv.support60, cur)} / ${fmtPrice(lv.resist60, cur)}`) : ''}
        ${L.bbU != null ? kv('볼린저 상단 (1차 목표 참고)', fmtPrice(L.bbU, cur)) : ''}
        ${kv('손절 참고 (20일 최저 −3%)', `<span class="down">${fmtPrice(lv.stop, cur)}</span>`)}
      </div>
      <div class="actions-row tight"><button class="btn small" data-action="apply-levels">목표가·손절가로 저장</button></div>
    </section>
    <section class="card">
      <h3>최근 신호</h3>
      ${A.signals.length ? `<ul class="signals">${A.signals.slice(0, 10).map(sg =>
        `<li><span class="dot ${sg.dir > 0 ? 'up' : sg.dir < 0 ? 'down' : 'neutral'}"></span><span class="sd">${esc(sg.date.slice(2).replace(/-/g, '.'))}</span><span>${esc(sg.text)}</span></li>`).join('')}</ul>`
        : '<p class="hint">감지된 신호가 없어요.</p>'}
    </section>
    <p class="disclaimer">※ 기술적 지표는 과거 가격으로 계산한 참고 자료일 뿐, 미래 수익을 보장하지 않아요. 투자 판단과 책임은 본인에게 있습니다.</p>`;
    return h;
  }

  let chartRedraw = null;
  function mountChart(v) {
    chartRedraw = null;
    const cv = $('#cv', v);
    if (!cv) return;
    const s = sym(S.ui.chartSymbol), bars = s.history, cur = s.currency;
    const A = Ind.analyze(bars);
    let cursor = null, geo = null;
    const info = i => {
      const b = bars[i], prev = i > 0 ? bars[i - 1].c : null;
      const ch = prev ? (b.c / prev - 1) * 100 : null;
      const f = x => fmtPrice(x, cur);
      const r = A.ind.rsi[i];
      $('#ch-info', v).innerHTML = `<b>${esc(b.d)}</b>
        ${b.o != null ? `시 ${f(b.o)} 고 ${f(b.h)} 저 ${f(b.l)} ` : ''}종 <b class="${cls(ch)}">${f(b.c)}</b>${ch != null ? ` <span class="${cls(ch)}">${fmtPct(ch)}</span>` : ''}
        <br><span class="l-ma5">MA5 ${A.ind.ma5[i] != null ? f(A.ind.ma5[i]) : '-'}</span>
        <span class="l-ma20">MA20 ${A.ind.ma20[i] != null ? f(A.ind.ma20[i]) : '-'}</span>
        <span class="l-ma60">MA60 ${A.ind.ma60[i] != null ? f(A.ind.ma60[i]) : '-'}</span>
        · RSI ${r != null ? r.toFixed(1) : '-'}${b.v != null ? ` · 거래량 ${fmtQty(b.v)}` : ''}`;
    };
    const draw = () => {
      geo = StockChart.draw(cv, bars, A, { range: S.ui.chartRange, cursor });
      info(cursor != null ? cursor : bars.length - 1);
    };
    const pick = e => {
      if (!geo) return;
      const r = cv.getBoundingClientRect();
      const i = geo.indexAt(e.clientX - r.left);
      if (i !== cursor) { cursor = i; draw(); }
    };
    cv.addEventListener('pointerdown', pick);
    cv.addEventListener('pointermove', pick);
    cv.addEventListener('dblclick', () => { cursor = null; draw(); });
    $('#ch-range', v).addEventListener('change', e => {
      S.ui.chartRange = +e.target.value; save(); cursor = null; draw();
    });
    chartRedraw = draw;
    draw();
  }

  function openBarForm(id) {
    const s = sym(id);
    const last = s.history[s.history.length - 1];
    openSheet(`${s.name} 시세 입력`, `<form class="form" id="bf">
      <label>날짜<input type="date" name="d" value="${today()}" required></label>
      ${numInput('c', '종가 (필수)', '', 'required')}
      <details ${last && last.o != null ? 'open' : ''}><summary>시가 · 고가 · 저가 · 거래량 (선택)</summary>
        <div class="row2">${numInput('o', '시가', '')}${numInput('h', '고가', '')}</div>
        <div class="row2">${numInput('l', '저가', '')}${numInput('v', '거래량', '')}</div>
      </details>
      <button class="btn primary block">저장</button>
      <p class="hint">같은 날짜를 다시 입력하면 덮어써요. 장중에 입력한 값은 장 마감 후 종가로 다시 고쳐주세요.</p>
    </form>`, el => {
      const f = $('#bf', el);
      f.addEventListener('submit', e => {
        e.preventDefault();
        const d = parseDate(f.d.value), c = num(f.c.value);
        if (!d) return toast('날짜를 확인해 주세요');
        if (!(c > 0)) return toast('종가를 확인해 주세요');
        let o = posOrNull(num(f.o.value)), hi = posOrNull(num(f.h.value)), lo = posOrNull(num(f.l.value));
        const vol = Number.isFinite(num(f.v.value)) && num(f.v.value) >= 0 ? num(f.v.value) : null;
        if (o != null || hi != null || lo != null) {
          o = o ?? c;
          hi = Math.max(hi ?? -Infinity, o, c); lo = Math.min(lo ?? Infinity, o, c);
        }
        s.history = s.history.filter(b => b.d !== d);
        upsertBars(s, [{ d, o, h: hi, l: lo, c, v: vol }]);
        save(); closeSheet(); render(); toast('시세를 저장했어요');
      });
    });
  }

  function parseBars(text) {
    const lines = text.split(/\r?\n/).map(l => l.trim()).filter(Boolean);
    const HEAD = {
      d: /^(date|날짜|일자|기준일|일시|time)/i, o: /^(open|시가$|시가\()/i, h: /^(high|고가)/i,
      l: /^(low|저가)/i, c: /^(close|종가|현재가|adjclose)/i, v: /^(vol|거래량)/i,
    };
    const splitCSV = l => {
      const out = []; let cur = '', q = false;
      for (const ch of l) {
        if (ch === '"') q = !q;
        else if (ch === ',' && !q) { out.push(cur); cur = ''; }
        else cur += ch;
      }
      out.push(cur);
      return out;
    };
    const split = l => (l.includes('\t') ? l.split('\t') : l.includes(',') ? splitCSV(l) : l.split(/\s{2,}|\s(?=[\d-])/));
    let map = null;
    const out = [];
    let bad = 0;
    for (const line of lines) {
      const cells = split(line).map(x => x.trim().replace(/^"|"$/g, ''));
      const dCol = map ? map.d : 0;
      const d = parseDate(cells[dCol]);
      if (!d) {
        const m = {};
        cells.forEach((c, i) => {
          const k0 = c.replace(/\s/g, '');
          for (const k of Object.keys(HEAD)) if (m[k] == null && HEAD[k].test(k0)) { m[k] = i; break; }
        });
        if (m.d != null && m.c != null) map = m; else bad++;
        continue;
      }
      let r;
      if (map) {
        const g = k => (map[k] != null ? num(cells[map[k]]) : NaN);
        r = { d, o: g('o'), h: g('h'), l: g('l'), c: g('c'), v: g('v') };
      } else {
        const ns = cells.slice(1).map(num).filter(x => Number.isFinite(x));
        if (ns.length >= 5) r = { d, o: ns[0], h: ns[1], l: ns[2], c: ns[3], v: ns[4] };
        else if (ns.length === 4) r = { d, o: ns[0], h: ns[1], l: ns[2], c: ns[3] };
        else if (ns.length >= 2) r = { d, c: ns[0], v: ns[1] };
        else r = { d, c: ns[0] };
      }
      r.c = posOrNull(r.c);
      if (!r.c) { bad++; continue; }
      r.o = posOrNull(r.o); r.h = posOrNull(r.h); r.l = posOrNull(r.l);
      r.v = Number.isFinite(r.v) && r.v >= 0 ? r.v : null;
      if (r.o != null && r.h != null && r.l != null) {
        r.h = Math.max(r.h, r.o, r.c); r.l = Math.min(r.l, r.o, r.c);
      } else { r.o = r.h = r.l = null; }
      out.push(r);
    }
    return { bars: out, bad };
  }

  function openCsvSheet(id) {
    const s = sym(id);
    openSheet(`${s.name} 시세 붙여넣기`, `<form class="form" id="cf">
      <p class="hint">엑셀·구글시트·증권사 화면에서 복사한 표나 CSV를 붙여넣으세요. 첫 줄에 머리글(날짜, 시가, 고가, 저가, 종가, 거래량)이 있으면 열 순서와 관계없이 인식해요.</p>
      <pre class="example">날짜,시가,고가,저가,종가,거래량
2026-11-10,71000,72500,70800,72000,1523000
2026-11-11,72000,72300,71200,71500,1180000</pre>
      <p class="hint">머리글이 없으면 <b>날짜,종가</b> / <b>날짜,종가,거래량</b> / <b>날짜,시가,고가,저가,종가(,거래량)</b> 순서로 읽어요.</p>
      <label>데이터<textarea name="t" rows="8" placeholder="여기에 붙여넣기" spellcheck="false"></textarea></label>
      <label class="check"><input type="checkbox" name="replace"> 기존 차트 데이터를 지우고 가져오기</label>
      <p class="hint" id="cf-prev"></p>
      <button class="btn primary block">가져오기</button>
    </form>`, el => {
      const f = $('#cf', el);
      f.t.addEventListener('input', () => {
        const r = parseBars(f.t.value);
        $('#cf-prev', el).textContent = f.t.value.trim()
          ? `인식: ${r.bars.length}일${r.bad ? ` · 건너뜀 ${r.bad}줄` : ''}${r.bars.length ? ` (${r.bars[0].d} ~ ${r.bars[r.bars.length - 1].d})` : ''}` : '';
      });
      f.addEventListener('submit', e => {
        e.preventDefault();
        const r = parseBars(f.t.value);
        if (!r.bars.length) return toast('인식된 데이터가 없어요. 형식을 확인해 주세요');
        if (f.replace.checked) { s.history = []; s.priceDate = ''; }
        upsertBars(s, r.bars);
        save(); closeSheet(); render();
        toast(`${r.bars.length}일치 시세를 가져왔어요`);
      });
    });
  }

  function openManageBars(id) {
    const s = sym(id), H = s.history;
    const recent = H.slice(-30).reverse();
    openSheet(`${s.name} 차트 데이터`, `
      <p class="hint">${H.length ? `총 ${H.length}일 · ${H[0].d} ~ ${H[H.length - 1].d}` : '데이터 없음'}</p>
      <table class="tbl"><thead><tr><th>날짜</th><th>종가</th><th>거래량</th><th></th></tr></thead><tbody>
      ${recent.map(b => `<tr><td>${esc(b.d)}</td><td>${fmtPrice(b.c, s.currency)}</td><td>${b.v != null ? fmtQty(b.v) : '-'}</td>
        <td><button class="btn tiny ghost" data-del="${esc(b.d)}" aria-label="${esc(b.d)} 삭제">삭제</button></td></tr>`).join('')}
      </tbody></table>
      ${H.length > 30 ? '<p class="hint">최근 30일만 표시해요.</p>' : ''}
      <button class="btn danger block" id="mb-clear" ${H.length ? '' : 'disabled'}>차트 데이터 전체 삭제</button>`, el => {
      el.addEventListener('click', e => {
        const b = e.target.closest('[data-del]');
        if (b) {
          s.history = s.history.filter(x => x.d !== b.dataset.del);
          save(); render(); openManageBars(id);
        }
      });
      $('#mb-clear', el).addEventListener('click', async () => {
        if (!(await ask('이 종목의 차트 데이터를 모두 삭제할까요?'))) return;
        s.history = []; save(); closeSheet(); render(); toast('삭제했어요');
      });
    });
  }

  async function applyLevels(id) {
    const s = sym(id);
    if (!s || s.history.length < 20) return;
    const A = Ind.analyze(s.history);
    const target = A.latest.bbU && A.latest.bbU > A.latest.close ? A.latest.bbU : A.levels.resist20;
    const round = x => (s.currency === 'KRW' ? Math.round(x) : +x.toFixed(2));
    if (!(await ask(`목표가 ${fmtPrice(round(target), s.currency)}, 손절가 ${fmtPrice(round(A.levels.stop), s.currency)}로 저장할까요?`, '저장'))) return;
    s.target = round(target); s.stop = round(A.levels.stop);
    save(); render(); toast('목표가·손절가를 저장했어요');
  }

  // ───────────────────────── 설정 · 백업 ─────────────────────────
  function openSettings() {
    const st = S.settings;
    openSheet('설정', `<form class="form" id="setf">
      <h3>수수료 · 세금 (%)</h3>
      <div class="row2">${numInput('buyFee', '매수 수수료', st.buyFee)}${numInput('sellFee', '매도 수수료', st.sellFee)}</div>
      ${numInput('sellTax', '매도 거래세 (국내만 적용)', st.sellTax)}
      <p class="hint">사용하는 증권사 수수료와 현재 증권거래세율로 맞춰주세요. 매매 기록에 수수료를 비워두면 이 값으로 자동 계산해요.</p>
      <button class="btn primary block">저장</button>
    </form>
    <h3>백업 · 복원</h3>
    <p class="hint">데이터는 이 기기에만 저장돼요. 휴대폰을 바꾸거나 Safari 데이터를 지우면 사라질 수 있으니 가끔 백업 파일을 저장해 두세요.</p>
    <div class="btn-grid">
      <button class="btn" id="bk-export">백업하기</button>
      <button class="btn" id="bk-import">백업 불러오기</button>
    </div>
    <h3>기타</h3>
    <div class="btn-grid">
      <button class="btn" id="st-sample">샘플 데이터 추가</button>
      <button class="btn danger" id="st-reset">전체 데이터 삭제</button>
    </div>
    <p class="hint small">주식노트 v1 · 서버 없이 기기에만 저장 · 종목 ${S.symbols.length}개, 매매기록 ${S.trades.length}건</p>`, el => {
      const f = $('#setf', el);
      f.addEventListener('submit', e => {
        e.preventDefault();
        for (const k of ['buyFee', 'sellFee', 'sellTax']) {
          const v = num(f[k].value);
          if (!(v >= 0) || v > 10) return toast('수수료 값을 확인해 주세요 (0~10%)');
          S.settings[k] = v;
        }
        save(); closeSheet(); render(); toast('설정을 저장했어요');
      });
      $('#bk-export', el).addEventListener('click', openExportSheet);
      $('#bk-import', el).addEventListener('click', openImportSheet);
      $('#st-sample', el).addEventListener('click', () => { closeSheet(); loadSample(); });
      $('#st-reset', el).addEventListener('click', async () => {
        if (!(await ask('모든 종목, 매매기록, 차트 데이터를 삭제할까요? 되돌릴 수 없어요.'))) return;
        if (!(await ask('정말 삭제할까요? 백업하지 않았다면 복구할 수 없어요.'))) return;
        S = defaults(); save(); closeSheet(); render(); toast('모든 데이터를 삭제했어요');
      });
    });
  }

  const backupText = () => JSON.stringify({ app: 'stocknote', exported: new Date().toISOString(), version: S.version, symbols: S.symbols, trades: S.trades, settings: S.settings });

  function openExportSheet() {
    const data = backupText();
    openSheet('백업하기', `
      <p class="hint">파일로 저장하거나, 아래 텍스트를 복사해 메모 앱 등에 붙여넣어 보관하세요. (${(data.length / 1024).toFixed(1)}KB)</p>
      <div class="btn-grid">
        <button class="btn primary" id="ex-file">파일로 저장</button>
        <button class="btn" id="ex-copy">텍스트 복사</button>
      </div>
      <textarea id="ex-text" rows="6" readonly spellcheck="false">${esc(data)}</textarea>`, el => {
      const ta = $('#ex-text', el);
      $('#ex-copy', el).addEventListener('click', () => {
        const fallback = () => { ta.focus(); ta.select(); ta.setSelectionRange(0, ta.value.length); toast('텍스트를 선택했어요. 복사를 눌러주세요'); };
        if (navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(data).then(() => toast('백업 텍스트를 복사했어요'), fallback);
        } else fallback();
      });
      $('#ex-file', el).addEventListener('click', async () => {
        const name = `stocknote-backup-${today()}.json`;
        const file = new File([data], name, { type: 'application/json' });
        if (navigator.canShare && navigator.canShare({ files: [file] })) {
          try { await navigator.share({ files: [file], title: '주식노트 백업' }); return; }
          catch (e) { if (e && e.name === 'AbortError') return; }
        }
        const a = document.createElement('a');
        a.href = URL.createObjectURL(file); a.download = name;
        document.body.appendChild(a); a.click();
        setTimeout(() => { URL.revokeObjectURL(a.href); a.remove(); }, 1000);
        toast('파일 저장이 안 되면 텍스트 복사를 이용하세요');
      });
    });
  }

  function openImportSheet() {
    openSheet('백업 불러오기', `
      <p class="hint">백업 파일을 고르거나, 복사해 둔 백업 텍스트를 붙여넣으세요. 현재 데이터는 백업 내용으로 바뀝니다.</p>
      <label class="btn file-btn block">백업 파일 선택<input type="file" id="im-file" accept="application/json,.json,text/plain"></label>
      <label>백업 텍스트<textarea id="im-text" rows="6" spellcheck="false" placeholder='{"app":"stocknote", ...}'></textarea></label>
      <button class="btn primary block" id="im-go">텍스트로 불러오기</button>`, el => {
      $('#im-file', el).addEventListener('change', e => {
        const f = e.target.files[0];
        if (!f) return;
        const r = new FileReader();
        r.onload = () => restoreBackup(r.result);
        r.readAsText(f);
      });
      $('#im-go', el).addEventListener('click', () => restoreBackup($('#im-text', el).value));
    });
  }

  async function restoreBackup(text) {
    let next;
    try {
      const obj = JSON.parse(String(text).trim());
      if (!obj || !Array.isArray(obj.symbols) || !Array.isArray(obj.trades)) throw new Error('형식 오류');
      next = normalize({ ...obj, ui: S.ui });
    } catch (e) { return toast('백업 내용을 읽을 수 없어요. 전체를 복사했는지 확인해 주세요'); }
    if (!(await ask(`백업을 불러올까요?\n종목 ${next.symbols.length}개, 매매기록 ${next.trades.length}건\n현재 데이터는 백업 내용으로 바뀝니다.`, '불러오기'))) return;
    S = next; save(); closeSheet(); render(); toast('백업을 불러왔어요');
  }

  function loadSample() {
    let seed = 20261115;
    const rnd = () => { seed |= 0; seed = seed + 0x6D2B79F5 | 0; let t = Math.imul(seed ^ seed >>> 15, 1 | seed); t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t; return ((t ^ t >>> 14) >>> 0) / 4294967296; };
    const bars = [];
    let p = 62000;
    const d = new Date(); d.setDate(d.getDate() - 330);
    while (bars.length < 230) {
      d.setDate(d.getDate() + 1);
      if (d.getDay() === 0 || d.getDay() === 6) continue;
      const k = bars.length;
      const drift = k < 80 ? 0.0012 : k < 150 ? -0.0015 : 0.0018;
      const o = p * (1 + (rnd() - 0.5) * 0.01);
      const c = o * (1 + drift + (rnd() - 0.5) * 0.032);
      const h = Math.max(o, c) * (1 + rnd() * 0.012), l = Math.min(o, c) * (1 - rnd() * 0.012);
      const r100 = x => Math.round(x / 100) * 100;
      const ds = new Date(d); ds.setMinutes(ds.getMinutes() - ds.getTimezoneOffset());
      bars.push({ d: ds.toISOString().slice(0, 10), o: r100(o), h: r100(h), l: r100(l), c: r100(c), v: Math.round(800000 + rnd() * 1600000) });
      p = c;
    }
    const last = bars[bars.length - 1];
    const sid = uid();
    S.symbols.push({ id: sid, name: '샘플전자', code: 'DEMO', currency: 'KRW', price: last.c, priceDate: last.d, target: Math.round(last.c * 1.12 / 100) * 100, stop: Math.round(last.c * 0.92 / 100) * 100, memo: '샘플 데이터입니다. 종목을 누른 뒤 '종목 정보 수정 → 종목 삭제'로 지울 수 있어요.', watch: true, history: bars });
    const at = i => bars[i];
    const now = Date.now();
    S.trades.push(
      { id: uid(), symbolId: sid, type: 'buy', date: at(60).d, qty: 10, price: at(60).c, fee: feeFor('buy', 10 * at(60).c, 'KRW'), memo: '20일선 지지 확인 후 1차 매수', created: now },
      { id: uid(), symbolId: sid, type: 'buy', date: at(130).d, qty: 10, price: at(130).c, fee: feeFor('buy', 10 * at(130).c, 'KRW'), memo: '하락 구간 물타기', created: now + 1 },
      { id: uid(), symbolId: sid, type: 'sell', date: at(200).d, qty: 5, price: at(200).c, fee: feeFor('sell', 5 * at(200).c, 'KRW'), memo: '반등 시 일부 차익실현', created: now + 2 },
    );
    S.ui.chartSymbol = sid;
    save(); render(); toast('샘플 데이터를 추가했어요');
  }

  // ───────────────────────── 렌더 & 이벤트 ─────────────────────────
  function render() {
    const tab = S.ui.tab;
    $('#title').textContent = TABS[tab];
    $$('.tabbar button').forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
    const v = $('#view');
    chartRedraw = null;
    if (tab === 'portfolio') v.innerHTML = viewPortfolio();
    else if (tab === 'journal') v.innerHTML = viewJournal();
    else if (tab === 'calc') { v.innerHTML = viewCalc(); mountCalc(v); }
    else if (tab === 'watch') v.innerHTML = viewWatch();
    else if (tab === 'chart') { v.innerHTML = viewChart(); mountChart(v); }
  }

  function init() {
    $('.tabbar').addEventListener('click', e => {
      const b = e.target.closest('button[data-tab]');
      if (b) go(b.dataset.tab);
    });
    $('#btn-settings').addEventListener('click', openSettings);
    const view = $('#view');
    view.addEventListener('click', e => {
      const b = e.target.closest('[data-action]');
      if (!b || b.tagName === 'SELECT') return;
      const id = b.dataset.id;
      switch (b.dataset.action) {
        case 'new-trade': openTradeForm({ type: b.dataset.type }); break;
        case 'symbol': openSymbolSheet(id); break;
        case 'edit-trade': openTradeForm({ id }); break;
        case 'new-symbol': openSymbolForm(null, { watch: S.ui.tab === 'watch' }); break;
        case 'sample': loadSample(); break;
        case 'add-bar': openBarForm(S.ui.chartSymbol); break;
        case 'csv': openCsvSheet(S.ui.chartSymbol); break;
        case 'manage-bars': openManageBars(S.ui.chartSymbol); break;
        case 'apply-levels': applyLevels(S.ui.chartSymbol); break;
        case 'calc-add-row':
          if (view._calcRead) view._calcRead();
          if (calc.rows.length < 5) calc.rows.push({ p: '', q: '' });
          render(); break;
        case 'calc-del-row':
          if (view._calcRead) view._calcRead();
          if (calc.rows.length > 1) calc.rows.pop();
          render(); break;
      }
    });
    view.addEventListener('change', e => {
      const t = e.target;
      const a = t.dataset && t.dataset.action;
      if (a === 'journal-filter') { S.ui.journalFilter = t.value; save(); render(); }
      else if (a === 'chart-symbol') { S.ui.chartSymbol = t.value; save(); render(); }
      else if (a === 'calc-prefill') {
        if (t.value) prefillCalc(t.value);
        else Object.assign(calc, { sid: '', q0: '', a0: '', now: '', rows: [{ p: '', q: '' }], tq: '', ta: '', tp: '', tt: '', ga: '' });
        render();
      }
    });
    let rt;
    window.addEventListener('resize', () => { clearTimeout(rt); rt = setTimeout(() => chartRedraw && chartRedraw(), 120); });
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeSheet(); });
    window.matchMedia('(prefers-color-scheme: dark)').addEventListener('change', () => chartRedraw && chartRedraw());
    new MutationObserver(() => chartRedraw && chartRedraw()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
    render();
  }

  // 테스트용 노출
  window.StockNote = { parseBars, computeBook: () => computeBook(), get state() { return S; } };
  init();
})();
