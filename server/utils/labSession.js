// Lab session identity and wall-clock windows.
//
// slotKey format:  {moduleId}_{YYYY-MM-DD}_{HHMM}_{HHMM}
//   e.g. 674a1b2c3d4e5f6789012345_2026-07-13_0900_1230
// sessionId format: {moduleId}_{YYYYMMDD}_{HHMM}_{HHMM}
//   e.g. 674a1b2c3d4e5f6789012345_20260713_0900_1230
//
// Legacy slotKeys without moduleId or with FN/AN are still accepted.

export function parseTimeHHMM(timeStr) {
  const match = String(timeStr || '').trim().match(/^(\d{1,2}):(\d{2})$/);
  if (!match) return null;
  const hours = parseInt(match[1], 10);
  const minutes = parseInt(match[2], 10);
  if (hours < 0 || hours > 23 || minutes < 0 || minutes > 59) return null;
  const display = `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`;
  const compact = display.replace(':', '');
  return { hours, minutes, display, compact };
}

export function dateKey(d = new Date()) {
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, '0');
  const day = String(d.getDate()).padStart(2, '0');
  return `${y}-${m}-${day}`;
}

export function combineDateAndTime(baseDate, timeHHMM) {
  const parsed = parseTimeHHMM(timeHHMM);
  if (!parsed) throw new Error(`Invalid time "${timeHHMM}". Use HH:MM (24-hour).`);
  const d = new Date(baseDate);
  d.setHours(parsed.hours, parsed.minutes, 0, 0);
  return d;
}

export function buildSlotKey(baseDate, startTime, endTime, moduleId) {
  const mod = String(moduleId || '').trim();
  if (!mod) throw new Error('moduleId is required to build a slotKey.');
  const start = parseTimeHHMM(startTime);
  const end = parseTimeHHMM(endTime);
  if (!start || !end) {
    throw new Error('Both startTime and endTime are required in HH:MM format.');
  }
  const startMs = start.hours * 60 + start.minutes;
  const endMs = end.hours * 60 + end.minutes;
  if (endMs <= startMs) {
    throw new Error('endTime must be after startTime on the same day.');
  }
  return `${mod}_${dateKey(baseDate)}_${start.compact}_${end.compact}`;
}

function parseTimeParts(startCompact, endCompact) {
  const start = parseTimeHHMM(`${startCompact.slice(0, 2)}:${startCompact.slice(2)}`);
  const end = parseTimeHHMM(`${endCompact.slice(0, 2)}:${endCompact.slice(2)}`);
  if (!start || !end) return null;
  return { startTime: start.display, endTime: end.display };
}

export function parseSlotKey(slotKey) {
  if (!slotKey) return null;
  const parts = String(slotKey).split('_');

  // moduleId_YYYY-MM-DD_HHMM_HHMM[_session|_exam]
  if (parts.length >= 4 && /^\d{4}-\d{2}-\d{2}$/.test(parts[1])) {
    const times = parseTimeParts(parts[2], parts[3]);
    if (times) {
      const deliveryMode = /^(session|exam)$/i.test(parts[4] || '')
        ? parts[4].toLowerCase()
        : '';
      return { moduleId: parts[0], datePart: parts[1], deliveryMode, ...times };
    }
  }

  // Legacy: YYYY-MM-DD_HHMM_HHMM
  if (parts.length === 3 && /^\d{4}-\d{2}-\d{2}$/.test(parts[0])) {
    const times = parseTimeParts(parts[1], parts[2]);
    if (times) return { datePart: parts[0], ...times };
  }

  // Legacy FN/AN: 2026-07-13_AN
  if (parts.length === 2 && /^\d{4}-\d{2}-\d{2}$/.test(parts[0]) && /^(FN|AN)$/i.test(parts[1])) {
    const slot = parts[1].toUpperCase();
    return {
      datePart: parts[0],
      startTime: slot === 'FN' ? '00:30' : '13:00',
      endTime: slot === 'FN' ? '13:00' : '17:30',
      legacySlot: slot,
    };
  }

  return null;
}

export function normalizeSessionId(sessionIdOrSlotKey) {
  if (!sessionIdOrSlotKey) return null;
  const value = String(sessionIdOrSlotKey).trim();
  if (!value) return null;
  if (value === 'FREE_CODING') return value;

  const parsed = parseSlotKey(value);
  if (parsed) {
    const dateCompact = parsed.datePart.replace(/-/g, '');
    const startCompact = parsed.startTime.replace(':', '');
    const endCompact = parsed.endTime.replace(':', '');
    const deliverySuffix = parsed.deliveryMode ? `_${parsed.deliveryMode}` : '';
    if (parsed.moduleId) {
      return `${parsed.moduleId}_${dateCompact}_${startCompact}_${endCompact}${deliverySuffix}`;
    }
    return `${dateCompact}_${startCompact}_${endCompact}${deliverySuffix}`;
  }

  // Already normalized or legacy compact: 20260713_AN, moduleId_20260713_0900_1230
  const [first, ...rest] = value.split('_');
  if (!first || rest.length === 0) return value.replace(/-/g, '');
  if (/^\d{4}-\d{2}-\d{2}$/.test(first)) {
    return `${first.replace(/-/g, '')}_${rest.join('_').toUpperCase()}`;
  }
  return `${first}_${rest.map((part, idx) => (idx === 0 ? part.replace(/-/g, '') : part)).join('_')}`;
}

// A session and an exam may use the same module and scheduled time. Their
// runtime workspaces must still be isolated, so mode is part of the resource
// identity used for sessions, containers, and volumes.
export function buildRuntimeSessionId(slotKey, deliveryMode = 'session') {
  const normalized = normalizeSessionId(slotKey);
  if (!normalized || normalized === 'FREE_CODING' || normalized.startsWith('PRACTICE_')) return normalized;
  if (/(?:_|^)(session|exam)$/i.test(normalized)) return normalized;
  return `${normalized}_${deliveryMode === 'exam' ? 'exam' : 'session'}`;
}

export function formatSlotLabel(slotKey, startTime, endTime) {
  if (startTime && endTime) return `${startTime} – ${endTime}`;
  const parsed = parseSlotKey(slotKey);
  if (parsed) return `${parsed.startTime} – ${parsed.endTime}`;
  return slotKey || 'Not specified';
}

export function resolveModuleTimes(module, baseDate = new Date()) {
  let startTime = module.startTime;
  let endTime = module.endTime;

  if (!startTime || !endTime) {
    const legacy = String(module.sessionSlot || '').toUpperCase();
    if (legacy === 'FN') {
      startTime = startTime || '00:30';
      endTime = endTime || '13:00';
    } else if (legacy === 'AN') {
      startTime = startTime || '13:00';
      endTime = endTime || '17:30';
    } else {
      startTime = startTime || '09:00';
      endTime = endTime || '12:00';
    }
  }

  const moduleId = module._id?.toString?.() || module.moduleId || module.id;
  if (!moduleId) throw new Error('moduleId is required to resolve lab session times.');

  const moduleDate = module.date ? new Date(module.date) : baseDate;
  const startsAt = combineDateAndTime(moduleDate, startTime);
  const endsAt = combineDateAndTime(moduleDate, endTime);
  const slotKey = buildSlotKey(moduleDate, startTime, endTime, moduleId);

  return { startTime, endTime, startsAt, endsAt, slotKey, moduleDate, moduleId };
}

export function buildQuestionSchedule(module, questionIds = []) {
  const { startTime, moduleDate } = resolveModuleTimes(module);
  const existing = Array.isArray(module.questionSchedule) ? module.questionSchedule : [];
  const byQuestionId = new Map(
    existing.map((entry) => [
      (entry.question?._id || entry.question)?.toString(),
      entry.availableAt || startTime,
    ])
  );

  return questionIds.map((qId) => {
    const id = qId?.toString?.() || String(qId);
    const availableAt = byQuestionId.get(id) || startTime;
    return {
      question: id,
      availableAt,
      availableAtDate: combineDateAndTime(moduleDate, availableAt),
    };
  });
}

export function isQuestionAvailable(scheduleEntry, now = new Date()) {
  if (!scheduleEntry?.availableAtDate) return true;
  return new Date(scheduleEntry.availableAtDate) <= now;
}
