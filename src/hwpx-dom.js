/*
 * HWPX 병합에 쓰는 DOM 유틸리티.
 *
 * 브라우저에서는 내장 DOMParser/XMLSerializer 를 쓰고,
 * Node 테스트에서는 tests/load.js 가 넣어 주는 CJ_DOM 을 쓴다.
 * querySelectorAll 은 구현체마다 지원 범위가 달라 쓰지 않고 직접 트리를 훑는다.
 */
(function (global) {
  'use strict';
  var CJ = (global.CJ = global.CJ || {});

  function DomParserCtor() {
    if (typeof global.DOMParser === 'function') return global.DOMParser;
    if (global.CJ_DOM && global.CJ_DOM.DOMParser) return global.CJ_DOM.DOMParser;
    return null;
  }

  function SerializerCtor() {
    if (typeof global.XMLSerializer === 'function') return global.XMLSerializer;
    if (global.CJ_DOM && global.CJ_DOM.XMLSerializer) return global.CJ_DOM.XMLSerializer;
    return null;
  }

  function available() {
    return !!(DomParserCtor() && SerializerCtor());
  }

  /** XML 문자열 → 문서. 실패하면 null */
  function parse(xml) {
    var P = DomParserCtor();
    if (!P || typeof xml !== 'string') return null;
    var doc;
    try {
      doc = new P().parseFromString(xml, 'text/xml');
    } catch (e) {
      return null;
    }
    if (!doc || !doc.documentElement) return null;
    // 브라우저 DOMParser 는 실패해도 예외 대신 parsererror 문서를 돌려준다
    if (doc.documentElement.localName === 'parsererror') return null;
    if (elementsByLocalName(doc.documentElement, 'parsererror').length) return null;
    return doc;
  }

  function serialize(doc) {
    var S = SerializerCtor();
    if (!S) return '';
    var body = new S().serializeToString(doc);
    if (body.indexOf('<?xml') !== 0) body = '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' + body;
    return body;
  }

  function rootOf(node) {
    return node && node.documentElement ? node.documentElement : node;
  }

  /** 하위 요소를 모두 훑는다 (자기 자신 제외) */
  function eachElement(node, fn) {
    var root = rootOf(node);
    if (!root) return;
    (function walk(n) {
      var kids = n.childNodes;
      if (!kids) return;
      for (var i = 0; i < kids.length; i++) {
        var c = kids[i];
        if (c.nodeType !== 1) continue;
        fn(c);
        walk(c);
      }
    })(root);
  }

  /** localName 이 같은 하위 요소 (이름공간 무관) */
  function elementsByLocalName(node, localName) {
    var out = [];
    var root = rootOf(node);
    if (root && root.localName === localName) out.push(root);
    eachElement(root, function (el) {
      if (el.localName === localName) out.push(el);
    });
    return out;
  }

  /** 직계 자식 중 localName 일치 */
  function childrenByLocalName(node, localName) {
    var out = [];
    var el = rootOf(node);
    if (!el || !el.childNodes) return out;
    for (var i = 0; i < el.childNodes.length; i++) {
      var c = el.childNodes[i];
      if (c.nodeType === 1 && c.localName === localName) out.push(c);
    }
    return out;
  }

  /**
   * 속성이 실제로 있는지.
   * 브라우저 DOM 은 없는 속성에 null 을, xmldom 은 빈 문자열을 돌려주므로 맞춰 준다.
   */
  function hasAttr(el, name) {
    if (!el) return false;
    if (typeof el.hasAttribute === 'function') return el.hasAttribute(name);
    var v = el.getAttribute ? el.getAttribute(name) : null;
    return v !== null && v !== undefined && v !== '';
  }

  /** 속성값 (없으면 null) */
  function attr(el, name) {
    return hasAttr(el, name) ? el.getAttribute(name) : null;
  }

  /** 특정 속성을 가진 하위 요소 (자기 자신 포함) */
  function elementsWithAttribute(node, attrName) {
    var out = [];
    var root = rootOf(node);
    if (root && hasAttr(root, attrName)) out.push(root);
    eachElement(root, function (el) {
      if (hasAttr(el, attrName)) out.push(el);
    });
    return out;
  }

  /** id 속성을 가진 요소들을 Map<id, element> 로 */
  function elementsById(doc, localName) {
    var map = new Map();
    elementsByLocalName(doc, localName).forEach(function (el) {
      var id = attr(el, 'id');
      if (id !== null) map.set(id, el);
    });
    return map;
  }

  /** 다음에 쓸 번호 (기존 최대값 + 1) */
  function nextId(map) {
    var max = -1;
    map.forEach(function (_, k) {
      var n = parseInt(k, 10);
      if (!isNaN(n) && n > max) max = n;
    });
    return max + 1;
  }

  /** 하위 요소들의 특정 속성값을 대응표에 따라 바꾼다 */
  function remapAttribute(node, attrName, idMap) {
    if (!idMap || !idMap.size) return;
    elementsWithAttribute(node, attrName).forEach(function (el) {
      var v = el.getAttribute(attrName);
      if (idMap.has(v)) el.setAttribute(attrName, String(idMap.get(v)));
    });
  }

  /** 태그 접두사 (hh:charPr → hh) */
  function prefixOf(el) {
    var name = el.tagName || el.nodeName || '';
    return name.indexOf(':') >= 0 ? name.split(':')[0] : '';
  }

  CJ.hdom = {
    available: available,
    hasAttr: hasAttr,
    attr: attr,
    parse: parse,
    serialize: serialize,
    eachElement: eachElement,
    elementsByLocalName: elementsByLocalName,
    childrenByLocalName: childrenByLocalName,
    elementsWithAttribute: elementsWithAttribute,
    elementsById: elementsById,
    nextId: nextId,
    remapAttribute: remapAttribute,
    prefixOf: prefixOf,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
