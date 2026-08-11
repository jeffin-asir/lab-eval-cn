// Deprecated: use utils/labSession.js instead.
// Kept for backward compatibility with existing FN/AN data and imports.

export { parseSlotKey, buildSlotKey, normalizeSessionId } from './labSession.js';

export function getCurrentSlotKey(now = new Date()) {
  const minutesSinceMidnight = now.getHours() * 60 + now.getMinutes();
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  const date = `${y}-${m}-${day}`;

  if (minutesSinceMidnight >= 30 && minutesSinceMidnight < 13 * 60) {
    return `${date}_0030_1300`;
  }
  if (minutesSinceMidnight >= 13 * 60 && minutesSinceMidnight < 17 * 60 + 30) {
    return `${date}_1300_1730`;
  }
  return `${date}_${minutesSinceMidnight < 30 ? '0030_1300' : '1300_1730'}`;
}
