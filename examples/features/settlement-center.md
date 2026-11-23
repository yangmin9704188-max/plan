---
title: 정산센터 개편 (예시)
products: Office, Worker
repo: example/office
---

## 기획

월말마다 수기로 맞추던 정산 금액을 한 화면에서 집계하고, 세금계산서와 엑셀 다운로드까지 끝낼 수 있게 한다.
지금은 정산 담당자가 엑셀 세 개를 오가며 금액을 맞추느라 하루가 걸린다. 목표는 30분 이내.

- 월 선택만으로 업체별 합계가 바로 보일 것
- 부가세는 공급가액과 분리해서 보여줄 것

## 개발 계획

- 정산 집계 쿼리 최적화 | branch: feat/settlement-query
- 부가세 분리 계산 | branch: feat/settlement-vat
- 엑셀 일괄 다운로드 | branch: feat/settlement-excel | repo: example/office-worker

## 확인 항목

- 정산 화면 → 3월 선택 → 업체별 합계가 기존 엑셀과 같은지
- 공급가액 / 부가세가 나뉘어 보이고 합이 총액과 같은지
- 엑셀 다운로드 버튼 → 파일이 열리고 금액이 화면과 같은지
