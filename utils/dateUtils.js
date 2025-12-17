/**
 * 날짜 계산 유틸리티
 */

/**
 * 이번 주 월요일부터 금요일까지의 날짜 배열을 반환
 * @returns {Array<Date>} 월~금 날짜 배열
 */
export function getWeekDays() {
  const today = new Date();
  const dayOfWeek = today.getDay(); // 0: 일요일, 1: 월요일, ..., 6: 토요일
  
  // 이번 주 월요일 계산
  const monday = new Date(today);
  const daysToMonday = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;
  monday.setDate(today.getDate() + daysToMonday);
  
  // 월~금 날짜 배열 생성
  const weekDays = [];
  for (let i = 0; i < 5; i++) {
    const date = new Date(monday);
    date.setDate(monday.getDate() + i);
    weekDays.push(date);
  }
  
  return weekDays;
}

/**
 * 날짜를 YYYYMMDD 형식 문자열로 변환
 * @param {Date} date - 변환할 날짜
 * @returns {string} YYYYMMDD 형식 문자열
 */
export function formatDateYYYYMMDD(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
}

/**
 * 날짜가 미래인지 확인
 * @param {Date} date - 확인할 날짜
 * @returns {boolean} 미래 날짜면 true
 */
export function isFutureDate(date) {
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const checkDate = new Date(date);
  checkDate.setHours(0, 0, 0, 0);
  return checkDate > today;
}

/**
 * 날짜가 오늘인지 확인
 * @param {Date} date - 확인할 날짜
 * @returns {boolean} 오늘이면 true
 */
export function isToday(date) {
  const today = new Date();
  return (
    date.getFullYear() === today.getFullYear() &&
    date.getMonth() === today.getMonth() &&
    date.getDate() === today.getDate()
  );
}

