/*
 * HWPX(한글 문서) 취합본의 뼈대 만들기.
 * 취합본에 공통으로 들어가는 기본 번호표(글꼴·글자모양·문단모양·테두리)와
 * 포장 파일(version.xml, container.xml, content.hpf, manifest.xml)을 만든다.
 *
 * 실제 문서 합치기는 hwpx-merger.js 가 담당하며, 원본의 번호표를 여기에 덧붙여
 * 원본 서식을 살린다. 서식 정보를 가져올 수 없는 원본(hwp 바이너리)만
 * plainBody() 로 내용을 다시 그린다.
 */
(function (global) {
  'use strict';
  var CJ = (global.CJ = global.CJ || {});
  var T = CJ.text;

  var NS_HEAD = 'http://www.hancom.co.kr/hwpml/2011/head';
  var NS_SEC = 'http://www.hancom.co.kr/hwpml/2011/section';
  var NS_PARA = 'http://www.hancom.co.kr/hwpml/2011/paragraph';
  var NS_CORE = 'http://www.hancom.co.kr/hwpml/2011/core';

  // A4 세로. 단위는 HWPUNIT(1/7200 인치).
  var PAGE_WIDTH = 59528;
  var MARGIN_LEFT = 8504;
  var MARGIN_RIGHT = 8504;
  var TEXT_WIDTH = PAGE_WIDTH - MARGIN_LEFT - MARGIN_RIGHT;
  var ROW_HEIGHT = 2000;

  var LANGS = ['HANGUL', 'LATIN', 'HANJA', 'JAPANESE', 'OTHER', 'SYMBOL', 'USER'];

  function esc(v) {
    return String(v == null ? '' : v)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      // XML 에 넣을 수 없는 제어문자 제거 (탭\t 과 줄바꿈은 앞서 공백으로 정리됨)
      .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F]/g, '');
  }

  function xmlHead() {
    return '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n';
  }

  function versionXml() {
    return (
      xmlHead() +
      '<hv:HCFVersion xmlns:hv="http://www.hancom.co.kr/hwpml/2011/version"' +
      ' tagetApplication="WORDPROCESSOR" major="5" minor="0" micro="5" buildNumber="0"' +
      ' os="1" xmlVersion="1.4" application="부서 회신자료 자동취합기" appVersion="1.0"/>'
    );
  }

  function containerXml() {
    return (
      xmlHead() +
      '<ocf:container xmlns:ocf="urn:oasis:names:tc:opendocument:xmlns:container"' +
      ' xmlns:hpf="http://www.hancom.co.kr/schema/2011/hpf">' +
      '<ocf:rootfiles>' +
      '<ocf:rootfile full-path="Contents/content.hpf" media-type="application/hwpml-package+xml"/>' +
      '</ocf:rootfiles></ocf:container>'
    );
  }

  function manifestXml(sectionCount, binItems) {
    var count = sectionCount || 1;
    var entries = '';
    for (var i = 0; i < count; i++) {
      entries += '<odf:file-entry odf:full-path="Contents/section' + i + '.xml" odf:media-type="application/xml"/>';
    }
    (binItems || []).forEach(function (b) {
      entries += '<odf:file-entry odf:full-path="' + esc(b.href) + '" odf:media-type="' + esc(b.media) + '"/>';
    });
    return (
      xmlHead() +
      '<odf:manifest xmlns:odf="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" version="1.2">' +
      '<odf:file-entry odf:full-path="/" odf:media-type="application/hwp+zip"/>' +
      '<odf:file-entry odf:full-path="Contents/header.xml" odf:media-type="application/xml"/>' +
      entries +
      '</odf:manifest>'
    );
  }

  function contentHpf(title, sectionCount, binItems) {
    var count = sectionCount || 1;
    var items = '';
    var spine = '';
    for (var i = 0; i < count; i++) {
      items += '<opf:item id="section' + i + '" href="Contents/section' + i + '.xml" media-type="application/xml"/>';
      spine += '<opf:itemref idref="section' + i + '" linear="yes"/>';
    }
    (binItems || []).forEach(function (b) {
      items += '<opf:item id="' + esc(b.id) + '" href="' + esc(b.href) + '" media-type="' + esc(b.media) + '"/>';
    });
    return (
      xmlHead() +
      '<opf:package xmlns:opf="http://www.idpf.org/2007/opf/"' +
      ' xmlns:ha="http://www.hancom.co.kr/hwpml/2011/app"' +
      ' xmlns:dc="http://purl.org/dc/elements/1.1/"' +
      ' version="" unique-identifier="" id="">' +
      '<opf:metadata>' +
      '<opf:title>' + esc(title) + '</opf:title>' +
      '<opf:language>ko</opf:language>' +
      '</opf:metadata>' +
      '<opf:manifest>' +
      '<opf:item id="header" href="Contents/header.xml" media-type="application/xml"/>' +
      items +
      '</opf:manifest>' +
      '<opf:spine>' +
      '<opf:itemref idref="header" linear="yes"/>' +
      spine +
      '</opf:spine>' +
      '</opf:package>'
    );
  }

  function fontEntry(id) {
    return (
      '<hh:font id="' + id + '" face="함초롬바탕" type="TTF" isEmbedded="0">' +
      '<hh:typeInfo familyType="FCAT_UNKNOWN" weight="0" proportion="0" contrast="0"' +
      ' strokeVariation="0" armStyle="0" letterform="0" midline="0" xHeight="0"/>' +
      '</hh:font>'
    );
  }

  function fontface(lang) {
    return '<hh:fontface lang="' + lang + '" fontCnt="1">' + fontEntry(0) + '</hh:fontface>';
  }

  function borderFillEntry(id, solid) {
    var type = solid ? 'SOLID' : 'NONE';
    var side = function (name) {
      return '<hh:' + name + ' type="' + type + '" width="0.12 mm" color="#000000"/>';
    };
    return (
      '<hh:borderFill id="' + id + '" threeD="0" shadow="0" centerLine="NONE" breakCellSeparateLine="0">' +
      '<hh:slash type="NONE" Crooked="0" isCounter="0"/>' +
      '<hh:backSlash type="NONE" Crooked="0" isCounter="0"/>' +
      side('leftBorder') + side('rightBorder') + side('topBorder') + side('bottomBorder') +
      '<hh:diagonal type="NONE" width="0.1 mm" color="#000000"/>' +
      '</hh:borderFill>'
    );
  }

  function langAttrs(name, value) {
    return (
      '<hh:' + name + ' ' +
      LANGS.map(function (l) {
        return l.toLowerCase() + '="' + value + '"';
      }).join(' ') +
      '/>'
    );
  }

  function charPr(id, height, bold) {
    return (
      '<hh:charPr id="' + id + '" height="' + height + '" textColor="#000000" shadeColor="none"' +
      ' useFontSpace="0" useKerning="0" symMark="NONE" borderFillIDRef="1">' +
      langAttrs('fontRef', 0) +
      langAttrs('ratio', 100) +
      langAttrs('spacing', 0) +
      langAttrs('relSz', 100) +
      langAttrs('offset', 0) +
      (bold ? '<hh:bold/>' : '') +
      '</hh:charPr>'
    );
  }

  function paraPr(id, align) {
    return (
      '<hh:paraPr id="' + id + '" tabPrIDRef="0" condense="0" fontLineHeight="0" snapToGrid="1"' +
      ' suppressLineNumbers="0" checked="0">' +
      '<hh:align horizontal="' + align + '" vertical="BASELINE"/>' +
      '<hh:heading type="NONE" idRef="0" level="0"/>' +
      '<hh:breakSetting breakLatinWord="KEEP_WORD" breakNonLatinWord="BREAK_WORD" widowOrphan="0"' +
      ' keepWithNext="0" keepLines="0" pageBreakBefore="0" lineWrap="BREAK"/>' +
      '<hh:autoSpacing eAsianEng="0" eAsianNum="0"/>' +
      '<hh:margin>' +
      '<hc:intent value="0" unit="HWPUNIT"/>' +
      '<hc:left value="0" unit="HWPUNIT"/>' +
      '<hc:right value="0" unit="HWPUNIT"/>' +
      '<hc:prev value="0" unit="HWPUNIT"/>' +
      '<hc:next value="0" unit="HWPUNIT"/>' +
      '</hh:margin>' +
      '<hh:lineSpacing type="PERCENT" value="160" unit="HWPUNIT"/>' +
      '<hh:border borderFillIDRef="1" offsetLeft="0" offsetRight="0" offsetTop="0" offsetBottom="0"' +
      ' connect="0" ignoreMargin="0"/>' +
      '</hh:paraPr>'
    );
  }

  /** 취합본의 기본 번호표. merger 가 여기에 원본 문서의 항목을 덧붙인다. */
  function baseRefList() {
    var fonts = {};
    LANGS.forEach(function (lang) {
      fonts[lang] = [{ id: 0, xml: fontEntry(0) }];
    });
    return {
      fonts: fonts,
      borderFills: [
        { id: 0, xml: borderFillEntry(0, false) },
        { id: 1, xml: borderFillEntry(1, false) },
        { id: 2, xml: borderFillEntry(2, true) },
      ],
      charPrs: [
        { id: 0, xml: charPr(0, 1000, false) },
        { id: 1, xml: charPr(1, 1100, true) },
      ],
      tabPrs: [{ id: 0, xml: '<hh:tabPr id="0" autoTabLeft="0" autoTabRight="0"/>' }],
      paraPrs: [
        { id: 0, xml: paraPr(0, 'JUSTIFY') },
        { id: 1, xml: paraPr(1, 'LEFT') },
      ],
      styles: [
        {
          id: 0,
          xml:
            '<hh:style id="0" type="PARA" name="바탕글" engName="Normal" paraPrIDRef="0" charPrIDRef="0"' +
            ' nextStyleIDRef="0" langID="1042" lockForm="0"/>',
        },
      ],
    };
  }

  function headerXml() {
    return (
      xmlHead() +
      '<hh:head xmlns:hh="' + NS_HEAD + '" xmlns:hp="' + NS_PARA + '" xmlns:hc="' + NS_CORE + '"' +
      ' version="1.4" secCnt="1">' +
      '<hh:beginNum page="1" footnote="1" endnote="1" pic="1" tbl="1" equation="1"/>' +
      '<hh:refList>' +
      '<hh:fontfaces itemCnt="' + LANGS.length + '">' +
      LANGS.map(fontface).join('') +
      '</hh:fontfaces>' +
      '<hh:borderFills itemCnt="3">' + borderFillEntry(0, false) + borderFillEntry(1, false) +
      borderFillEntry(2, true) + '</hh:borderFills>' +
      '<hh:charProperties itemCnt="2">' + charPr(0, 1000, false) + charPr(1, 1100, true) + '</hh:charProperties>' +
      '<hh:tabProperties itemCnt="1"><hh:tabPr id="0" autoTabLeft="0" autoTabRight="0"/></hh:tabProperties>' +
      '<hh:numberings itemCnt="0"/>' +
      '<hh:paraProperties itemCnt="2">' + paraPr(0, 'JUSTIFY') + paraPr(1, 'LEFT') + '</hh:paraProperties>' +
      '<hh:styles itemCnt="1">' +
      '<hh:style id="0" type="PARA" name="바탕글" engName="Normal" paraPrIDRef="0" charPrIDRef="0"' +
      ' nextStyleIDRef="0" langID="1042" lockForm="0"/>' +
      '</hh:styles>' +
      '</hh:refList>' +
      '<hh:compatibleDocument targetProgram="HWP201X"><hh:layoutCompatibility/></hh:compatibleDocument>' +
      '</hh:head>'
    );
  }

  function secPr() {
    return (
      '<hp:secPr id="" textDirection="HORIZONTAL" spaceColumns="1134" tabStop="8000"' +
      ' tabStopVal="4000" tabStopUnit="HWPUNIT" outlineShapeIDRef="1" memoShapeIDRef="0"' +
      ' textVerticalWidthHead="0" masterPageCnt="0">' +
      '<hp:grid lineGrid="0" charGrid="0" wonggojiFormat="0" strtnum="0"/>' +
      '<hp:startNum pageStartsOn="BOTH" page="0" pic="0" tbl="0" equation="0"/>' +
      '<hp:visibility hideFirstHeader="0" hideFirstFooter="0" hideFirstMasterPage="0"' +
      ' border="SHOW_ALL" fill="SHOW_ALL" hideFirstPageNum="0" hideFirstEmptyLine="0" showLineNumber="0"/>' +
      '<hp:lineNumberShape restartType="0" countBy="0" distance="0" startNumber="0"/>' +
      '<hp:pagePr landscape="WIDELY" width="' + PAGE_WIDTH + '" height="84188" gutterType="LEFT_ONLY">' +
      '<hp:margin header="4252" footer="4252" gutter="0" left="' + MARGIN_LEFT + '" right="' + MARGIN_RIGHT +
      '" top="5668" bottom="4252"/>' +
      '</hp:pagePr>' +
      '<hp:footNotePr>' +
      '<hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/>' +
      '<hp:noteLine length="-1" type="SOLID" width="0.12 mm" color="#000000"/>' +
      '<hp:noteSpacing betweenNotes="850" belowLine="567" aboveLine="850"/>' +
      '<hp:numbering type="CONTINUOUS" newNum="1"/>' +
      '<hp:placement place="EACH_COLUMN" beneathText="0"/>' +
      '</hp:footNotePr>' +
      '<hp:endNotePr>' +
      '<hp:autoNumFormat type="DIGIT" userChar="" prefixChar="" suffixChar=")" supscript="0"/>' +
      '<hp:noteLine length="14692344" type="SOLID" width="0.12 mm" color="#000000"/>' +
      '<hp:noteSpacing betweenNotes="0" belowLine="567" aboveLine="850"/>' +
      '<hp:numbering type="CONTINUOUS" newNum="1"/>' +
      '<hp:placement place="END_OF_DOCUMENT" beneathText="0"/>' +
      '</hp:endNotePr>' +
      '<hp:pageBorderFill type="BOTH" borderFillIDRef="1" textBorder="PAPER" headerInside="0"' +
      ' footerInside="0" fillArea="PAPER">' +
      '<hp:offset left="1417" right="1417" top="1417" bottom="1417"/>' +
      '</hp:pageBorderFill>' +
      '</hp:secPr>'
    );
  }

  var paraId = 0;

  function para(text, opts) {
    var o = opts || {};
    paraId += 1;
    var charRef = o.bold ? 1 : 0;
    var paraRef = o.bold ? 1 : 0;
    var inner = o.first ? secPr() : '';
    inner += text ? '<hp:t>' + esc(text) + '</hp:t>' : '<hp:t/>';
    return (
      '<hp:p id="' + paraId + '" paraPrIDRef="' + paraRef + '" styleIDRef="0" pageBreak="' +
      (o.pageBreak ? '1' : '0') + '" columnBreak="0" merged="0">' +
      '<hp:run charPrIDRef="' + charRef + '">' + inner + '</hp:run>' +
      '</hp:p>'
    );
  }

  function cell(text, r, c, colWidth, isHeader) {
    paraId += 1;
    return (
      '<hp:tc name="" header="' + (isHeader ? '1' : '0') + '" hasMargin="0" protect="0" editable="0"' +
      ' dirty="0" borderFillIDRef="2">' +
      '<hp:subList id="" textDirection="HORIZONTAL" lineWrap="BREAK" vertAlign="CENTER"' +
      ' linkListIDRef="0" linkListNextIDRef="0" textWidth="0" textHeight="0" hasTextRef="0" hasNumRef="0">' +
      '<hp:p id="' + paraId + '" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">' +
      '<hp:run charPrIDRef="0"><hp:t>' + esc(text) + '</hp:t></hp:run>' +
      '</hp:p>' +
      '</hp:subList>' +
      '<hp:cellAddr colAddr="' + c + '" rowAddr="' + r + '"/>' +
      '<hp:cellSpan colSpan="1" rowSpan="1"/>' +
      '<hp:cellSz width="' + colWidth + '" height="' + ROW_HEIGHT + '"/>' +
      '<hp:cellMargin left="141" right="141" top="141" bottom="141"/>' +
      '</hp:tc>'
    );
  }

  function table(grid) {
    var rowCnt = grid.length;
    var colCnt = grid.reduce(function (m, r) {
      return Math.max(m, r.length);
    }, 0);
    if (!rowCnt || !colCnt) return '';
    var colWidth = Math.floor(TEXT_WIDTH / colCnt);
    var height = rowCnt * ROW_HEIGHT;
    var rows = '';
    for (var r = 0; r < rowCnt; r++) {
      rows += '<hp:tr>';
      for (var c = 0; c < colCnt; c++) {
        var v = grid[r][c];
        rows += cell(v === undefined || v === null ? '' : String(v), r, c, colWidth, r === 0);
      }
      rows += '</hp:tr>';
    }
    paraId += 1;
    return (
      '<hp:p id="' + paraId + '" paraPrIDRef="0" styleIDRef="0" pageBreak="0" columnBreak="0" merged="0">' +
      '<hp:run charPrIDRef="0">' +
      '<hp:tbl id="' + paraId + '" zOrder="0" numberingType="TABLE" textWrap="TOP_AND_BOTTOM"' +
      ' textFlow="BOTH_SIDES" lock="0" dropcapstyle="None" pageBreak="CELL" repeatHeader="1"' +
      ' rowCnt="' + rowCnt + '" colCnt="' + colCnt + '" cellSpacing="0" borderFillIDRef="2" noAdjust="0">' +
      '<hp:sz width="' + colWidth * colCnt + '" widthRelTo="ABSOLUTE" height="' + height +
      '" heightRelTo="ABSOLUTE" protect="0"/>' +
      '<hp:pos treatAsChar="1" affectLSpacing="0" flowWithText="1" allowOverlap="0" holdAnchorAndSO="0"' +
      ' vertRelTo="PARA" horzRelTo="COLUMN" vertAlign="TOP" horzAlign="LEFT" vertOffset="0" horzOffset="0"/>' +
      '<hp:outMargin left="0" right="0" top="0" bottom="0"/>' +
      '<hp:inMargin left="141" right="141" top="141" bottom="141"/>' +
      rows +
      '</hp:tbl>' +
      '</hp:run></hp:p>'
    );
  }

  var MAX_TABLE_ROWS = 500;
  var MAX_TABLE_COLS = 40;
  var MAX_PARAGRAPHS_PER_FILE = 500;

  /**
   * 서식 정보를 가져올 수 없는 원본(hwp 바이너리 등)의 내용을 문단·표로 다시 만든다.
   * 취합본의 기본 번호표(reg)에 있는 글자모양·문단모양을 쓴다.
   */
  function plainBody(reg, paragraphs, tables, headingText) {
    var body = '';
    if (headingText) body += para(headingText, { bold: true });
    (paragraphs || []).slice(0, MAX_PARAGRAPHS_PER_FILE).forEach(function (p) {
      var line = T.collapseSpace(p);
      if (line) body += para(line);
    });
    (tables || []).forEach(function (grid) {
      if (!grid || !grid.length) return;
      var trimmed = grid.slice(0, MAX_TABLE_ROWS).map(function (row) {
        return row.slice(0, MAX_TABLE_COLS);
      });
      body += para('');
      body += table(trimmed);
    });
    body += para('');
    return body;
  }

  CJ.hwpxWriter = {
    plainBody: plainBody,
    baseRefList: baseRefList,
    escapeXml: esc,
    versionXml: versionXml,
    containerXml: containerXml,
    contentHpf: contentHpf,
    manifestXml: manifestXml,
    headerXml: headerXml,
  };
})(typeof globalThis !== 'undefined' ? globalThis : this);
