/**
 * TIMS 근무시간 계산기 Content Script
 *
 * 개선된 로직:
 * 1. `frameBody` 프레임 컨텍스트에서만 실행되도록 보장합니다.
 * 2. MutationObserver를 사용해 근태 테이블이 동적으로 생성되는 것을 감지하고 메인 로직을 실행합니다.
 * 3. URL, DOM, JavaScript(onclick 등), 숨겨진 input 등 모든 가능한 위치에서 사원 정보를 파싱합니다.
 * 4. 화면에 이미 렌더링된 테이블의 데이터를 먼저 파싱하고, 부족한 날짜의 데이터만 API로 요청하는 하이브리드 데이터 수집 방식을 사용합니다.
 */

// ==================== 전역 보호 ====================
// `frameBody`가 아니면 스크립트 실행을 중단
if (window.name !== 'frameBody') {
  // console.log('TIMS Ext: Not in frameBody, stopping.');
} else {
  console.log('TIMS Ext: Content script initialized in frameBody');
  // ==================== 상수 ====================
  const DEFAULT_WORK_HOURS = 8; // 기본 근무 시간 (8시간)
  const DEFAULT_BREAK_TIME = 1; // 기본 휴게 시간 (1시간)

  // ==================== 날짜 유틸리티 ====================
  function getWeekDays() {
    const today = new Date();
    const dayOfWeek = today.getDay(); // 0: 일요일, 1: 월요일, ..., 6: 토요일
    const monday = new Date(today);
    const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
    monday.setDate(today.getDate() + daysToMonday);
    
    const weekDays = [];
    for (let i = 0; i < 5; i++) {
      const date = new Date(monday);
      date.setDate(monday.getDate() + i);
      weekDays.push(date);
    }
    return weekDays;
  }

  function formatDateYYYYMMDD(date) {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  function isFutureDate(date) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const checkDate = new Date(date);
    checkDate.setHours(0, 0, 0, 0);
    return checkDate > today;
  }

  function isToday(date) {
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    const checkDate = new Date(date);
    checkDate.setHours(0, 0, 0, 0);
    return checkDate.getTime() === today.getTime();
  }

  // ==================== 스토리지 관리 ====================
  function saveTimeData(dateKey, timeData) {
    return new Promise((resolve) => {
      chrome.storage.local.get(['timeData'], (result) => {
        const allTimeData = result.timeData || {};
        allTimeData[dateKey] = timeData;
        chrome.storage.local.set({ timeData: allTimeData }, resolve);
      });
    });
  }

  function loadTimeData(dateKey) {
    return new Promise((resolve) => {
      chrome.storage.local.get(['timeData'], (result) => {
        resolve(result.timeData?.[dateKey] || null);
      });
    });
  }

  function loadAllTimeData() {
    return new Promise((resolve) => {
      chrome.storage.local.get(['timeData'], (result) => {
        resolve(result.timeData || {});
      });
    });
  }

  // ==================== 시간 계산 ====================
  function timeToMinutes(timeStr) {
    if (!timeStr) return 0;
    const [hours, minutes] = timeStr.split(':').map(Number);
    return hours * 60 + minutes;
  }

  function calculateOvertime(startTime, endTime) {
    if (!startTime || !endTime) return 0;
    const startMinutes = timeToMinutes(startTime);
    const endMinutes = timeToMinutes(endTime);
    const breakMinutes = DEFAULT_BREAK_TIME * 60;
    
    let workMinutes = (endMinutes - startMinutes) - breakMinutes;
    if (endMinutes < startMinutes) {
      workMinutes = (24 * 60 - startMinutes + endMinutes) - breakMinutes;
    }
    
    const standardMinutes = DEFAULT_WORK_HOURS * 60;
    return workMinutes - standardMinutes;
  }

  function formatOvertime(minutes) {
    // H:MM 형식으로 표기 (양수는 부호 없음, 음수는 - 부호)
    const total = Math.trunc(minutes || 0);
    const sign = total < 0 ? '-' : '';
    const abs = Math.abs(total);
    const h = Math.floor(abs / 60);
    const m = abs % 60;
    return `${sign}${h}:${String(m).padStart(2, '0')}`;
  }

  // ==================== API 및 데이터 파싱 ====================
  async function fetchAttendanceData(dateKey, empNo, empNm) {
    // API는 YYYY.MM.DD 포맷을 사용하는 경우가 있어 두 포맷을 모두 지원
    const toDotDate = (yyyymmdd) => `${yyyymmdd.slice(0,4)}.${yyyymmdd.slice(4,6)}.${yyyymmdd.slice(6,8)}`;
    const encodedEmpNm = encodeURIComponent(empNm || '');
    const empNoParam = empNo ? String(empNo).replace(/[^0-9]/g, '') : '';
    const stDate = toDotDate(dateKey);
    const edDate = stDate;
    const url = `/insa/attend/findEmpRouteList.screen?srchStDate=${stDate}&srchEdDate=${edDate}&srchEmpNo=${empNoParam}&srchEmpNm=${encodedEmpNm}`;
    console.log(`TIMS Ext: Fetching attendance data: date=${dateKey}(${stDate}), empNo=${empNoParam || '(empty)'}, empNm=${empNm || '(empty)'}\nURL: ${url}`);
    const response = await fetch(url, { credentials: 'include' });
    if (!response.ok) throw new Error(`API 호출 실패: ${response.status}`);
    return await response.text();
  }

  function normalizeTime(timeStr) {
    if (!timeStr) return '';
    const parts = timeStr.match(/(\d{1,2}):(\d{2})/);
    if (!parts) return '';
    return `${parts[1].padStart(2, '0')}:${parts[2].padStart(2, '0')}`;
  }

  function parseTimesFromHTML(html) {
    // DOM 기반 파싱 시도 (#resultTable 기준)
    try {
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');
      const table = doc.querySelector('#resultTable');
      if (table) {
        // 헤더 인덱스 매핑
        const headerCells = table.querySelectorAll('tr:first-child td, thead tr:first-child th, thead tr:first-child td');
        const getIndex = (labels) => {
          let idx = -1;
          headerCells.forEach((c, i) => {
            const t = (c.textContent || '').trim();
            if (labels.some(l => t.includes(l))) idx = idx === -1 ? i : idx;
          });
          return idx;
        };
        const idxTime = getIndex(['태그시각']);
        const idxEvent = getIndex(['이벤트구분']);
        const idxDevice = getIndex(['기기명']);

        let inTimes = [];
        let outTimes = [];
        let lastEventType = null; // 'IN' | 'OUT' | null

        const rows = Array.from(table.querySelectorAll('tr')).slice(1); // skip header
        for (const r of rows) {
          const cells = r.querySelectorAll('td');
          if (!cells.length) continue;
          const timeText = (cells[idxTime]?.textContent || '').trim();
          const eventText = (cells[idxEvent]?.textContent || '').trim();
          const deviceText = (cells[idxDevice]?.textContent || '').trim();

          // 시간에서 HH:mm 추출
          const m = timeText.match(/(\d{1,2}:\d{2})/);
          const hhmm = m ? normalizeTime(m[1]) : '';
          if (!hhmm) continue;

          const isIn = /출근/i.test(eventText) || /\[IN\]/i.test(deviceText);
          const isOut = /퇴근/i.test(eventText) || /\[OUT\]/i.test(deviceText);

          if (isIn) inTimes.push(hhmm);
          if (isOut) outTimes.push(hhmm);
          if (isIn) lastEventType = 'IN';
          if (isOut) lastEventType = 'OUT';
        }

        const startTime = inTimes.length ? inTimes.sort()[0] : null;
        const endTime = outTimes.length ? outTimes.sort()[outTimes.length - 1] : null;
        const lastEventIsOut = lastEventType === 'OUT';

        if (startTime || endTime) {
          console.log('TIMS Ext: Parsed times from API table:', { startTime, endTime, inTimes, outTimes, lastEventIsOut });
          return { startTime, endTime, inTimes, outTimes, lastEventIsOut };
        }
      }
    } catch (e) {
      console.warn('TIMS Ext: DOM parsing failed, fallback to regex.', e);
    }

    // 폴백: 전체 HTML에서 HH:mm 시각만으로 추출(신뢰도 낮음)
    const times = (html.match(/(\d{1,2}:\d{2})/g) || []).map(normalizeTime).filter(Boolean);
    if (times.length >= 1) {
      const startTime = times[0] || null;
      const endTime = times.length >= 2 ? times[times.length - 1] : null;
      // 폴백은 신뢰도가 낮으므로 lastEventIsOut을 알 수 없다. undefined로 반환
      return { startTime, endTime };
    }
    return null;
  }
  
  function findEmpNoFromPageScripts() {
    // onclick이 td 등 다양한 엘리먼트에 걸려 있으므로 범위를 넓힘
    const candidates = document.querySelectorAll('[onclick], a[href*="javascript"], button, input[type="button"], input[type="submit"]');

    for (const el of candidates) {
      const onclickAttr = el.getAttribute('onclick') || '';
      const hrefAttr = el.getAttribute('href') || '';
      const script = onclickAttr || hrefAttr;
      if (!script) continue;

      // 1) fn_findEmpRouteList('YYYYMMDD','EMP_NO',...)
      const mRoute = script.match(/fn_findEmpRouteList\(\s*'?\d{8}'?\s*,\s*'?(\d{5,})'?/);
      if (mRoute) {
        const empNo = mRoute[1];
        if (empNo) {
          console.log(`TIMS Ext: Found empNo in fn_findEmpRouteList: ${empNo}`);
          return empNo;
        }
      }

      // 2) fn_CommonEmpView('EMP_NO', ...)
      const mView = script.match(/fn_CommonEmpView\(\s*'?(\d{5,})'?/);
      if (mView) {
        const empNo = mView[1];
        if (empNo) {
          console.log(`TIMS Ext: Found empNo in fn_CommonEmpView: ${empNo}`);
          return empNo;
        }
      }

      // 3) 일반적인 따옴표 숫자들 중 8자리(날짜)를 제외한 첫 숫자 선택
      const allNums = Array.from(script.matchAll(/['"](\d{5,})['"]/g)).map(m => m[1]);
      if (allNums.length) {
        const pick = allNums.find(n => n.length !== 8) || allNums[0];
        if (pick) {
          console.log(`TIMS Ext: Found empNo in generic script: ${pick}`);
          return pick;
        }
      }
    }
    return null;
  }

  function findEmployeeInfoInDOM() {
    let empInfo = { empNo: null, empNm: null };
    console.log('TIMS Ext: findEmployeeInfoInDOM start');

    // --- Strategy 1: Parse from parent title (for Name) ---
    try {
        const title = parent.document.title;
        const titleMatch = title.match(/ː(.*?)(?:\[|\()/);
        if (titleMatch && titleMatch[1]) {
            empInfo.empNm = titleMatch[1].trim();
            console.log(`TIMS Ext: Found name in title: ${empInfo.empNm}`);
        }
    } catch (e) {
        console.warn("TIMS Ext: Could not access parent title.", e);
    }

    // --- Strategy 2: Search for labels like "성명", "사번" ---
    const labels = {
        empNm: ['성명', '사원명', '이름'],
        empNo: ['사번', '사원번호'],
    };

    document.querySelectorAll('td, th, span, div, p').forEach(el => {
        const elText = el.textContent.trim();
        for (const key in labels) {
            if (labels[key].includes(elText)) {
                let container = el.parentElement;
                let attempts = 5; 
                while (container && attempts > 0) {
                    const containerText = container.textContent || "";
                    const labelText = elText;
                    try {
                        const searchRegex = new RegExp(`${labelText}\\s*[:]?\\s*([가-힣]{2,}|\\d{5,})`);
                        const match = containerText.match(searchRegex);
                        if (match && match[1]) {
                             const value = match[1].trim();
                             if (key === 'empNo' && /^\d{5,}$/.test(value)) {
                                 if (!empInfo.empNo) {
                                   empInfo.empNo = value.replace(/\D/g, '');
                                   console.log(`TIMS Ext: Found empNo near label "${labelText}": ${empInfo.empNo}`);
                                 }
                             }
                             if (key === 'empNm' && /^[가-힣]{2,}$/.test(value)) {
                                 if (!empInfo.empNm) {
                                   empInfo.empNm = value;
                                   console.log(`TIMS Ext: Found name near label "${labelText}": ${empInfo.empNm}`);
                                 }
                             }
                        }
                    } catch(e) { /* ignore regex errors */ }
                    container = container.parentElement;
                    attempts--;
                }
            }
        }
    });

    // --- Strategy 3: Regex search the entire body as a fallback for empNo ---
    if (!empInfo.empNo) {
        const bodyText = document.body.innerText;
        const empNoMatch = bodyText.match(/(?:사번|사원번호)\s*[:]?\s*(\d{5,})/);
        if (empNoMatch && empNoMatch[1]) {
            empInfo.empNo = empNoMatch[1];
            console.log(`TIMS Ext: Found empNo via body search: ${empInfo.empNo}`);
        }
    }

    // --- Strategy 4: Find from script attributes in buttons/links ---
    if (!empInfo.empNo) {
        empInfo.empNo = findEmpNoFromPageScripts();
    }
    
    // --- Strategy 5: Check hidden input fields ---
    if (!empInfo.empNo) {
        const hiddenInputs = document.querySelectorAll('input[type="hidden"]');
        for (const input of hiddenInputs) {
            const name = (input.name || '').toLowerCase();
            const value = input.value;
            if (value && /^\d{5,}$/.test(value)) {
                if (name.includes('empno') || name.includes('emp_no') || name.includes('userno') || name.includes('user_no')
                    || name.includes('statusemp') || input.id === 'statusEmp') {
                    console.log(`TIMS Ext: Found empNo in hidden input [name=${input.name}]: ${value}`);
                    empInfo.empNo = value;
                    break; 
                }
            }
        }
    }

    // --- Final Check ---
    if (empInfo.empNm && !empInfo.empNo) {
        console.warn('TIMS Ext: empNm found but empNo missing; proceeding with name only');
    }
    if (empInfo.empNo && !empInfo.empNm) {
        console.warn('TIMS Ext: empNo found but empNm missing');
    }
    if (empInfo.empNo || empInfo.empNm) {
        console.log(`TIMS Ext: Found empInfo: Name=${empInfo.empNm || '(none)'}, No=${empInfo.empNo || '(none)'}`);
        return empInfo;
    }

    console.warn('TIMS Ext: findEmployeeInfoInDOM failed to extract any employee info');
    return null;
  }

  // ==================== DOM 조작 및 렌더링 ====================
  function findAttendanceTable() {
    for (const table of document.querySelectorAll('table')) {
      const text = table.textContent;
      if (text.includes('출근') || text.includes('퇴근') || text.match(/\d{4}[-./]\d{2}[-./]\d{2}/)) {
        return table;
      }
    }
    return null;
  }

  function parseWeeklyDataFromTable(table, weekDays) {
    const parsedData = [];
    const rows = table.querySelectorAll('tbody tr, tr:not(:first-child)');
    const weekDayStrings = weekDays.map(d => formatDateYYYYMMDD(d));

    // 미리 헤더 인덱스 조회
    const inIdx = findHeaderIndex(table, '입실');
    const outIdx = findHeaderIndex(table, '퇴실');
    const dateIdx = findHeaderIndex(table, '근태일자');

    const extractHHMM = (text) => {
      if (!text) return null;
      const m = String(text).match(/(\d{1,2}):(\d{2})/);
      if (!m) return null;
      return `${m[1].padStart(2,'0')}:${m[2]}`;
    };

    rows.forEach(row => {
      // 주입된 합성/합계/확장 열 행은 스킵
      if (row.classList?.contains('tims-ext-injected')) return;

      // 날짜 키 추출: 우선 근태일자 열, 없으면 텍스트 정규식
      let dateText = null;
      if (dateIdx >= 0 && row.cells[dateIdx]) {
        dateText = (row.cells[dateIdx].textContent || '').trim();
      }
      const rowText = row.textContent || '';
      const dateMatch = (dateText || rowText).match(/(\d{4})[-./](\d{2})[-./](\d{2})/);
      if (!dateMatch) return;

      const y = dateMatch[1], m = dateMatch[2], d = dateMatch[3];
      const dateKey = `${y}${m}${d}`;
      if (!weekDayStrings.includes(dateKey)) return;

      // 입실/퇴실은 반드시 해당 열에서만 추출
      let startTime = null;
      let endTime = null;
      if (inIdx >= 0 && row.cells[inIdx]) {
        const t = (row.cells[inIdx].textContent || '').trim();
        if (t && t !== '-' ) startTime = extractHHMM(t);
      }
      if (outIdx >= 0 && row.cells[outIdx]) {
        const t = (row.cells[outIdx].textContent || '').trim();
        if (t && t !== '-' ) endTime = extractHHMM(t);
      }

      parsedData.push({
        dateKey,
        date: new Date(`${y}-${m}-${d}`),
        startTime: startTime || null,
        endTime: endTime || null,
      });
    });

    return weekDays.map(day => {
      const dateKey = formatDateYYYYMMDD(day);
      return parsedData.find(d => d.dateKey === dateKey) || { dateKey, date: day, startTime: null, endTime: null };
    });
  }

  // 합성 행을 위한 표시용 날짜(YYYY-MM-DD)
  function formatDateYYYY_MM_DD(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  }

  // 합성 행을 위한 표시용 날짜(YYYY.MM.DD)
  function formatDateYYYY_DOT_MM_DOT_DD(date) {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}.${m}.${d}`;
  }

  // 주간 데이터 중 테이블에 없는 날짜에 대해 합성 행 추가 (오늘 포함 미래일)
  function ensureWeeklyRows(table, weeklyData) {
    const headerRow = table.querySelector('thead tr, tr:first-child');
    const baseColCount = headerRow?.cells.length || 1; // 초과근무 헤더 추가 전 기준
    const tbody = table.querySelector('tbody') || table;
    const dateIdx = findHeaderIndex(table, '근태일자');
    const noIdx = findHeaderIndex(table, 'NO');

    // 현재 존재하는 모든 행 텍스트 캐시
    const existingRows = Array.from(tbody.querySelectorAll('tr'));

    // 행 텍스트에서 날짜(YYYY-MM-DD, YYYY/MM/DD, YYYY.MM.DD 등)를 안전하게 추출해 YYYYMMDD로 변환
    const extractDateKeyFromText = (text) => {
      const m = text.match(/(\d{4})[\-./](\d{2})[\-./](\d{2})/);
      if (!m) return null;
      return `${m[1]}${m[2]}${m[3]}`;
    };

    weeklyData.forEach(dayData => {
      // 이미 해당 날짜가 포함된 행이 있는지 검사
      const exists = existingRows.some(r => extractDateKeyFromText(r.textContent) === dayData.dateKey);

      // 전주는 무시(weeklyData는 이미 이번 주만 포함). 오늘/미래에만 합성 행 생성
      const today = new Date(); today.setHours(0,0,0,0);
      const dateOnly = new Date(dayData.date); dateOnly.setHours(0,0,0,0);
      const isTodayOrFuture = dateOnly >= today;

      if (!exists && isTodayOrFuture) {
        const tr = document.createElement('tr');
        tr.className = 'tims-ext-injected tims-ext-row';

        // 기본 열 개수만큼 셀 생성(기본은 '-')
        for (let i = 0; i < baseColCount; i++) {
          const td = document.createElement('td');
          td.textContent = '-';
          td.style.color = '#6c757d';
          tr.appendChild(td);
        }

        // 근태일자 열에 날짜(YYYY.MM.DD) 채우기, 없으면 첫 번째 셀에 채움
        const dotDate = formatDateYYYY_DOT_MM_DOT_DD(dayData.date);
        if (dateIdx >= 0 && tr.cells[dateIdx]) {
          const dateCell = tr.cells[dateIdx];
          dateCell.textContent = dotDate;
          dateCell.style.color = '';
          dateCell.style.textAlign = 'center';
        } else if (tr.cells[0]) {
          const dateCell = tr.cells[0];
          dateCell.textContent = dotDate;
          dateCell.style.color = '';
          dateCell.style.textAlign = 'center';
        }

        // NO 열은 '-' 유지(가독성을 위해 가운데 정렬)
        if (noIdx >= 0 && tr.cells[noIdx]) {
          tr.cells[noIdx].textContent = '-';
          tr.cells[noIdx].style.color = '#6c757d';
          tr.cells[noIdx].style.textAlign = 'center';
        }

        tbody.appendChild(tr);
        console.log(`TIMS Ext: Created synthetic row for ${dayData.dateKey}`);
      }
    });
  }

  // 헤더에서 특정 라벨의 열 인덱스를 찾는다
  function findHeaderIndex(table, label) {
    const headerRow = table.querySelector('thead tr, tr:first-child');
    if (!headerRow) return -1;
    const cells = headerRow.cells || [];
    for (let i = 0; i < cells.length; i++) {
      const t = (cells[i].textContent || '').replace(/\s+/g, '').trim();
      if (t.includes(label)) return i;
    }
    return -1;
  }

  function fillOriginalInOutCells(row, table, dayData) {
    if (!row || !table) return;
    const inIdx = findHeaderIndex(table, '입실');
    const outIdx = findHeaderIndex(table, '퇴실');
    // 채울 수 있는 경우에만 덮어쓰기(비어있거나 '-')
    if (inIdx >= 0 && row.cells[inIdx] && dayData.startTime) {
      const cell = row.cells[inIdx];
      const cur = (cell.textContent || '').trim();
      if (!cur || cur === '-') cell.textContent = dayData.startTime;
    }
    if (outIdx >= 0 && row.cells[outIdx] && dayData.endTime) {
      const cell = row.cells[outIdx];
      const cur = (cell.textContent || '').trim();
      if (!cur || cur === '-') cell.textContent = dayData.endTime;
    }
  }

  function updateResult(div, startTime, endTime) {
    if (!startTime || !endTime) {
      div.textContent = '';
      return;
    }
    const overtime = calculateOvertime(startTime, endTime);
    const formatted = formatOvertime(overtime);
    div.textContent = formatted;
    div.style.color = overtime > 0 ? '#28a745' : (overtime < 0 ? '#dc3545' : '#6c757d');
  }

  async function renderFutureCell(cell, dayData, onTimeChange) {
    cell.style.backgroundColor = '#f9f9f9';
    const saved = await loadTimeData(dayData.dateKey);
    const startTime = saved?.startTime || '09:00';
    const endTime = saved?.endTime || '18:00';
    
    cell.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 4px; align-items: center;">
        <input type="time" step="60" value="${startTime}" class="tims-ext-input" style="width: 120px; min-width: 110px; border: 1px solid #ccc; font-size: 12px; padding: 2px;">
        <input type="time" step="60" value="${endTime}" class="tims-ext-input" style="width: 120px; min-width: 110px; border: 1px solid #ccc; font-size: 12px; padding: 2px;">
        <div class="tims-ext-result" style="font-size: 11px; height: 14px;"></div>
      </div>
    `;
    const [startInput, endInput] = cell.querySelectorAll('input');
    const resultDiv = cell.querySelector('.tims-ext-result');
    
    const handleChange = async () => {
      await saveTimeData(dayData.dateKey, { startTime: startInput.value, endTime: endInput.value });
      updateResult(resultDiv, startInput.value, endInput.value);
      if (onTimeChange) onTimeChange();
    };
    startInput.addEventListener('change', handleChange);
    endInput.addEventListener('change', handleChange);
    updateResult(resultDiv, startTime, endTime);
  }

  function renderPastCell(cell, dayData) {
    if (!dayData.startTime || !dayData.endTime) {
      cell.textContent = '-';
      return;
    }
    const overtime = calculateOvertime(dayData.startTime, dayData.endTime);
    cell.textContent = formatOvertime(overtime);
    cell.style.fontWeight = 'bold';
    cell.style.color = overtime > 0 ? '#28a745' : (overtime < 0 ? '#dc3545' : '');
  }
  
  async function renderTodayCell(cell, dayData, onTimeChange) {
    cell.style.backgroundColor = '#f9f9f9';
    const saved = await loadTimeData(dayData.dateKey);
    const startTime = dayData.startTime || saved?.startTime || '09:00';
    // 요청사항: 오늘은 기본 퇴근시간을 18:00으로 프리필(편집 가능)
    const endTime = dayData.endTime || saved?.endTime || '18:00';

    cell.innerHTML = `
      <div style="display: flex; flex-direction: column; gap: 4px; align-items: center;">
        <input type="time" step="60" value="${startTime}" class="tims-ext-input" style="width: 120px; min-width: 110px; border: 1px solid #ccc; font-size: 12px; padding: 2px;">
        <input type="time" step="60" value="${endTime}" placeholder="예상 퇴근 입력" class="tims-ext-input" style="width: 120px; min-width: 110px; border: 1px solid #ccc; font-size: 12px; padding: 2px;">
        <div class="tims-ext-result" style="font-size: 11px; height: 14px;"></div>
      </div>
    `;
    const [startInput, endInput] = cell.querySelectorAll('input');
    const resultDiv = cell.querySelector('.tims-ext-result');

    // 오늘은 입실은 API/표 값 기준으로 고정, 퇴실만 수정 가능
    startInput.value = startTime;
    startInput.disabled = true;

    const handleChange = async () => {
      await saveTimeData(dayData.dateKey, { startTime: startInput.value, endTime: endInput.value });
      updateResult(resultDiv, startInput.value, endInput.value);
      if (onTimeChange) onTimeChange();
    };
    endInput.addEventListener('change', handleChange);
    updateResult(resultDiv, startTime, endTime);
  }
  
  function renderTotalRow(table, weeklyData, savedData) {
      const totalOvertime = weeklyData.reduce((sum, day) => {
          const effectiveStart = day.startTime || null;
          let effectiveEnd = day.endTime || null;
          // 오늘은 다음 우선순위로 합계에 반영: 실제 OUT endTime > 저장값 > 기본 18:00(임시)
          if (!effectiveEnd && isToday(day.date)) {
            const saved = savedData?.[day.dateKey];
            if (saved?.endTime) {
              effectiveEnd = saved.endTime;
            } else {
              effectiveEnd = '18:00';
            }
          }
          const overtime = calculateOvertime(effectiveStart, effectiveEnd);
          return sum + (overtime || 0);
      }, 0);

      table.querySelector('.tims-ext-total-row')?.remove();
      const tbody = table.querySelector('tbody') || table;
      const totalRow = document.createElement('tr');
      totalRow.className = 'tims-ext-injected tims-ext-total-row';
      totalRow.style.cssText = 'background-color: #f2f2f2; font-weight: bold; text-align: center;';

      const colCount = table.querySelector('tr')?.cells.length || 1;
      totalRow.innerHTML = `
      <td colspan="${colCount - 1}" style="padding: 10px; text-align: right;">주간 초과근무 총계</td>
      <td style="padding: 10px; color: ${totalOvertime > 0 ? '#28a745' : (totalOvertime < 0 ? '#dc3545' : '')}">${formatOvertime(totalOvertime)}</td>
    `;
      tbody.appendChild(totalRow);
  }

  async function injectColumn(table, weeklyData, onTimeChange, savedData) {
    // 이전에 주입한 요소 제거(헤더/합성행/셀 등)
    table.querySelectorAll('.tims-ext-injected').forEach(el => el.remove());

    // 먼저 누락된 날짜에 대한 합성 행을 보장
    ensureWeeklyRows(table, weeklyData);

    const headerRow = table.querySelector('thead tr, tr:first-child');
    if (!headerRow) return;

    // 초과근무 헤더 추가
    const headerCell = document.createElement('th');
    headerCell.className = 'tims-ext-injected';
    headerCell.textContent = '초과근무';
    headerCell.style.cssText = 'padding: 8px; text-align: center; background-color: #f0f0f0;';
    headerRow.appendChild(headerCell);

    // 합성 행 생성 후 행 목록 재수집
    const rows = Array.from(table.querySelectorAll('tbody tr, tr:not(:first-child)'));

    // 각 행의 날짜키를 추출하는 도우미 (YYYYMMDD)
    const extractDateKeyFromRow = (row) => {
      const text = row.textContent || '';
      const m = text.match(/(\d{4})[\-./](\d{2})[\-./](\d{2})/);
      if (!m) return null;
      return `${m[1]}${m[2]}${m[3]}`;
    };

    for (const dayData of weeklyData) {
      const row = rows.find(r => extractDateKeyFromRow(r) === dayData.dateKey);
      if (!row) continue;

      const cell = row.insertCell();
      cell.className = 'tims-ext-injected';
      cell.style.cssText = 'text-align: center; vertical-align: middle;';
      
      dayData.isFuture = isFutureDate(dayData.date);
      // 원본 표의 입/퇴실 셀 채우기(가능한 경우)
      // 요구사항: 내일 이후(미래 날짜)는 원본 표의 입실/퇴실 칼럼을 채우지 않는다.
      if (!dayData.isFuture) {
        fillOriginalInOutCells(row, table, dayData);
      }
      const todayFlag = isToday(dayData.date);
      if (dayData.isFuture) {
        await renderFutureCell(cell, dayData, onTimeChange);
      } else if (todayFlag) {
        if (dayData.lastEventIsOut && dayData.endTime) {
          // 오늘이지만 실제 마지막 이벤트가 OUT이면 확정 표시
          renderPastCell(cell, dayData);
        } else {
          // 오늘이고 아직 최종 OUT이 아니면 편집 가능 렌더
          await renderTodayCell(cell, dayData, onTimeChange);
        }
      } else {
        renderPastCell(cell, dayData);
      }
    }
    renderTotalRow(table, weeklyData, savedData);
  }

  // ==================== 메인 로직 ====================
  let isProcessing = false;

  async function main() {
    if (isProcessing) return;
    isProcessing = true;
    
    try {
      console.log('TIMS Ext: main() start');
      const table = findAttendanceTable();
      if (!table) {
        console.warn('TIMS Ext: Attendance table not found on page');
        isProcessing = false;
        return;
      }

      const empInfo = findEmployeeInfoInDOM();
      console.log('TIMS Ext: empInfo from DOM:', empInfo);
      // empNo는 페이지 구조 변화로 누락될 수 있으므로, empNm만 있어도 진행하도록 완화
      if (!empInfo || !empInfo.empNm) {
        console.error('TIMS Ext: 사원 정보를 찾을 수 없습니다. (사원명 확인 실패)');
        isProcessing = false;
        return;
      }
      
      const weekDays = getWeekDays();
      let weeklyData = parseWeeklyDataFromTable(table, weekDays);
      const savedData = await loadAllTimeData();
      
      const dataPromises = weeklyData.map(async (dayData) => {
        // 테이블에서 입·퇴실이 모두 확보된 경우는 그대로 사용
        if (dayData.startTime && dayData.endTime) return dayData;

        if (isFutureDate(dayData.date)) {
           const saved = savedData[dayData.dateKey];
           dayData.startTime = dayData.startTime || saved?.startTime || '09:00';
           dayData.endTime = dayData.endTime || saved?.endTime || '18:00';
        } else {
            // 과거/오늘: 부족한 값만 API로 보충
            try {
                const html = await fetchAttendanceData(dayData.dateKey, empInfo.empNo, empInfo.empNm);
                const times = parseTimesFromHTML(html);
                const todayFlag = isToday(dayData.date);
                if (!dayData.startTime && times?.startTime) dayData.startTime = times.startTime;
                if (todayFlag) {
                  // 오늘은 마지막 이벤트가 OUT일 때만 endTime 채택 (폴백 결과는 사용 금지)
                  const lastOut = times?.lastEventIsOut === true;
                  dayData.lastEventIsOut = lastOut;
                  if (!dayData.endTime && lastOut && times?.endTime) {
                    dayData.endTime = times.endTime;
                  } else {
                    // 오늘인데 마지막이 OUT이 아니거나 불명확하면 endTime을 비워둔다
                    if (!dayData.endTime) dayData.endTime = null;
                  }
                  console.debug('TIMS Ext: Today decision', {
                    dateKey: dayData.dateKey,
                    inTimes: times?.inTimes,
                    outTimes: times?.outTimes,
                    lastEventIsOut: lastOut,
                    appliedEndTime: dayData.endTime
                  });
                } else {
                  if (!dayData.endTime && times?.endTime) dayData.endTime = times.endTime;
                }
            } catch (e) {
                console.error(`${dayData.dateKey} 데이터 API 호출 실패`, e);
            }
        }
        return dayData;
      });

      weeklyData = await Promise.all(dataPromises);

      const handleTimeChange = () => {
        clearTimeout(window.timsExtDebounce);
        window.timsExtDebounce = setTimeout(main, 200);
      };

      await injectColumn(table, weeklyData, handleTimeChange, savedData);

    } catch (error) {
      console.error('TIMS Ext: 메인 로직 오류 발생', error);
    } finally {
      console.log('TIMS Ext: main() end');
      isProcessing = false;
    }
  }

  // ==================== 실행 및 Observer 설정 ====================
  let observer;
  function setupObserver() {
    if (observer) observer.disconnect();
    
    observer = new MutationObserver((mutations) => {
      const isTableAdded = mutations.some(m => Array.from(m.addedNodes).some(n => n.nodeType === 1 && n.tagName === 'TABLE'));
      const isSelfMutation = mutations.some(m => Array.from(m.addedNodes).some(n => n.nodeType === 1 && n.classList?.contains('tims-ext-injected')));
      
      if (isTableAdded && !isSelfMutation) {
        console.log('TIMS Ext: Observer detected table addition; running main()');
        main();
      }
    });
    
    observer.observe(document.body, { childList: true, subtree: true });
    
    // 페이지가 이미 로드된 상태일 수 있으므로 초기 실행
    main();
  }

  if (document.readyState === 'complete') {
    setupObserver();
  } else {
    window.addEventListener('load', setupObserver);
  }
}
