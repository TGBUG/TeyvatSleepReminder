'use strict';

const { getScheduleState, parseTime, dayKey } = require('./schedule');

const RETENTION_DAYS = 30;
const MAX_OBSERVED_SECONDS = 24 * 60 * 60;

function pad(n) {
  return String(n).padStart(2, '0');
}

function startOfLocalDay(date) {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

function addDays(date, days) {
  const next = new Date(date);
  next.setDate(next.getDate() + days);
  return next;
}

function parseDateKey(key) {
  if (typeof key !== 'string') return null;
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(key);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(year, month - 1, day);
  if (date.getFullYear() !== year || date.getMonth() !== month - 1 || date.getDate() !== day) {
    return null;
  }
  return date;
}

function sleepWindowMinutes(config) {
  const start = parseTime(config && config.sleepStartTime, 23 * 60 + 30);
  const end = parseTime(config && config.sleepEndTime, 7 * 60 + 30);
  if (start === end) return 24 * 60;
  if (start < end) return end - start;
  return 24 * 60 - start + end;
}

function sleepState(now, config) {
  const schedule = getScheduleState(now, {
    startTime: config && config.sleepStartTime,
    endTime: config && config.sleepEndTime,
    intervalMinutes: 1
  });

  if (!schedule.active) {
    return {
      active: false,
      key: null,
      start: null,
      end: null,
      nextAt: new Date(schedule.nextAt),
      windowSeconds: 0,
      windowMinutes: sleepWindowMinutes(config)
    };
  }

  const start = new Date(schedule.windowStart);
  const end = new Date(schedule.windowEnd);
  return {
    active: true,
    key: dayKey(start),
    start,
    end,
    nextAt: new Date(schedule.nextAt),
    windowSeconds: Math.max(1, Math.round((end.getTime() - start.getTime()) / 1000)),
    windowMinutes: Math.max(1, Math.round((end.getTime() - start.getTime()) / 60000))
  };
}

function createSleepStore() {
  return { version: 1, days: {} };
}

function normalizeSleepStore(raw) {
  const store = createSleepStore();
  if (!raw || typeof raw !== 'object' || !raw.days || typeof raw.days !== 'object') return store;
  for (const [key, value] of Object.entries(raw.days)) {
    if (!parseDateKey(key) || !value || typeof value !== 'object') continue;
    const observed = Number(value.observedSeconds);
    if (!Number.isFinite(observed) || observed < 0) continue;
    const firstSeen = typeof value.firstSeenAt === 'string' ? value.firstSeenAt : null;
    const lastSeen = typeof value.lastSeenAt === 'string' ? value.lastSeenAt : null;
    if (!firstSeen || Number.isNaN(new Date(firstSeen).getTime())) continue;
    store.days[key] = {
      date: key,
      firstSeenAt: firstSeen,
      lastSeenAt: lastSeen && !Number.isNaN(new Date(lastSeen).getTime()) ? lastSeen : firstSeen,
      observedSeconds: Math.min(MAX_OBSERVED_SECONDS, Math.round(observed)),
      windowStart: typeof value.windowStart === 'string' ? value.windowStart : null,
      windowEnd: typeof value.windowEnd === 'string' ? value.windowEnd : null,
      sleepStart: typeof value.sleepStart === 'string' ? value.sleepStart : null,
      sleepEnd: typeof value.sleepEnd === 'string' ? value.sleepEnd : null
    };
  }
  return store;
}

/**
 * Accumulate observed running time for the current sleep window.
 * Returns the record even when it was just created with zero observed seconds.
 */
function recordSleepTick(store, now, config, lastTickAt) {
  const state = sleepState(now, config);
  if (!state.active) {
    return { recorded: false, created: false, state, day: null };
  }

  const nowIso = now.toISOString();
  const nowMs = now.getTime();
  let day = store.days[state.key];
  let created = false;

  if (!day) {
    day = {
      date: state.key,
      firstSeenAt: nowIso,
      lastSeenAt: nowIso,
      observedSeconds: 0,
      windowStart: state.start.toISOString(),
      windowEnd: state.end.toISOString(),
      sleepStart: config.sleepStartTime,
      sleepEnd: config.sleepEndTime
    };
    store.days[state.key] = day;
    created = true;
  }

  const lastMs = lastTickAt ? new Date(lastTickAt).getTime() : 0;
  let delta = 0;
  if (lastMs && nowMs >= state.start.getTime() && nowMs - lastMs >= 0 && nowMs - lastMs <= 10000) {
    delta = Math.min(5, Math.round((nowMs - lastMs) / 1000));
  }

  day.observedSeconds = Math.min(
    state.windowSeconds,
    Math.max(0, Math.round(day.observedSeconds + delta))
  );
  day.lastSeenAt = nowIso;
  day.windowStart = state.start.toISOString();
  day.windowEnd = state.end.toISOString();
  if (!day.sleepStart) day.sleepStart = config.sleepStartTime;
  if (!day.sleepEnd) day.sleepEnd = config.sleepEndTime;

  return { recorded: true, created, state, day };
}

function pruneSleepStore(store, now, days = RETENTION_DAYS) {
  if (!store || !store.days) return 0;
  const cutoff = startOfLocalDay(now);
  cutoff.setDate(cutoff.getDate() - (days - 1));
  let removed = 0;
  for (const key of Object.keys(store.days)) {
    const date = parseDateKey(key);
    if (!date || date.getTime() < cutoff.getTime()) {
      delete store.days[key];
      removed += 1;
    }
  }
  return removed;
}

function buildSleepChart(store, now, days = RETENTION_DAYS) {
  const end = startOfLocalDay(now);
  const chart = [];
  for (let offset = days - 1; offset >= 0; offset -= 1) {
    const date = addDays(end, -offset);
    const key = dayKey(date);
    const record = store.days[key] || null;
    chart.push({
      date: key,
      label: pad(date.getMonth() + 1) + '-' + pad(date.getDate()),
      weekday: '日一二三四五六'[date.getDay()],
      record: record ? {
        date: record.date,
        firstSeenAt: record.firstSeenAt,
        lastSeenAt: record.lastSeenAt,
        observedSeconds: record.observedSeconds,
        windowStart: record.windowStart,
        windowEnd: record.windowEnd
      } : null
    });
  }
  return chart;
}

function buildSleepSummary(store, now, config, days = RETENTION_DAYS) {
  pruneSleepStore(store, now, days);
  const chart = buildSleepChart(store, now, days);
  const records = chart
    .filter((entry) => entry.record)
    .map((entry) => ({ ...entry.record, label: entry.label, weekday: entry.weekday }))
    .reverse();
  const totalSeconds = records.reduce((sum, record) => sum + record.observedSeconds, 0);
  const state = sleepState(now, config);
  const latestRecord = records[0] || null;
  const chartKeys = new Set(chart.map((entry) => entry.date));

  // The current sleep window is not a completed night yet. The streak is
  // counted backwards from the last completed window start date.
  const completedAnchor = state.active ? state.start : state.nextAt;
  let cursor = addDays(startOfLocalDay(completedAnchor), -1);
  let streakDays = 0;
  for (let i = 0; i < days; i += 1) {
    const key = dayKey(cursor);
    if (!chartKeys.has(key)) break;
    if (store.days[key]) break;
    streakDays += 1;
    cursor = addDays(cursor, -1);
  }

  return {
    chart,
    records,
    stats: {
      recordedDays: records.length,
      totalSeconds,
      averageSeconds: records.length ? Math.round(totalSeconds / records.length) : 0,
      latestDate: latestRecord ? latestRecord.date : null,
      lastLateNightDate: latestRecord ? latestRecord.date : null,
      streakDays,
      noRecords: records.length === 0
    },
    windowMinutes: sleepWindowMinutes(config),
    state: {
      active: state.active,
      key: state.key,
      nextAt: state.nextAt.toISOString(),
      windowStart: state.start ? state.start.toISOString() : null,
      windowEnd: state.end ? state.end.toISOString() : null
    }
  };
}

module.exports = {
  RETENTION_DAYS,
  sleepWindowMinutes,
  sleepState,
  createSleepStore,
  normalizeSleepStore,
  recordSleepTick,
  pruneSleepStore,
  buildSleepChart,
  buildSleepSummary,
  parseDateKey
};
