/**
 * 근무 시간 계산 로직
 */

const DEFAULT_WORK_HOURS = 8; // 기본 근무 시간 (8시간)
const DEFAULT_BREAK_TIME = 1; // 기본 휴게 시간 (1시간)

/**
 * 시간 문자열(HH:mm)을 분 단위로 변환
 * @param {string} timeStr - 시간 문자열 (예: "09:00")
 * @returns {number} 분 단위
 */
export function timeToMinutes(timeStr) {
  if (!timeStr) return 0;
  const [hours, minutes] = timeStr.split(':').map(Number);
  return hours * 60 + minutes;
}

/**
 * 분 단위를 시간 문자열(HH:mm)로 변환
 * @param {number} minutes - 분 단위
 * @returns {string} 시간 문자열 (예: "09:00")
 */
export function minutesToTime(minutes) {
  const hours = Math.floor(minutes / 60);
  const mins = minutes % 60;
  return `${String(hours).padStart(2, '0')}:${String(mins).padStart(2, '0')}`;
}

/**
 * 실제 근무 시간 계산 (분 단위)
 * @param {string} startTime - 출근 시간 (HH:mm)
 * @param {string} endTime - 퇴근 시간 (HH:mm)
 * @param {number} breakTime - 휴게 시간 (시간 단위, 기본 1시간)
 * @returns {number} 실제 근무 시간 (분 단위)
 */
export function calculateWorkMinutes(startTime, endTime, breakTime = DEFAULT_BREAK_TIME) {
  if (!startTime || !endTime) return 0;
  
  const startMinutes = timeToMinutes(startTime);
  const endMinutes = timeToMinutes(endTime);
  const breakMinutes = breakTime * 60;
  
  if (endMinutes < startMinutes) {
    // 자정을 넘어가는 경우 (예: 22:00 ~ 02:00)
    return (24 * 60 - startMinutes + endMinutes) - breakMinutes;
  }
  
  return (endMinutes - startMinutes) - breakMinutes;
}

/**
 * 초과/부족 시간 계산
 * @param {string} startTime - 출근 시간 (HH:mm)
 * @param {string} endTime - 퇴근 시간 (HH:mm)
 * @param {number} standardHours - 기준 근무 시간 (시간 단위, 기본 8시간)
 * @param {number} breakTime - 휴게 시간 (시간 단위, 기본 1시간)
 * @returns {number} 초과/부족 시간 (분 단위, 양수면 초과, 음수면 부족)
 */
export function calculateOvertime(startTime, endTime, standardHours = DEFAULT_WORK_HOURS, breakTime = DEFAULT_BREAK_TIME) {
  const workMinutes = calculateWorkMinutes(startTime, endTime, breakTime);
  const standardMinutes = standardHours * 60;
  return workMinutes - standardMinutes;
}

/**
 * 분 단위를 시간 문자열로 포맷팅 (예: "+1.5h", "-0.5h")
 * @param {number} minutes - 분 단위
 * @returns {string} 포맷팅된 문자열
 */
export function formatOvertime(minutes) {
  if (minutes === 0) return "0h";
  
  const hours = minutes / 60;
  const sign = minutes > 0 ? "+" : "";
  return `${sign}${hours.toFixed(1)}h`;
}

/**
 * 주간 총계 계산
 * @param {Array<Object>} dailyData - 일별 데이터 배열 [{ startTime, endTime, ... }, ...]
 * @param {number} standardHours - 기준 근무 시간 (시간 단위)
 * @param {number} breakTime - 휴게 시간 (시간 단위)
 * @returns {number} 주간 총 초과/부족 시간 (분 단위)
 */
export function calculateWeeklyTotal(dailyData, standardHours = DEFAULT_WORK_HOURS, breakTime = DEFAULT_BREAK_TIME) {
  return dailyData.reduce((total, day) => {
    if (!day.startTime || !day.endTime) return total;
    const overtime = calculateOvertime(day.startTime, day.endTime, standardHours, breakTime);
    return total + overtime;
  }, 0);
}

