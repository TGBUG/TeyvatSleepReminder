'use strict';

const MINUTE = 60 * 1000;
const DAY = 24 * 60 * MINUTE;
const DEFAULT_START = 23 * 60;
const DEFAULT_END = 7 * 60;

function parseTime(value, fallbackMinutes) {
  if (typeof value !== 'string') return fallbackMinutes;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return fallbackMinutes;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return fallbackMinutes;
  return hour * 60 + minute;
}

function pad(n) {
  return String(n).padStart(2, '0');
}

function formatClock(date) {
  return pad(date.getHours()) + ':' + pad(date.getMinutes());
}

function dayKey(date) {
  return date.getFullYear() + '-' + pad(date.getMonth() + 1) + '-' + pad(date.getDate());
}

function atMinutes(base, minutes) {
  const date = new Date(base);
  date.setHours(Math.floor(minutes / 60), minutes % 60, 0, 0);
  return date;
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

/**
 * Return the window that contains (or follows) the given instant.
 * startMin === endMin is treated as a 24-hour window.
 */
function getWindow(now, startMin, endMin) {
  const nowMs = now.getTime();
  const startToday = atMinutes(now, startMin);

  if (startMin === endMin) {
    const start = nowMs >= startToday.getTime() ? startToday : addDays(startToday, -1);
    return { active: true, start, end: addDays(start, 1) };
  }

  if (startMin < endMin) {
    const endToday = atMinutes(now, endMin);
    if (nowMs >= startToday.getTime() && nowMs < endToday.getTime()) {
      return { active: true, start: startToday, end: endToday };
    }
    return {
      active: false,
      start: nowMs < startToday.getTime() ? startToday : addDays(startToday, 1),
      end: null
    };
  }

  // Crosses midnight (for example 23:00 -> 07:00).
  if (nowMs >= startToday.getTime()) {
    return {
      active: true,
      start: startToday,
      end: addDays(atMinutes(now, endMin), 1)
    };
  }

  const endToday = atMinutes(now, endMin);
  if (nowMs < endToday.getTime()) {
    return {
      active: true,
      start: addDays(startToday, -1),
      end: endToday
    };
  }

  return { active: false, start: startToday, end: null };
}

function getNextWindowStart(now, startMin) {
  const today = atMinutes(now, startMin);
  return now.getTime() < today.getTime() ? today : addDays(today, 1);
}

/**
 * Compute everything the UI needs to know about the current schedule.
 * slotKey is stable for a given scheduled reminder, so a one-second
 * scheduler tick can avoid firing the same slot twice.
 */
function getScheduleState(now, config) {
  const startMin = parseTime(config && config.startTime, DEFAULT_START);
  const endMin = parseTime(config && config.endTime, DEFAULT_END);
  const intervalMinutes = Math.max(1, Math.round(Number(config && config.intervalMinutes) || 30));
  const intervalMs = intervalMinutes * MINUTE;
  const window = getWindow(now, startMin, endMin);
  const nowMs = now.getTime();

  if (!window.active) {
    const nextAt = window.start;
    return {
      active: false,
      inWindow: false,
      startTime: config && config.startTime,
      endTime: config && config.endTime,
      intervalMinutes,
      windowStart: null,
      windowEnd: null,
      slotIndex: null,
      slotKey: null,
      slotAt: null,
      nextAt: nextAt.toISOString(),
      nextFireAt: nextAt.toISOString(),
      nextWindowStart: nextAt.toISOString(),
      secondsToNext: Math.max(0, Math.round((nextAt.getTime() - nowMs) / 1000)),
      secondsToWindowEnd: null
    };
  }

  const elapsed = Math.max(0, nowMs - window.start.getTime());
  const slotIndex = Math.floor(elapsed / intervalMs);
  const slotAt = new Date(window.start.getTime() + slotIndex * intervalMs);
  const nextSlot = new Date(window.start.getTime() + (slotIndex + 1) * intervalMs);
  const slotKey = dayKey(window.start) + '#' + slotIndex;
  const nextWindowStart = getNextWindowStart(window.end, startMin);

  let nextFireAt;
  if (nextSlot.getTime() < window.end.getTime()) {
    nextFireAt = nextSlot;
  } else {
    nextFireAt = nextWindowStart;
  }

  return {
    active: true,
    inWindow: true,
    startTime: config && config.startTime,
    endTime: config && config.endTime,
    intervalMinutes,
    windowStart: window.start.toISOString(),
    windowEnd: window.end.toISOString(),
    slotIndex,
    slotKey,
    slotAt: slotAt.toISOString(),
    nextAt: nextFireAt.toISOString(),
    nextFireAt: nextFireAt.toISOString(),
    nextWindowStart: nextWindowStart.toISOString(),
    secondsToNext: Math.max(0, Math.round((nextFireAt.getTime() - nowMs) / 1000)),
    secondsToWindowEnd: Math.max(0, Math.round((window.end.getTime() - nowMs) / 1000))
  };
}

function nextSlotAfter(now, config) {
  return new Date(getScheduleState(now, config).nextFireAt);
}

function describeWindow(config) {
  const start = parseTime(config && config.startTime, DEFAULT_START);
  const end = parseTime(config && config.endTime, DEFAULT_END);
  return {
    start: pad(Math.floor(start / 60)) + ':' + pad(start % 60),
    end: pad(Math.floor(end / 60)) + ':' + pad(end % 60),
    crossesMidnight: start > end,
    allDay: start === end
  };
}

module.exports = {
  MINUTE,
  DAY,
  parseTime,
  formatClock,
  dayKey,
  getWindow,
  getScheduleState,
  nextSlotAfter,
  describeWindow,
  getNextWindowStart
};
