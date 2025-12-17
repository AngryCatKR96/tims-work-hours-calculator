/**
 * 사용자 입력값 저장/로드 관리
 */

/**
 * 날짜별 출퇴근 시간 저장
 * @param {string} dateKey - 날짜 키 (YYYYMMDD 형식)
 * @param {Object} timeData - 출퇴근 시간 데이터 { startTime: "09:00", endTime: "18:00" }
 * @returns {Promise<void>}
 */
export async function saveTimeData(dateKey, timeData) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['timeData'], (result) => {
      const allTimeData = result.timeData || {};
      allTimeData[dateKey] = timeData;
      chrome.storage.local.set({ timeData: allTimeData }, () => {
        resolve();
      });
    });
  });
}

/**
 * 날짜별 출퇴근 시간 로드
 * @param {string} dateKey - 날짜 키 (YYYYMMDD 형식)
 * @returns {Promise<Object|null>} 출퇴근 시간 데이터 또는 null
 */
export async function loadTimeData(dateKey) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['timeData'], (result) => {
      const allTimeData = result.timeData || {};
      resolve(allTimeData[dateKey] || null);
    });
  });
}

/**
 * 모든 날짜의 출퇴근 시간 로드
 * @returns {Promise<Object>} 모든 날짜의 출퇴근 시간 데이터
 */
export async function loadAllTimeData() {
  return new Promise((resolve) => {
    chrome.storage.local.get(['timeData'], (result) => {
      resolve(result.timeData || {});
    });
  });
}

/**
 * 특정 날짜의 데이터 삭제
 * @param {string} dateKey - 날짜 키 (YYYYMMDD 형식)
 * @returns {Promise<void>}
 */
export async function deleteTimeData(dateKey) {
  return new Promise((resolve) => {
    chrome.storage.local.get(['timeData'], (result) => {
      const allTimeData = result.timeData || {};
      delete allTimeData[dateKey];
      chrome.storage.local.set({ timeData: allTimeData }, () => {
        resolve();
      });
    });
  });
}

