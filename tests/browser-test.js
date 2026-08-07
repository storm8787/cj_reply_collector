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
const JSZip = require('jszip');
const { PDFDocument } = require('pdf-lib');
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
  check(deptRows === 76, '부서 관리 화면에 부서 76개가 보인다 (실제: ' + deptRows + ')');
  const firstDept = await page.locator('#dept-table tbody tr').first().locator('input[data-name]').inputValue();
  check(firstDept === '홍보담당관', '첫 번째 부서가 홍보담당관이다');
  const lastDept = await page.locator('#dept-table tbody tr').last().locator('input[data-name]').inputValue();
  check(lastDept === '의회사무국', '마지막 76번 부서가 의회사무국이다');

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
  check(cards.length === 8, '분석 요약 카드가 나온다 (PDF 쪽수 포함)');

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
  // ---------- 단계 5: 결과 파일 ----------
  const planText = (await page.locator('#download-list').textContent()).replace(/\s+/g, ' ');
  console.log('  · 만들어질 파일: ' + planText.replace('만들어질 파일', '').trim());
  check(/한글 취합본/.test(planText) && /PDF 취합본/.test(planText), '자료 종류에 맞는 결과물을 안내한다');

  await page.click('#btn-build');
  await page.waitForSelector('#download-list table', { timeout: 60000 });
  const outRows = page.locator('#download-list tbody tr');
  const outCount = await outRows.count();
  check(outCount === 4, '결과 파일 4개가 만들어진다 (실제: ' + outCount + ')');
  const outNames = [];
  for (let i = 0; i < outCount; i++) {
    outNames.push((await outRows.nth(i).locator('td').nth(1).textContent()).trim());
  }
  console.log('  · ' + outNames.join(' | '));
  check(/^부서회신자료_통합결과_\d{8}\.xlsx$/.test(outNames[0]), '회신현황 리포트 파일명');
  check(/^부서회신자료_PDF취합본_\d{8}\.pdf$/.test(outNames[1]), 'PDF 취합본 파일명');
  check(/^부서회신자료_한글취합본_\d{8}\.hwpx$/.test(outNames[2]), '한글 취합본 파일명');
  check(/^부서회신자료_한글원본_\d{8}\.zip$/.test(outNames[3]), '원본 한글파일 묶음 파일명');

  // 실제로 내려받아 내용을 확인한다
  const saved = {};
  for (let i = 0; i < outCount; i++) {
    const [dl] = await Promise.all([
      page.waitForEvent('download'),
      outRows.nth(i).locator('button[data-dl]').click(),
    ]);
    const target = path.join(tmp, 'out' + i + path.extname(outNames[i]));
    await dl.saveAs(target);
    saved[outNames[i].replace(/_\d{8}\./, '.')] = target;
  }

  const outPath = saved['부서회신자료_통합결과.xlsx'];
  const wb = XLSX.read(fs.readFileSync(outPath), { type: 'buffer' });
  check(
    JSON.stringify(wb.SheetNames) ===
      JSON.stringify(['통합자료', '회신현황', '파일별처리결과', '오류및경고', '취합순서']),
    '결과 엑셀 시트 구성: ' + wb.SheetNames.join(', ')
  );
  const merged = XLSX.utils.sheet_to_json(wb.Sheets['통합자료'], { header: 1, defval: '', raw: false });
  check(merged.length > 1, '통합자료에 데이터가 들어있다 (' + (merged.length - 1) + '행)');
  check(merged[0][0] === '부서명' && merged[0][1] === '원본파일명', '관리 컬럼이 맨 앞에 있다');
  const depts = merged.slice(1).map((r) => r[0]);
  check(depts.indexOf('기획예산과') === 0, '사용자가 고른 부서가 부서순서대로 맨 앞에 온다');
  check(depts[depts.length - 1] === '미확인', '미확인 자료가 맨 아래에 온다');
  const orderSheet = XLSX.utils.sheet_to_json(wb.Sheets['취합순서'], { header: 1, defval: '', raw: false });
  check(orderSheet.length === 5, '취합순서에 한글 2건 + PDF 2건이 적혀 있다');

  const pdfBytes = fs.readFileSync(saved['부서회신자료_PDF취합본.pdf']);
  const mergedPdf = await PDFDocument.load(pdfBytes);
  check(mergedPdf.getPageCount() === 3, 'PDF 취합본 쪽수 (실제: ' + mergedPdf.getPageCount() + ')');

  const hwpxBytes = fs.readFileSync(saved['부서회신자료_한글취합본.hwpx']);
  const hzip = await JSZip.loadAsync(hwpxBytes);
  check(
    !!hzip.file('Contents/section0.xml') && !!hzip.file('Contents/header.xml'),
    '한글 취합본이 HWPX 구조를 갖췄다'
  );
  const secNames = Object.keys(hzip.files).filter((n) => /^Contents\/section\d+\.xml$/.test(n)).sort();
  check(secNames.length === 1, '구역 파일을 새로 만들지 않는다 (' + secNames.length + ')');
  let allSec = '';
  for (const n of secNames) allSec += await hzip.file(n).async('string');
  check(allSec.indexOf('도로과') > 0 && allSec.indexOf('건축과') > 0, '한글 취합본에 부서별 내용이 들어있다');
  check(allSec.indexOf('도로-001') > 0, '원본 표 내용이 들어있다');
  check(!/통합본/.test(allSec), '프로그램이 만든 문서 제목이 없다');
  check(!/자료제출\.hwpx/.test(allSec), '원본 파일명이 본문에 나오지 않는다');
  // Base 문서의 번호표가 그대로 남고 뒤 문서 서식만 덧붙었는지
  const mergedHeader = await hzip.file('Contents/header.xml').async('string');
  check(/charPr[^>]*id="8"/.test(mergedHeader), 'Base 문서의 서식 번호가 그대로 유지된다');
  check(mergedHeader.indexOf('맑은 고딕') > 0, '원본 글꼴 정의가 살아있다');
  check(/pageBreak="1"/.test(allSec), '문서 경계에 쪽 나눔이 들어갔다');

  const zipBytes = fs.readFileSync(saved['부서회신자료_한글원본.zip']);
  const ozip = await JSZip.loadAsync(zipBytes);
  const zipNames = Object.keys(ozip.files).sort();
  check(zipNames.length === 3, '원본 묶음에 원본 2개 + 안내 1개');
  check(zipNames[1] === '01_도로과_자료제출.hwpx', '원본이 부서순서대로 번호가 붙는다');

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
  check(afterReload === 77, '부서 설정이 다시 열어도 유지된다 (' + afterReload + '개)');
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
