/* 테스트에서 src 모듈을 브라우저와 동일한 전역 방식으로 읽어들인다. */
'use strict';
const path = require('path');

global.XLSX = require(path.resolve(__dirname, '../node_modules/xlsx'));
global.JSZip = require(path.resolve(__dirname, '../node_modules/jszip'));
global.pdfjsLib = require(path.resolve(__dirname, '../node_modules/pdfjs-dist/legacy/build/pdf.js'));
global.PDFLib = require(path.resolve(__dirname, '../node_modules/pdf-lib'));

[
  'text-utils',
  'department-master',
  'department-store',
  'department-detector',
  'xml-lite',
  'excel-reader',
  'pdf-reader',
  'hwpx-reader',
  'hwp-reader',
  'table-detector',
  'schema-matcher',
  'analyzer',
  'aggregator',
  'excel-writer',
  'hwpx-writer',
  'hwpx-merger',
  'output-builder',
].forEach((f) => require(path.resolve(__dirname, '../src/' + f + '.js')));

module.exports = global.CJ;
