const test = require('node:test');
const assert = require('node:assert/strict');
const Data = require('../js/data.js');

// 공공데이터포털 응답 형식 (금융위원회 주식시세정보)
const govOk = items => ({ response: { header: { resultCode: '00', resultMsg: 'NORMAL SERVICE.' }, body: { numOfRows: 1000, pageNo: 1, totalCount: items.length, items: { item: items } } } });
const krRow = (basDt, clpr, extra = {}) => ({ basDt, srtnCd: '005930', isinCd: 'KR7005930003', itmsNm: '삼성전자', mrktCtg: 'KOSPI', clpr: String(clpr), vs: '100', fltRt: '.14', mkp: String(clpr - 100), hipr: String(clpr + 300), lopr: String(clpr - 400), trqu: '12345678', ...extra });

function mockFetch(handler) {
  const calls = [];
  Data._setFetch(async url => {
    calls.push(url);
    const { status = 200, body } = await handler(url);
    return { ok: status < 400, status, text: async () => (typeof body === 'string' ? body : JSON.stringify(body)) };
  });
  return calls;
}

test('krHistory parses and sorts gov rows, filters exact code', async () => {
  const calls = mockFetch(() => ({
    body: govOk([krRow('20261113', 71500), krRow('20261112', 71000), { ...krRow('20261113', 999), srtnCd: '0059300' }]),
  }));
  const r = await Data.krHistory('005930', 'stock', 'abc+def/==', 30);
  assert.equal(r.kind, 'stock');
  assert.equal(r.name, '삼성전자');
  assert.deepEqual(r.bars.map(b => b.d), ['2026-11-12', '2026-11-13']);
  assert.equal(r.bars[1].c, 71500);
  assert.equal(r.bars[1].h, 71800);
  assert.match(calls[0], /GetStockSecuritiesInfoService\/getStockPriceInfo\?serviceKey=abc%2Bdef%2F%3D%3D&/);
  assert.match(calls[0], /likeSrtnCd=005930/);
  assert.match(calls[0], /resultType=json/);
});

test('krHistory falls back to ETF endpoint and single item object', async () => {
  mockFetch(url => url.includes('getETFPriceInfo')
    ? { body: govOk({ ...krRow('20261113', 35000), srtnCd: '069500', itmsNm: 'KODEX 200' }) }
    : { body: govOk([]) });
  const r = await Data.krHistory('069500', 'stock', 'k', 30);
  assert.equal(r.kind, 'etf');
  assert.equal(r.bars.length, 1);
});

test('already URL-encoded gov key is not double-encoded', async () => {
  const calls = mockFetch(() => ({ body: govOk([]) }));
  await Data.krHistory('005930', 'stock', 'abc%2Bdef', 5);
  assert.match(calls[0], /serviceKey=abc%2Bdef&/);
});

test('gov errors map to Korean messages', async () => {
  mockFetch(() => ({ status: 403, body: { OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: 'SERVICE_KEY_IS_NOT_REGISTERED_ERROR', returnAuthMsg: 'x', returnReasonCode: '30' } } } }));
  await assert.rejects(Data.krHistory('005930', 'stock', 'bad', 5), /인증키가 등록되지 않았어요/);
  await assert.rejects(Data.krHistory('005930', 'stock', '', 5), /인증키를 설정에서/);
});

test('network failure gives readable error', async () => {
  Data._setFetch(async () => { throw new TypeError('Load failed'); });
  await assert.rejects(Data.usHistory('AAPL', 'k', 5), /인터넷 연결/);
});

test('usHistory parses Twelve Data time_series (real response shape)', async () => {
  mockFetch(() => ({ body: {"meta":{"symbol":"SPY","interval":"1day","currency":"USD","exchange_timezone":"America/New_York","exchange":"NYSE","mic_code":"ARCX","type":"ETF"},"values":[{"datetime":"2026-11-13","open":"357.95999","high":"360.82999","low":"355.75","close":"356.26999","volume":"39985300"},{"datetime":"2026-11-12","open":"357.81000","high":"359.37000","low":"354.41000","close":"354.88000","volume":"31875000"}],"status":"ok"} }));
  const r = await Data.usHistory('spy', 'k', 2);
  assert.equal(r.kind, 'etf');
  assert.deepEqual(r.bars.map(b => b.d), ['2026-11-12', '2026-11-13']);
  assert.equal(r.bars[1].c, 356.26999);
  assert.equal(r.bars[1].v, 39985300);
});

test('Twelve Data errors map to messages', async () => {
  mockFetch(() => ({ body: { code: 429, message: 'limit', status: 'error' } }));
  await assert.rejects(Data.usHistory('AAPL', 'k', 2), /한도/);
  mockFetch(() => ({ body: { code: 401, message: 'bad key', status: 'error' } }));
  await assert.rejects(Data.usHistory('AAPL', 'k', 2), /키를 확인/);
});

test('usSearch keeps US stocks/ETFs only', async () => {
  mockFetch(() => ({ body: { data: [
    { symbol: 'SPY', instrument_name: 'SPDR S&P 500', exchange: 'NYSE', instrument_type: 'ETF', country: 'United States', currency: 'USD' },
    { symbol: 'SPY', instrument_name: 'CEDEAR', exchange: 'BCBA', instrument_type: 'ETF', country: 'Argentina', currency: 'ARS' },
    { symbol: 'AAPL', instrument_name: 'Apple Inc', exchange: 'NASDAQ', instrument_type: 'Common Stock', country: 'United States', currency: 'USD' },
  ], status: 'ok' } }));
  const r = await Data.usSearch('S', '');
  assert.deepEqual(r.map(x => [x.code, x.asset]), [['SPY', 'etf'], ['AAPL', 'stock']]);
});

test('krSearch merges stock + ETF results and tolerates one failing', async () => {
  mockFetch(url => url.includes('getETFPriceInfo')
    ? { status: 403, body: { OpenAPI_ServiceResponse: { cmmMsgHeader: { errMsg: 'SERVICE_ACCESS_DENIED_ERROR' } } } }
    : { body: govOk([krRow('20261112', 71000), krRow('20261113', 71500)]) });
  const r = await Data.krSearch('삼성', 'k');
  assert.equal(r.length, 1);
  assert.equal(r[0].code, '005930');
  assert.equal(r[0].price, 71500);
});

test('Finnhub news parsing and bad key', async () => {
  mockFetch(() => ({ body: [{ headline: 'Apple beats', url: 'https://ex.com/a', source: 'Reuters', datetime: 1794500000, summary: '' }, { headline: 'x', url: 'javascript:alert(1)' }] }));
  const n = await Data.usNews('AAPL', 'k');
  assert.equal(n.length, 1);
  assert.equal(n[0].title, 'Apple beats');
  mockFetch(() => ({ status: 401, body: { error: 'Invalid API key.' } }));
  await assert.rejects(Data.marketNews('bad'), /Finnhub 키/);
});

test('links for KR stock, KR ETF, US', () => {
  const kr = Data.links({ currency: 'KRW', code: '005930', name: '삼성전자', asset: 'stock' }).map(x => x[0]);
  assert.ok(kr.includes('DART 공시') && kr.includes('네이버증권'));
  const etf = Data.links({ currency: 'KRW', code: '069500', name: 'KODEX 200', asset: 'etf' }).map(x => x[0]);
  assert.ok(!etf.includes('DART 공시'));
  const us = Data.links({ currency: 'USD', code: 'AAPL', name: 'Apple', asset: 'stock' }).map(x => x[0]);
  assert.ok(us.includes('SEC 공시'));
});
