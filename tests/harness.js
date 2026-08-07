/* 아주 작은 테스트 러너 (외부 의존성 없음) */
'use strict';

const tests = [];
let currentGroup = '';

function group(name) {
  currentGroup = name;
}

function test(name, fn) {
  tests.push({ group: currentGroup, name, fn });
}

function fail(message) {
  throw new Error(message);
}

const assert = {
  ok(v, msg) {
    if (!v) fail(msg || '참이어야 합니다. (실제: ' + JSON.stringify(v) + ')');
  },
  equal(a, b, msg) {
    if (a !== b) fail((msg ? msg + ' — ' : '') + '기대: ' + JSON.stringify(b) + ' / 실제: ' + JSON.stringify(a));
  },
  deepEqual(a, b, msg) {
    const sa = JSON.stringify(a);
    const sb = JSON.stringify(b);
    if (sa !== sb) fail((msg ? msg + ' — ' : '') + '기대: ' + sb + ' / 실제: ' + sa);
  },
  includes(arr, v, msg) {
    if (!Array.isArray(arr) || arr.indexOf(v) < 0)
      fail((msg ? msg + ' — ' : '') + JSON.stringify(v) + ' 가 ' + JSON.stringify(arr) + ' 에 없습니다.');
  },
};

async function run() {
  let pass = 0;
  const failures = [];
  let lastGroup = null;
  for (const t of tests) {
    if (t.group !== lastGroup) {
      lastGroup = t.group;
      console.log('\n== ' + t.group + ' ==');
    }
    try {
      await t.fn();
      pass++;
      console.log('  ✓ ' + t.name);
    } catch (e) {
      failures.push({ t, e });
      console.log('  ✗ ' + t.name + '\n      ' + (e && e.message ? e.message : e));
    }
  }
  console.log('\n----------------------------------------');
  console.log('통과 ' + pass + ' / 전체 ' + tests.length);
  if (failures.length) {
    console.log('실패 ' + failures.length + '건');
    process.exitCode = 1;
  } else {
    console.log('모든 테스트 통과');
  }
}

module.exports = { group, test, assert, run };
