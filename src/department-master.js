/*
 * 자동 생성 파일 - 직접 수정하지 마세요.
 * 생성: node build/generate-department-master.js
 * 원본: data/충주시_부서순서.xlsx
 * 파일: data/충주시_부서순서.xlsx
 * 시트: 충주시 직제순서
 * 병합 셀: 1개
 * 전체 행: 77
 * 헤더 행: 2행 / 순번 컬럼: A / 부서명 컬럼: C / 소속 컬럼: B
 * 빈 행: 0
 * 엑셀에서 읽은 부서 수: 75
 * 추가 요청 부서: 의회사무국 (순서 76)
 * 전체 부서 수: 76
 * 부분문자열 관계: 없음
 */
(function (global) {
  'use strict';
  var CJ = (global.CJ = global.CJ || {});
  CJ.DEPARTMENT_SOURCE = {"title":"충주시 행정기구 직제순서 (2026.1.1. 시행 기준)","sheet":"충주시 직제순서","count":76};
  CJ.DEFAULT_DEPARTMENTS = [
    { order: 1, name: "홍보담당관", bureau: "담당관(부시장 직속)", aliases: [], enabled: true },
    { order: 2, name: "감사담당관", bureau: "담당관(부시장 직속)", aliases: [], enabled: true },
    { order: 3, name: "자치행정과", bureau: "안전행정국", aliases: [], enabled: true },
    { order: 4, name: "기획예산과", bureau: "안전행정국", aliases: [], enabled: true },
    { order: 5, name: "안전총괄과", bureau: "안전행정국", aliases: [], enabled: true },
    { order: 6, name: "정보통신과", bureau: "안전행정국", aliases: [], enabled: true },
    { order: 7, name: "회계과", bureau: "안전행정국", aliases: [], enabled: true },
    { order: 8, name: "경제과", bureau: "경제교통국", aliases: [], enabled: true },
    { order: 9, name: "투자유치과", bureau: "경제교통국", aliases: [], enabled: true },
    { order: 10, name: "신성장산업과", bureau: "경제교통국", aliases: [], enabled: true },
    { order: 11, name: "교통정책과", bureau: "경제교통국", aliases: [], enabled: true },
    { order: 12, name: "차량민원과", bureau: "경제교통국", aliases: [], enabled: true },
    { order: 13, name: "허가민원과", bureau: "건설국", aliases: [], enabled: true },
    { order: 14, name: "도시계획과", bureau: "건설국", aliases: [], enabled: true },
    { order: 15, name: "도로과", bureau: "건설국", aliases: [], enabled: true },
    { order: 16, name: "건축과", bureau: "건설국", aliases: [], enabled: true },
    { order: 17, name: "복지정책과", bureau: "복지국", aliases: [], enabled: true },
    { order: 18, name: "노인복지과", bureau: "복지국", aliases: [], enabled: true },
    { order: 19, name: "장애인복지과", bureau: "복지국", aliases: [], enabled: true },
    { order: 20, name: "여성청소년과", bureau: "복지국", aliases: [], enabled: true },
    { order: 21, name: "민원봉사과", bureau: "생활민원국", aliases: [], enabled: true },
    { order: 22, name: "토지정보과", bureau: "생활민원국", aliases: [], enabled: true },
    { order: 23, name: "세정과", bureau: "생활민원국", aliases: [], enabled: true },
    { order: 24, name: "징수과", bureau: "생활민원국", aliases: [], enabled: true },
    { order: 25, name: "위생과", bureau: "생활민원국", aliases: [], enabled: true },
    { order: 26, name: "문화예술과", bureau: "문화체육관광국", aliases: [], enabled: true },
    { order: 27, name: "체육진흥과", bureau: "문화체육관광국", aliases: [], enabled: true },
    { order: 28, name: "관광과", bureau: "문화체육관광국", aliases: [], enabled: true },
    { order: 29, name: "평생학습과", bureau: "문화체육관광국", aliases: [], enabled: true },
    { order: 30, name: "농정과", bureau: "농업정책국", aliases: [], enabled: true },
    { order: 31, name: "친환경농산과", bureau: "농업정책국", aliases: [], enabled: true },
    { order: 32, name: "농식품유통과", bureau: "농업정책국", aliases: [], enabled: true },
    { order: 33, name: "축수산과", bureau: "농업정책국", aliases: [], enabled: true },
    { order: 34, name: "정원도시과", bureau: "푸른도시국", aliases: [], enabled: true },
    { order: 35, name: "균형개발과", bureau: "푸른도시국", aliases: [], enabled: true },
    { order: 36, name: "하천과", bureau: "푸른도시국", aliases: [], enabled: true },
    { order: 37, name: "산림과", bureau: "푸른도시국", aliases: [], enabled: true },
    { order: 38, name: "수질환경과", bureau: "환경국", aliases: [], enabled: true },
    { order: 39, name: "대기환경과", bureau: "환경국", aliases: [], enabled: true },
    { order: 40, name: "자원순환과", bureau: "환경국", aliases: [], enabled: true },
    { order: 41, name: "보건과", bureau: "보건소(소속기관)", aliases: [], enabled: true },
    { order: 42, name: "건강증진과", bureau: "보건소(소속기관)", aliases: [], enabled: true },
    { order: 43, name: "질병관리과", bureau: "보건소(소속기관)", aliases: [], enabled: true },
    { order: 44, name: "농업기술과", bureau: "농업기술센터(소속기관)", aliases: [], enabled: true },
    { order: 45, name: "농업교육과", bureau: "농업기술센터(소속기관)", aliases: [], enabled: true },
    { order: 46, name: "과수육성과", bureau: "농업기술센터(소속기관)", aliases: [], enabled: true },
    { order: 47, name: "상수도사업소", bureau: "소속사업소", aliases: [], enabled: true },
    { order: 48, name: "하수도사업소", bureau: "소속사업소", aliases: [], enabled: true },
    { order: 49, name: "시립도서관", bureau: "소속사업소", aliases: [], enabled: true },
    { order: 50, name: "박물관", bureau: "소속사업소", aliases: [], enabled: true },
    { order: 51, name: "주덕읍", bureau: "읍면동", aliases: [], enabled: true },
    { order: 52, name: "살미면", bureau: "읍면동", aliases: [], enabled: true },
    { order: 53, name: "수안보면", bureau: "읍면동", aliases: [], enabled: true },
    { order: 54, name: "대소원면", bureau: "읍면동", aliases: [], enabled: true },
    { order: 55, name: "신니면", bureau: "읍면동", aliases: [], enabled: true },
    { order: 56, name: "노은면", bureau: "읍면동", aliases: [], enabled: true },
    { order: 57, name: "앙성면", bureau: "읍면동", aliases: [], enabled: true },
    { order: 58, name: "중앙탑면", bureau: "읍면동", aliases: [], enabled: true },
    { order: 59, name: "금가면", bureau: "읍면동", aliases: [], enabled: true },
    { order: 60, name: "동량면", bureau: "읍면동", aliases: [], enabled: true },
    { order: 61, name: "산척면", bureau: "읍면동", aliases: [], enabled: true },
    { order: 62, name: "엄정면", bureau: "읍면동", aliases: [], enabled: true },
    { order: 63, name: "소태면", bureau: "읍면동", aliases: [], enabled: true },
    { order: 64, name: "성내충인동", bureau: "읍면동", aliases: [], enabled: true },
    { order: 65, name: "교현안림동", bureau: "읍면동", aliases: [], enabled: true },
    { order: 66, name: "교현2동", bureau: "읍면동", aliases: [], enabled: true },
    { order: 67, name: "용산동", bureau: "읍면동", aliases: [], enabled: true },
    { order: 68, name: "지현동", bureau: "읍면동", aliases: [], enabled: true },
    { order: 69, name: "문화동", bureau: "읍면동", aliases: [], enabled: true },
    { order: 70, name: "호암직동", bureau: "읍면동", aliases: [], enabled: true },
    { order: 71, name: "달천동", bureau: "읍면동", aliases: [], enabled: true },
    { order: 72, name: "봉방동", bureau: "읍면동", aliases: [], enabled: true },
    { order: 73, name: "칠금금릉동", bureau: "읍면동", aliases: [], enabled: true },
    { order: 74, name: "연수동", bureau: "읍면동", aliases: [], enabled: true },
    { order: 75, name: "목행용탄동", bureau: "읍면동", aliases: [], enabled: true },
    { order: 76, name: "의회사무국", bureau: "", aliases: [], enabled: true }
  ];
})(typeof globalThis !== "undefined" ? globalThis : this);
