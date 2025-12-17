/**
 * UI 임베딩 로직
 */

import { formatOvertime, calculateOvertime } from './timeCalculator.js';
import { isFutureDate, formatDateYYYYMMDD } from './dateUtils.js';
import { saveTimeData, loadTimeData } from './storageManager.js';

/**
 * 근태 테이블 찾기
 * @returns {HTMLTableElement|null} 근태 테이블 또는 null
 */
export function findAttendanceTable() {
  // 일반적인 테이블 선택자들 시도
  const selectors = [
    'table',
    'table[class*="attend"]',
    'table[class*="route"]',
    'table[class*="list"]',
    'table[class*="data"]',
  ];
  
  for (const selector of selectors) {
    const tables = document.querySelectorAll(selector);
    for (const table of tables) {
      // 테이블에 날짜나 시간 관련 데이터가 있는지 확인
      const tableText = table.textContent;
      if (tableText.match(/\d{4}[-/]\d{2}[-/]\d{2}/) || 
          tableText.match(/\d{1,2}:\d{2}/)) {
        return table;
      }
    }
  }
  
  return null;
}

/**
 * 근태 표에 초과 근무 시간 컬럼 추가
 * @param {HTMLTableElement} table - 근태 테이블
 * @param {Array<Object>} weeklyData - 주간 데이터 배열
 * @param {Function} onTimeChange - 시간 변경 콜백 함수
 */
export async function injectOvertimeColumn(table, weeklyData, onTimeChange) {
  // 이미 컬럼이 추가되어 있으면 제거
  const existingHeader = table.querySelector('th.tims-overtime-header');
  const existingCells = table.querySelectorAll('td.tims-overtime-cell');
  if (existingHeader) {
    existingHeader.remove();
    existingCells.forEach(cell => cell.remove());
  }
  
  // 헤더 행 찾기
  const headerRow = table.querySelector('thead tr') || table.querySelector('tr');
  if (!headerRow) return;
  
  // 헤더에 컬럼 추가
  const headerCell = document.createElement('th');
  headerCell.className = 'tims-overtime-header';
  headerCell.textContent = '초과근무';
  headerCell.style.cssText = 'padding: 8px; text-align: center; background-color: #f0f0f0; font-weight: bold;';
  headerRow.appendChild(headerCell);
  
  // 데이터 행에 셀 추가
  const rows = table.querySelectorAll('tbody tr, tr:not(:first-child)');
  const dataRows = Array.from(rows).filter(row => {
    // 헤더 행 제외
    return !row.querySelector('th') || row.querySelector('td');
  });
  
  // 주간 데이터와 행을 매칭
  for (let i = 0; i < Math.max(dataRows.length, weeklyData.length); i++) {
    const row = dataRows[i];
    const dayData = weeklyData[i];
    
    if (!row) continue;
    
    const cell = document.createElement('td');
    cell.className = 'tims-overtime-cell';
    cell.style.cssText = 'padding: 8px; text-align: center;';
    
    if (dayData) {
      const dateKey = formatDateYYYYMMDD(dayData.date);
      const isFuture = isFutureDate(dayData.date);
      
      if (isFuture) {
        // 미래 날짜: 입력 필드 추가
        await renderFutureDateCell(cell, dayData, dateKey, onTimeChange);
      } else {
        // 과거/현재 날짜: 계산 결과 표시
        renderPastDateCell(cell, dayData);
      }
    }
    
    row.appendChild(cell);
  }
  
  // 총계 행 추가 (선택사항)
  addTotalRow(table, weeklyData);
}

/**
 * 미래 날짜 셀 렌더링 (입력 필드 포함)
 * @param {HTMLTableCellElement} cell - 셀 요소
 * @param {Object} dayData - 날짜 데이터
 * @param {string} dateKey - 날짜 키
 * @param {Function} onTimeChange - 시간 변경 콜백
 */
async function renderFutureDateCell(cell, dayData, dateKey, onTimeChange) {
  cell.style.backgroundColor = '#f9f9f9';
  cell.style.border = '1px dashed #ccc';
  
  // 저장된 값 로드
  const savedData = await loadTimeData(dateKey);
  const startTime = savedData?.startTime || dayData.startTime || '09:00';
  const endTime = savedData?.endTime || dayData.endTime || '18:00';
  
  // 입력 필드 컨테이너
  const container = document.createElement('div');
  container.style.cssText = 'display: flex; flex-direction: column; gap: 4px; align-items: center;';
  
  // 출근 시간 입력
  const startInput = document.createElement('input');
  startInput.type = 'time';
  startInput.value = startTime;
  startInput.style.cssText = 'width: 80px; padding: 2px; font-size: 12px;';
  startInput.className = 'tims-time-input tims-start-time';
  startInput.dataset.dateKey = dateKey;
  
  // 퇴근 시간 입력
  const endInput = document.createElement('input');
  endInput.type = 'time';
  endInput.value = endTime;
  endInput.style.cssText = 'width: 80px; padding: 2px; font-size: 12px;';
  endInput.className = 'tims-time-input tims-end-time';
  endInput.dataset.dateKey = dateKey;
  
  // 계산 결과 표시
  const resultDiv = document.createElement('div');
  resultDiv.className = 'tims-overtime-result';
  resultDiv.style.cssText = 'font-size: 11px; margin-top: 2px;';
  updateFutureDateResult(resultDiv, startTime, endTime);
  
  // 이벤트 리스너
  const handleTimeChange = async () => {
    const newStartTime = startInput.value;
    const newEndTime = endInput.value;
    
    // 저장
    await saveTimeData(dateKey, {
      startTime: newStartTime,
      endTime: newEndTime
    });
    
    // 결과 업데이트
    updateFutureDateResult(resultDiv, newStartTime, newEndTime);
    
    // 콜백 호출
    if (onTimeChange) {
      onTimeChange(dateKey, newStartTime, newEndTime);
    }
  };
  
  startInput.addEventListener('change', handleTimeChange);
  endInput.addEventListener('change', handleTimeChange);
  
  container.appendChild(startInput);
  container.appendChild(endInput);
  container.appendChild(resultDiv);
  cell.appendChild(container);
}

/**
 * 과거/현재 날짜 셀 렌더링 (계산 결과만 표시)
 * @param {HTMLTableCellElement} cell - 셀 요소
 * @param {Object} dayData - 날짜 데이터
 */
function renderPastDateCell(cell, dayData) {
  if (!dayData.startTime || !dayData.endTime) {
    cell.textContent = '-';
    return;
  }
  
  const overtime = dayData.overtime || 0;
  const formatted = formatOvertime(overtime);
  
  cell.textContent = formatted;
  
  // 색상 스타일링
  if (overtime > 0) {
    cell.style.color = '#28a745'; // 녹색
    cell.style.fontWeight = 'bold';
  } else if (overtime < 0) {
    cell.style.color = '#dc3545'; // 빨간색
    cell.style.fontWeight = 'bold';
  } else {
    cell.style.color = '#6c757d'; // 회색
  }
}

/**
 * 미래 날짜 결과 업데이트
 * @param {HTMLDivElement} resultDiv - 결과 표시 div
 * @param {string} startTime - 출근 시간
 * @param {string} endTime - 퇴근 시간
 */
function updateFutureDateResult(resultDiv, startTime, endTime) {
  if (!startTime || !endTime) {
    resultDiv.textContent = '';
    return;
  }
  
  // 간단한 계산 (기본값 사용)
  const overtime = calculateOvertime(startTime, endTime);
  const formatted = formatOvertime(overtime);
  
  resultDiv.textContent = formatted;
  
  if (overtime > 0) {
    resultDiv.style.color = '#28a745';
  } else if (overtime < 0) {
    resultDiv.style.color = '#dc3545';
  } else {
    resultDiv.style.color = '#6c757d';
  }
}

/**
 * 총계 행 추가
 * @param {HTMLTableElement} table - 근태 테이블
 * @param {Array<Object>} weeklyData - 주간 데이터 배열
 */
function addTotalRow(table, weeklyData) {
  // 기존 총계 행 제거
  const existingTotal = table.querySelector('tr.tims-total-row');
  if (existingTotal) {
    existingTotal.remove();
  }
  
  // 총계 계산
  const totalOvertime = weeklyData.reduce((sum, day) => {
    return sum + (day.overtime || 0);
  }, 0);
  
  if (totalOvertime === 0 && weeklyData.every(d => !d.startTime)) {
    return; // 데이터가 없으면 총계 행 추가 안 함
  }
  
  // 총계 행 생성
  const tbody = table.querySelector('tbody') || table;
  const totalRow = document.createElement('tr');
  totalRow.className = 'tims-total-row';
  totalRow.style.cssText = 'background-color: #e9ecef; font-weight: bold;';
  
  // 빈 셀들 추가 (테이블 컬럼 수에 맞춰)
  const firstRow = table.querySelector('tr');
  const columnCount = firstRow ? firstRow.cells.length : 0;
  
  for (let i = 0; i < columnCount - 1; i++) {
    const cell = document.createElement('td');
    if (i === 0) {
      cell.textContent = '주간 총계';
      cell.style.cssText = 'text-align: right; padding: 8px;';
    } else {
      cell.textContent = '';
    }
    totalRow.appendChild(cell);
  }
  
  // 총계 셀
  const totalCell = document.createElement('td');
  totalCell.className = 'tims-overtime-cell';
  totalCell.textContent = formatOvertime(totalOvertime);
  totalCell.style.cssText = 'padding: 8px; text-align: center; font-weight: bold;';
  
  if (totalOvertime > 0) {
    totalCell.style.color = '#28a745';
  } else if (totalOvertime < 0) {
    totalCell.style.color = '#dc3545';
  } else {
    totalCell.style.color = '#6c757d';
  }
  
  totalRow.appendChild(totalCell);
  tbody.appendChild(totalRow);
}

