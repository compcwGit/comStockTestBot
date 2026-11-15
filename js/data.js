/* 외부 무료 API 연동 (브라우저에서 직접 호출 · 서버 없음)
 *  - 국내 주식/ETF 시세: 공공데이터포털 금융위원회 주식시세정보 / 증권상품시세정보 (전 영업일 종가, T+1)
 *  - 해외 주식/ETF 시세: Twelve Data
 *  - 해외 종목/시장 뉴스: Finnhub
 *  API 키는 이 기기에만 저장되고 백업 파일에는 포함되지 않음. */
(function (root) {
  'use strict';

  const KEY_STORE = 'stocknote.keys';
  const GOV = 'https://apis.data.go.kr/1160100/service/';
  const GOV_PATH = {
    stock: 'GetStockSecuritiesInfoService/getStockPriceInfo',
    etf: 'GetSecuritiesProductInfoService/getETFPriceInfo',
  };
  const TD = 'https://api.twelvedata.com/';
  const FH = 'https://finnhub.io/api/v1/';

  class ApiError extends Error {}

  function keys() {
    try { return JSON.parse(localStorage.getItem(KEY_STORE)) || {}; } catch (e) { return {}; }
  }
  function setKeys(k) {
    try { localStorage.setItem(KEY_STORE, JSON.stringify(k)); } catch (e) { /* 무시 */ }
  }

  const pad = n => String(n).padStart(2, '0');
  function ymd(d, sep = '') { return d.getFullYear() + sep + pad(d.getMonth() + 1) + sep + pad(d.getDate()); }
  function daysAgo(n, sep = '') { const d = new Date(); d.setDate(d.getDate() - n); return ymd(d, sep); }
  const num = x => { if (x == null || x === '') return null; const v = Number(String(x).replace(/,/g, '')); return Number.isFinite(v) ? v : null; };
  const pos = x => { const v = num(x); return v != null && v > 0 ? v : null; };

  let fetchImpl = (...a) => fetch(...a);

  async function getJSON(url) {
    const ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    const t = setTimeout(() => ctrl && ctrl.abort(), 15000);
    let res, txt;
    try {
      res = await fetchImpl(url, ctrl ? { signal: ctrl.signal } : {});
      txt = await res.text();
    } catch (e) {
      if (e && e.name === 'AbortError') throw new ApiError('응답 시간이 초과됐어요. 잠시 뒤 다시 시도하세요');
      throw new ApiError('서버에 연결하지 못했어요. 인터넷 연결을 확인하세요');
    } finally { clearTimeout(t); }
    try { return { status: res.status, json: JSON.parse(txt) }; }
    catch (e) { throw new ApiError(res.ok ? '응답 형식을 읽을 수 없어요' : `요청 실패 (HTTP ${res.status})`); }
  }

  // ───────── 공공데이터포털 (국내)
  function govKey(k) { k = String(k).trim(); return /%[0-9A-F]{2}/i.test(k) ? k : encodeURIComponent(k); }

  function govErr(code, msg) {
    switch (code) {
      case 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR':
        return '공공데이터포털 인증키가 등록되지 않았어요. 키를 확인하거나, 발급·활용신청 직후라면 1~2시간 뒤 다시 시도하세요';
      case 'SERVICE_ACCESS_DENIED_ERROR':
        return '이 서비스의 활용신청이 안 되어 있어요. 공공데이터포털에서 활용신청을 해주세요';
      case 'LIMITED_NUMBER_OF_SERVICE_REQUESTS_EXCEEDS_ERROR':
        return '공공데이터포털 하루 요청 한도를 넘었어요';
      default:
        return `공공데이터포털 오류: ${msg || code || '알 수 없음'}`;
    }
  }

  async function gov(kind, params, key) {
    if (!key) throw new ApiError('공공데이터포털 인증키를 설정에서 입력해 주세요');
    const q = Object.entries({ ...params, resultType: 'json' }).map(([a, b]) => `${a}=${encodeURIComponent(b)}`).join('&');
    const { json } = await getJSON(`${GOV}${GOV_PATH[kind]}?serviceKey=${govKey(key)}&${q}`);
    const err = json && json.OpenAPI_ServiceResponse;
    if (err) { const h = err.cmmMsgHeader || {}; throw new ApiError(govErr(h.errMsg, h.returnAuthMsg)); }
    const head = json && json.response && json.response.header;
    if (head && head.resultCode && head.resultCode !== '00') throw new ApiError(`공공데이터포털 오류: ${head.resultMsg || head.resultCode}`);
    const items = json && json.response && json.response.body && json.response.body.items;
    const it = items && items.item;
    if (!it) return [];
    return Array.isArray(it) ? it : [it];
  }

  function govBar(it) {
    const b = String(it.basDt || '');
    if (b.length !== 8) return null;
    const c = pos(it.clpr);
    if (!c) return null;
    let o = pos(it.mkp), h = pos(it.hipr), l = pos(it.lopr);
    if (o == null || h == null || l == null) o = h = l = null;
    return { d: `${b.slice(0, 4)}-${b.slice(4, 6)}-${b.slice(6, 8)}`, o, h, l, c, v: num(it.trqu) };
  }

  // 국내 종목 일별 시세. asset이 없으면 주식 → ETF 순으로 찾아봄
  async function krHistory(code, asset, key, days = 400) {
    code = String(code).trim();
    const kinds = asset === 'etf' ? ['etf', 'stock'] : ['stock', 'etf'];
    let lastErr = null;
    for (const kind of kinds) {
      try {
        const items = (await gov(kind, { likeSrtnCd: code, beginBasDt: daysAgo(days), numOfRows: 1000, pageNo: 1 }, key))
          .filter(x => String(x.srtnCd || '').replace(/^A/, '') === code);
        if (items.length) {
          const bars = items.map(govBar).filter(Boolean).sort((a, b) => a.d.localeCompare(b.d));
          return { kind, name: items[0].itmsNm || '', bars };
        }
      } catch (e) { lastErr = e; }
    }
    if (lastErr) throw lastErr;
    return { kind: null, name: '', bars: [] };
  }

  async function krSearch(text, key) {
    const params = { likeItmsNm: String(text).trim(), beginBasDt: daysAgo(10), numOfRows: 300, pageNo: 1 };
    const rs = await Promise.allSettled([gov('stock', params, key), gov('etf', params, key)]);
    if (rs.every(r => r.status === 'rejected')) throw rs[0].reason;
    const seen = new Map();
    rs.forEach((r, i) => {
      if (r.status !== 'fulfilled') return;
      for (const it of r.value) {
        const code = String(it.srtnCd || '').replace(/^A/, '');
        const prev = seen.get(code);
        if (!code || (prev && prev.basDt >= it.basDt)) continue;
        seen.set(code, { code, name: it.itmsNm, market: it.mrktCtg || (i ? 'ETF' : ''), asset: i ? 'etf' : 'stock', currency: 'KRW', price: pos(it.clpr), basDt: it.basDt });
      }
    });
    return Array.from(seen.values()).sort((a, b) => a.name.length - b.name.length).slice(0, 30);
  }

  // ───────── Twelve Data (해외)
  function tdErr(j) {
    const c = +j.code;
    if (c === 401 || c === 403) return 'Twelve Data 키를 확인하세요 (무료 플랜에서 지원하지 않는 종목일 수도 있어요)';
    if (c === 429) return 'Twelve Data 요청 한도를 넘었어요 (무료: 분당 8회, 하루 800회). 1분 뒤 다시 시도하세요';
    if (c === 404 || c === 400) return '종목을 찾을 수 없어요. 티커(예: AAPL, SPY)를 확인하세요';
    return `Twelve Data 오류: ${j.message || c}`;
  }

  async function td(path, params, key, needKey = true) {
    if (needKey && !key) throw new ApiError('Twelve Data API 키를 설정에서 입력해 주세요');
    const q = new URLSearchParams({ ...params, ...(key ? { apikey: String(key).trim() } : {}) });
    const { json } = await getJSON(`${TD}${path}?${q}`);
    if (!json || json.status === 'error' || (json.code && +json.code >= 400)) throw new ApiError(tdErr(json || {}));
    return json;
  }

  async function usHistory(symbol, key, size = 300) {
    const j = await td('time_series', { symbol: String(symbol).trim().toUpperCase(), interval: '1day', outputsize: size }, key);
    const bars = (j.values || []).map(v => {
      const c = pos(v.close);
      if (!c) return null;
      let o = pos(v.open), h = pos(v.high), l = pos(v.low);
      if (o == null || h == null || l == null) o = h = l = null;
      return { d: String(v.datetime).slice(0, 10), o, h, l, c, v: num(v.volume) };
    }).filter(Boolean).sort((a, b) => a.d.localeCompare(b.d));
    const type = j.meta && j.meta.type;
    return { kind: type === 'ETF' ? 'etf' : 'stock', name: '', bars, currency: j.meta && j.meta.currency };
  }

  async function usSearch(text, key) {
    const j = await td('symbol_search', { symbol: String(text).trim(), outputsize: 30 }, key, false);
    return (j.data || [])
      .filter(x => x.country === 'United States' && (x.instrument_type === 'ETF' || x.instrument_type === 'Common Stock'))
      .filter((x, i, arr) => arr.findIndex(y => y.symbol === x.symbol) === i)
      .map(x => ({ code: x.symbol, name: x.instrument_name, market: x.exchange, asset: x.instrument_type === 'ETF' ? 'etf' : 'stock', currency: 'USD' }))
      .slice(0, 20);
  }

  // ───────── Finnhub (해외 뉴스)
  async function fh(path, params, key) {
    if (!key) throw new ApiError('Finnhub API 키를 설정에서 입력해 주세요');
    const q = new URLSearchParams({ ...params, token: String(key).trim() });
    const { status, json } = await getJSON(`${FH}${path}?${q}`);
    if (status === 401 || status === 403 || (json && json.error)) throw new ApiError('Finnhub 키를 확인하세요');
    if (status === 429) throw new ApiError('Finnhub 요청 한도를 넘었어요. 1분 뒤 다시 시도하세요');
    if (!Array.isArray(json)) throw new ApiError('Finnhub 응답을 읽을 수 없어요');
    return json;
  }
  const newsItem = x => ({ title: x.headline, url: x.url, source: x.source, time: (x.datetime || 0) * 1000, summary: x.summary || '' });

  async function usNews(symbol, key) {
    const j = await fh('company-news', { symbol: String(symbol).trim().toUpperCase(), from: daysAgo(14, '-'), to: daysAgo(0, '-') }, key);
    return j.filter(x => x.headline && /^https?:/.test(x.url || '')).slice(0, 15).map(newsItem);
  }
  async function marketNews(key) {
    const j = await fh('news', { category: 'general' }, key);
    return j.filter(x => x.headline && /^https?:/.test(x.url || '')).slice(0, 15).map(newsItem);
  }

  // ───────── 키 없이 쓰는 바로가기 (공시·뉴스)
  function links(s) {
    const e = encodeURIComponent, out = [];
    const code = (s.code || '').trim();
    if (s.currency === 'KRW') {
      if (/^[0-9A-Z]{6}$/.test(code)) {
        out.push(['네이버증권', `https://m.stock.naver.com/domestic/stock/${e(code)}/total`]);
        out.push(['종목 뉴스', `https://m.stock.naver.com/domestic/stock/${e(code)}/news`]);
      }
      if (s.asset !== 'etf') out.push(['DART 공시', `https://dart.fss.or.kr/dsab007/main.do?option=corp&textCrpNm=${e(s.name)}`]);
    } else if (code) {
      out.push(['Yahoo Finance', `https://finance.yahoo.com/quote/${e(code)}`]);
      out.push(['종목 뉴스', `https://finance.yahoo.com/quote/${e(code)}/news`]);
      if (s.asset !== 'etf') out.push(['SEC 공시', `https://www.sec.gov/cgi-bin/browse-edgar?action=getcompany&CIK=${e(code)}&owner=include&count=40`]);
    }
    out.push(['구글 뉴스', `https://news.google.com/search?q=${e(s.name + (s.asset === 'etf' ? ' ETF' : ' 주가'))}&hl=ko&gl=KR&ceid=KR:ko`]);
    return out;
  }

  // 종목 최신 시세/일봉 가져오기 → { bars, kind, name }
  async function history(s, full) {
    const k = keys();
    const code = (s.code || '').trim();
    if (!code) throw new ApiError('종목코드(국내 6자리 / 해외 티커)를 먼저 입력해 주세요');
    const fresh = full || !(s.history && s.history.length > 20);
    if (s.currency === 'KRW') return krHistory(code, s.asset, k.gov, fresh ? 400 : 20);
    return usHistory(code, k.td, fresh ? 300 : 5);
  }

  function search(text, currency) {
    const k = keys();
    return currency === 'KRW' ? krSearch(text, k.gov) : usSearch(text, k.td);
  }

  const api = { ApiError, keys, setKeys, krHistory, krSearch, usHistory, usSearch, usNews, marketNews, links, history, search, govBar, _setFetch: f => { fetchImpl = f; } };
  root.Data = api;
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
