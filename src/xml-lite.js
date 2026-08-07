/*
 * 아주 작은 XML 파서.
 * HWPX(OWPML) 문서를 브라우저와 Node 테스트에서 동일하게 읽기 위해 사용한다.
 * 외부 라이브러리나 DOMParser 에 의존하지 않는다.
 */
(function (global) {
  'use strict';
  var CJ = (global.CJ = global.CJ || {});

  var ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

  function decodeEntities(s) {
    return String(s).replace(/&(#x?[0-9A-Fa-f]+|[A-Za-z]+);/g, function (all, body) {
      if (body.charAt(0) === '#') {
        var code =
          body.charAt(1) === 'x' || body.charAt(1) === 'X'
            ? parseInt(body.slice(2), 16)
            : parseInt(body.slice(1), 10);
        if (isNaN(code)) return all;
        try {
          return String.fromCodePoint(code);
        } catch (e) {
          return all;
        }
      }
      return ENTITIES[body] !== undefined ? ENTITIES[body] : all;
    });
  }

  function makeNode(name) {
    var local = name.indexOf(':') >= 0 ? name.split(':').pop() : name;
    return { name: name, local: local, attrs: {}, children: [], text: '' };
  }

  function parseAttrs(node, src) {
    var re = /([A-Za-z_:][\w:.\-]*)\s*=\s*("([^"]*)"|'([^']*)')/g;
    var m;
    while ((m = re.exec(src))) {
      var key = m[1];
      var val = m[3] !== undefined ? m[3] : m[4];
      node.attrs[key] = decodeEntities(val);
      var lk = key.indexOf(':') >= 0 ? key.split(':').pop() : key;
      if (node.attrs[lk] === undefined) node.attrs[lk] = node.attrs[key];
    }
  }

  /** XML 문자열을 트리로 변환한다. 실패하면 null 을 돌려준다. */
  function parse(xml) {
    if (typeof xml !== 'string') return null;
    var root = makeNode('#document');
    var stack = [root];
    var i = 0;
    var n = xml.length;
    var guard = 0;
    while (i < n) {
      if (guard++ > 5000000) return null;
      var lt = xml.indexOf('<', i);
      if (lt < 0) {
        appendText(stack[stack.length - 1], xml.slice(i));
        break;
      }
      if (lt > i) appendText(stack[stack.length - 1], xml.slice(i, lt));
      if (xml.substr(lt, 9) === '<![CDATA[') {
        var cend = xml.indexOf(']]>', lt);
        if (cend < 0) return null;
        appendRawText(stack[stack.length - 1], xml.slice(lt + 9, cend));
        i = cend + 3;
        continue;
      }
      if (xml.substr(lt, 4) === '<!--') {
        var mend = xml.indexOf('-->', lt);
        if (mend < 0) return null;
        i = mend + 3;
        continue;
      }
      if (xml.charAt(lt + 1) === '?' || xml.charAt(lt + 1) === '!') {
        var pend = xml.indexOf('>', lt);
        if (pend < 0) return null;
        i = pend + 1;
        continue;
      }
      var gt = xml.indexOf('>', lt);
      if (gt < 0) return null;
      var inner = xml.slice(lt + 1, gt);
      i = gt + 1;
      if (inner.charAt(0) === '/') {
        var closing = inner.slice(1).trim();
        for (var s = stack.length - 1; s > 0; s--) {
          if (stack[s].name === closing) {
            stack.length = s;
            break;
          }
        }
        continue;
      }
      var selfClose = inner.charAt(inner.length - 1) === '/';
      if (selfClose) inner = inner.slice(0, -1);
      var sp = inner.search(/[\s\/]/);
      var tagName = sp < 0 ? inner : inner.slice(0, sp);
      var node = makeNode(tagName.trim());
      if (sp >= 0) parseAttrs(node, inner.slice(sp));
      stack[stack.length - 1].children.push(node);
      if (!selfClose) stack.push(node);
    }
    return root;
  }

  function appendText(node, raw) {
    if (!raw) return;
    node.text += decodeEntities(raw);
  }
  function appendRawText(node, raw) {
    node.text += raw;
  }

  /** localName 이 일치하는 모든 하위 노드 (깊이 우선) */
  function findAll(node, local, out) {
    out = out || [];
    if (!node) return out;
    for (var i = 0; i < node.children.length; i++) {
      var c = node.children[i];
      if (c.local === local) out.push(c);
      findAll(c, local, out);
    }
    return out;
  }

  /** 직계 자식 중 localName 일치 */
  function childrenOf(node, local) {
    if (!node) return [];
    return node.children.filter(function (c) {
      return c.local === local;
    });
  }

  /** 하위 전체 텍스트 이어붙이기 */
  function textOf(node) {
    if (!node) return '';
    var buf = node.text || '';
    for (var i = 0; i < node.children.length; i++) buf += textOf(node.children[i]);
    return buf;
  }

  CJ.xml = { parse: parse, findAll: findAll, childrenOf: childrenOf, textOf: textOf, decodeEntities: decodeEntities };
})(typeof globalThis !== 'undefined' ? globalThis : this);
