/*
 * 실제 브라우저(Chromium)에서 배포본 HTML 을 열어 전체 흐름을 확인한다.
 *  - 파일 업로드 → 분석 → 취합 → 결과 다운로드
 *  - 외부 네트워크 요청이 한 번도 없는지 확인 (오프라인 동작)
 *  - 콘솔 오류가 없는지 확인
 *
 * 실행: node tests/browser-test.js
 */
'use strict';
const fs = require('fs');
const os = require('os');
const path = require('path');
const { chromium } = require('playwright');
const XLSX = require('xlsx');
const F = require('./fixtures');

const ROOT = path.resolve(__dirname, '..');
const DIST = path.join(ROOT, 'dist', '부서회신자료_자동취합기.html');

function check(cond, msg) {
  if (!cond) {
    console.log('  ✗ ' + msg);
    process.exitCode = 1;
    return false;
  }
  console.log('  ✓ ' + msg);
  return true;
}

async function main() {
  if (!fs.existsSync(DIST)) throw new Error('먼저 node build/build.js 를 실행하세요.');

  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'cj-samples-'));
  const samples = await F.buildSamples();
  // Playwright 의 파일 선택 API 는 한글 파일명을 그대로 넘기지 못하므로
  // 실제 사용 방식과 같은 끌어놓기(drag & drop) 로 파일을 전달한다.
  const payload = samples.map((s) => ({ name: s.name, b64: Buffer.from(s.data).toString('base64') }));

  // 설치된 Chromium 을 사용한다 (환경에 따라 경로가 다를 수 있음)
  const candidates = [
    process.env.CHROMIUM_PATH,
    '/opt/pw-browsers/chromium-1194/chrome-linux/chrome',
    '/opt/pw-browsers/chromium/chrome-linux/chrome',
  ].filter(Boolean);
  const executablePath = candidates.filter((p) => fs.existsSync(p))[0];
  const browser = await chromium.launch(executablePath ? { executablePath } : {});
  const context = await browser.newContext({ acceptDownloads: true });
  const page = await context.newPage();

  const consoleErrors = [];
  const networkRequests = [];
  page.on('console', (m) => {
    if (m.type() === 'error') consoleErrors.push(m.text());
  });
  page.on('pageerror', (e) => consoleErrors.push('pageerror: ' + e.message));
  page.on('request', (r) => {
    if (!r.url().startsWith('file://')) networkRequests.push(r.url());
  });
  // 인터넷이 끊긴 환경을 가정한다
  await context.route('**', (route) =>
    route.request().url().startsWith('file://') ? route.continue() : route.abort()
  );

  console.log('\n== 브라우저 실행 테스트 ==');
  await page.goto('file://' + DIST);
  await page.waitForSelector('#dropzone');

  check((await page.title()) === '부서 회신자료 자동취합기', '프로그램이 열린다');

  // 부서 관리 화면
  await page.click('#tab-depts');
  const deptRows = await page.locator('#dept-table tbody tr').count();
  check(deptRows === 75, '부서 관리 화면에 충주시 부서 75개가 보인다 (실제: ' + deptRows + ')');
  const firstDept = await page.locator('#dept-table tbody tr').first().locator('input[data-name]').inputValue();
  check(firstDept === '홍보담당관', '첫 번째 부서가 홍보담당관이다');

  // 자료 취합
  await page.click('#tab-collect');
  await page.evaluate((files) => {
    const dt = new DataTransfer();
    files.forEach((f) => {
      const bin = Uint8Array.from(atob(f.b64), (c) => c.charCodeAt(0));
      dt.items.add(new File([bin], f.name));
    });
    document
      .getElementById('dropzone')
      .dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt }));
  }, payload);
  await page.waitForFunction(() => document.getElementById('file-table').rows.length > 1);
  check(
    (await page.locator('#file-table tbody tr').count()) === samples.length,
    '한글 파일명 ' + samples.length + '개를 끌어놓기로 한 번에 올린다'
  );

  await page.click('#btn-analyze');
  await page.waitForSelector('#step-summary:not(.hidden)', { timeout: 60000 });
  await page.waitForSelector('#step-schema:not(.hidden)');

  const cards = await page.locator('#summary-cards .card').allTextContents();
  console.log('  · 요약: ' + cards.map((c) => c.replace(/\s+/g, ' ').trim()).join(' | '));
  check(cards.length === 7, '분석 요약 카드가 나온다');

  const firstRowDept = await page.locator('#file-table tbody tr').first().locator('select[data-dept]').inputValue();
  check(firstRowDept === '정보통신과', '파일명으로 부서를 판별한다');

  // 미확인 파일에 부서를 직접 지정
  const rows = page.locator('#file-table tbody tr');
  const n = await rows.count();
  let manualSet = false;
  for (let i = 0; i < n; i++) {
    const name = (await rows.nth(i).locator('td').nth(1).textContent()).trim();
    if (name === '부서미상.xlsx') {
      await rows.nth(i).locator('select[data-dept]').selectOption({ label: '4. 기획예산과' });
      manualSet = true;
      break;
    }
  }
  check(manualSet, '사용자가 부서를 직접 고를 수 있다');

  await page.click('#btn-aggregate');
  await page.waitForSelector('#step-preview:not(.hidden)');
  const previewCount = (await page.locator('#preview-count').textContent()).trim();
  console.log('  · ' + previewCount);
  check(/전체 \d+건/.test(previewCount), '취합 결과 미리보기가 나온다');

  // 검색 / 부서 필터
  await page.fill('#preview-search', '도로');
  await page.waitForTimeout(120);
  const filtered = await page.locator('#preview-table tbody tr').count();
  check(filtered > 0 && filtered < 100, '키워드 검색이 동작한다 (' + filtered + '행)');
  await page.fill('#preview-search', '');

  await page.check('#only-missing');
  const missing = await page.locator('#reply-table tbody tr').count();
  check(missing > 0, '미회신 부서 목록이 나온다 (' + missing + '개 부서)');
  await page.uncheck('#only-missing');

  // 다운로드
  // headless Chromium 은 한글 다운로드 파일명을 그대로 전달하지 않으므로
  // 프로그램이 만들어 내는 파일명은 화면 표시값으로 확인한다.
  const shownName = (await page.locator('#download-name').textContent()).replace('파일명: ', '').trim();
  check(/^부서회신자료_통합결과_\d{8}\.xlsx$/.test(shownName), '결과 파일명이 올바르다: ' + shownName);
  const [download] = await Promise.all([page.waitForEvent('download'), page.click('#btn-download')]);
  const outPath = path.join(tmp, 'result.xlsx');
  await download.saveAs(outPath);
  const wb = XLSX.read(fs.readFileSync(outPath), { type: 'buffer' });
  check(
    JSON.stringify(wb.SheetNames) === JSON.stringify(['통합자료', '회신현황', '파일별처리결과', '오류및경고']),
    '결과 엑셀에 4개 시트가 들어있다'
  );
  const merged = XLSX.utils.sheet_to_json(wb.Sheets['통합자료'], { header: 1, defval: '', raw: false });
  check(merged.length > 1, '통합자료에 데이터가 들어있다 (' + (merged.length - 1) + '행)');
  check(merged[0][0] === '부서명' && merged[0][1] === '원본파일명', '관리 컬럼이 맨 앞에 있다');
  const depts = merged.slice(1).map((r) => r[0]);
  check(depts.indexOf('기획예산과') === 0, '사용자가 고른 부서가 부서순서대로 맨 앞에 온다');
  check(depts[depts.length - 1] === '미확인', '미확인 자료가 맨 아래에 온다');

  // 부서 설정 저장 후 다시 열기
  await page.click('#tab-depts');
  await page.click('#btn-dept-add');
  await page.fill('#new-dept-name', '테스트임시과');
  await page.click('#btn-dept-add');
  await page.click('#btn-dept-save');
  await page.reload();
  await page.waitForSelector('#dropzone');
  await page.click('#tab-depts');
  await page.waitForSelector('#dept-table tbody tr');
  const afterReload = await page.locator('#dept-table tbody tr').count();
  check(afterReload === 76, '부서 설정이 다시 열어도 유지된다 (' + afterReload + '개)');
  const stored = await page.evaluate(() => localStorage.getItem('cj_reply_collector.settings.v1') || '');
  check(stored.indexOf('테스트임시과') > 0, '부서 설정만 저장된다');
  check(stored.indexOf('시설 1') < 0 && stored.indexOf('.xlsx') < 0, '회신자료 내용은 저장하지 않는다');

  check(networkRequests.length === 0, '외부 네트워크 요청이 없다' + (networkRequests.length ? ': ' + networkRequests.join(', ') : ''));
  check(consoleErrors.length === 0, '오류 없이 동작한다' + (consoleErrors.length ? ': ' + consoleErrors.join(' | ') : ''));

  await browser.close();
  fs.rmSync(tmp, { recursive: true, force: true });
  console.log(process.exitCode ? '\n브라우저 테스트 실패' : '\n브라우저 테스트 통과');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
