/**
 * API 호출 로직
 */

/**
 * 근태 데이터 API 호출
 * @param {string} startDate - 시작 날짜 (YYYYMMDD)
 * @param {string} endDate - 종료 날짜 (YYYYMMDD)
 * @param {string} empNo - 사원번호
 * @param {string} empNm - 사원명 (URL 인코딩 필요)
 * @returns {Promise<string>} API 응답 HTML
 */
export async function fetchAttendanceData(startDate, endDate, empNo, empNm) {
  const url = `/insa/attend/findEmpRouteList.screen?srchStDate=${startDate}&srchEdDate=${endDate}&srchEmpNo=${empNo}&srchEmpNm=${empNm}`;
  
  try {
    const response = await fetch(url, {
      method: 'GET',
      credentials: 'include', // 세션 쿠키 포함
    });
    
    if (!response.ok) {
      throw new Error(`API 호출 실패: ${response.status}`);
    }
    
    return await response.text();
  } catch (error) {
    console.error('근태 데이터 API 호출 오류:', error);
    throw error;
  }
}

/**
 * API 응답 HTML에서 출퇴근 시간 추출
 * @param {string} html - API 응답 HTML
 * @param {string} targetDate - 대상 날짜 (YYYYMMDD)
 * @returns {Object|null} { startTime: "09:00", endTime: "18:00" } 또는 null
 */
export function parseAttendanceFromHTML(html, targetDate) {
  try {
    // HTML을 파싱하기 위한 임시 DOM 생성
    const parser = new DOMParser();
    const doc = parser.parseFromString(html, 'text/html');
    
    // 테이블 찾기 (일반적인 테이블 선택자들 시도)
    const tables = doc.querySelectorAll('table');
    
    for (const table of tables) {
      const rows = table.querySelectorAll('tr');
      
      // 첫 번째 데이터 행 찾기 (헤더 제외)
      for (let i = 1; i < rows.length; i++) {
        const row = rows[i];
        const cells = row.querySelectorAll('td');
        
        if (cells.length === 0) continue;
        
        // 날짜 셀 찾기 (YYYYMMDD 형식 또는 다른 형식)
        let dateCell = null;
        let dateIndex = -1;
        
        for (let j = 0; j < cells.length; j++) {
          const cellText = cells[j].textContent.trim();
          // 날짜 형식 확인 (YYYYMMDD, YYYY-MM-DD, YYYY/MM/DD 등)
          if (cellText.includes(targetDate.substring(0, 4)) && 
              cellText.includes(targetDate.substring(4, 6)) &&
              cellText.includes(targetDate.substring(6, 8))) {
            dateCell = cellText;
            dateIndex = j;
            break;
          }
        }
        
        if (dateIndex === -1) continue;
        
        // 출퇴근 시간 찾기 (시간 형식 HH:mm 또는 HH:mm:ss)
        const timePattern = /(\d{1,2}):(\d{2})(?::\d{2})?/g;
        const times = [];
        
        for (let j = 0; j < cells.length; j++) {
          const cellText = cells[j].textContent.trim();
          const matches = cellText.match(timePattern);
          if (matches) {
            times.push(...matches);
          }
        }
        
        if (times.length >= 2) {
          // 첫 번째 시간을 출근, 두 번째 시간을 퇴근으로 가정
          const startTime = normalizeTime(times[0]);
          const endTime = normalizeTime(times[1]);
          
          return { startTime, endTime };
        }
      }
    }
    
    return null;
  } catch (error) {
    console.error('HTML 파싱 오류:', error);
    return null;
  }
}

/**
 * 시간 문자열을 HH:mm 형식으로 정규화
 * @param {string} timeStr - 시간 문자열
 * @returns {string} HH:mm 형식
 */
function normalizeTime(timeStr) {
  // HH:mm 또는 HH:mm:ss 형식을 HH:mm로 변환
  const parts = timeStr.split(':');
  return `${parts[0].padStart(2, '0')}:${parts[1]}`;
}

/**
 * URL에서 사원 정보 추출
 * @returns {Object|null} { empNo: "2023605", empNm: "손동영" } 또는 null
 */
export function extractEmployeeInfoFromURL() {
  try {
    const urlParams = new URLSearchParams(window.location.search);
    const empNo = urlParams.get('srchEmpNo');
    const empNm = urlParams.get('srchEmpNm');
    
    if (empNo && empNm) {
      return {
        empNo,
        empNm: decodeURIComponent(empNm)
      };
    }
    
    return null;
  } catch (error) {
    console.error('URL에서 사원 정보 추출 오류:', error);
    return null;
  }
}

/**
 * 사원명을 URL 인코딩
 * @param {string} empNm - 사원명
 * @returns {string} URL 인코딩된 사원명
 */
export function encodeEmployeeName(empNm) {
  return encodeURIComponent(empNm);
}

