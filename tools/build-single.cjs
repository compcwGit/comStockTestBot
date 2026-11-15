/* 모든 파일을 HTML 하나로 합친다 (claude.ai 미리보기 페이지용).
 * 사용: node tools/build-single.cjs <출력경로> */
const fs = require('fs');
const path = require('path');
const ROOT = path.join(__dirname, '..');
const read = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const out = process.argv[2] || path.join(ROOT, 'dist', 'stocknote.html');

const html = read('index.html');
const body = html.slice(html.indexOf('<body>') + 6, html.indexOf('<script src='));
const js = ['js/indicators.js', 'js/chart.js', 'js/data.js', 'js/app.js'].map(read).join('\n');
if (/<\/script/i.test(js)) throw new Error('JS에 </script 문자열이 있어 인라인할 수 없음');

// 미리보기 페이지에서는 상단 안전영역을 페이지가 이미 비워주므로 헤더 여백을 조정
const overrides = `
.topbar { top: env(safe-area-inset-top, 0px); padding-top: 10px; }
body::before { content: ""; position: fixed; inset: 0 0 auto; height: env(safe-area-inset-top, 0px); z-index: 11; background: var(--bg); }
body { background: var(--bg); }
#ex-file { display: none; }`;

const page = `<title>주식노트</title>
<meta name="claude:viewport-fit-sides" content="cover">
<style>
${read('style.css')}
${overrides}
</style>
${body.trim()}
<script>
${js}
</script>
`;
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, page);
console.log(`${out} (${(page.length / 1024).toFixed(1)}KB)`);
