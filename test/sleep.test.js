'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  sleepWindowMinutes,
  sleepState,
  createSleepStore,
  normalizeSleepStore,
  recordSleepTick,
  pruneSleepStore,
  buildSleepSummary,
  parseDateKey
} = require('../src/core/sleep');
const { dayKey } = require('../src/core/schedule');

function local(y, mo, d, h, mi, s = 0) {
  return new Date(y, mo - 1, d, h, mi, s, 0);
}

const config = { sleepStartTime: '23:30', sleepEndTime: '07:30' };

test('sleep window minutes handles overnight and all-day windows', () => {
  assert.equal(sleepWindowMinutes(config), 480);
  assert.equal(sleepWindowMinutes({ sleepStartTime: '00:00', sleepEndTime: '08:00' }), 480);
  assert.equal(sleepWindowMinutes({ sleepStartTime: '12:00', sleepEndTime: '12:00' }), 1440);
});

test('sleep state uses the window start date as the record key', () => {
  const beforeMidnight = sleepState(local(2026, 11, 13, 23, 45), config);
  assert.equal(beforeMidnight.active, true);
  assert.equal(beforeMidnight.key, '2026-11-13');
  assert.equal(beforeMidnight.start.toISOString(), local(2026, 11, 13, 23, 30).toISOString());
  assert.equal(beforeMidnight.end.toISOString(), local(2026, 11, 14, 7, 30).toISOString());

  const afterMidnight = sleepState(local(2026, 11, 14, 1, 0), config);
  assert.equal(afterMidnight.active, true);
  assert.equal(afterMidnight.key, '2026-11-13');
});

test('sleep state is inactive outside the window', () => {
  const state = sleepState(local(2026, 11, 14, 12, 0), config);
  assert.equal(state.active, false);
  assert.equal(state.key, null);
  assert.equal(state.nextAt.toISOString(), local(2026, 11, 14, 23, 30).toISOString());
});

test('no record is created when the app is outside sleep time', () => {
  const store = createSleepStore();
  const result = recordSleepTick(store, local(2026, 11, 14, 12, 0), config, null);
  assert.equal(result.recorded, false);
  assert.deepEqual(store.days, {});
});

test('a sleep record is created on the first tick and accumulates only running time', () => {
  const store = createSleepStore();
  const first = recordSleepTick(store, local(2026, 11, 13, 23, 45, 0), config, null);
  assert.equal(first.recorded, true);
  assert.equal(first.created, true);
  assert.equal(store.days['2026-11-13'].observedSeconds, 0);

  const second = recordSleepTick(store, local(2026, 11, 13, 23, 45, 1), config, local(2026, 11, 13, 23, 45, 0));
  assert.equal(second.created, false);
  assert.equal(store.days['2026-11-13'].observedSeconds, 1);

  // A long gap (for example the machine was asleep) must not be counted.
  const afterGap = recordSleepTick(store, local(2026, 11, 14, 0, 45, 0), config, local(2026, 11, 13, 23, 45, 1));
  assert.equal(afterGap.recorded, true);
  assert.equal(store.days['2026-11-13'].observedSeconds, 1);
  assert.equal(store.days['2026-11-13'].firstSeenAt, local(2026, 11, 13, 23, 45, 0).toISOString());
});

test('daily chart has 30 slots and only records observed days', () => {
  const store = createSleepStore();
  const now = local(2026, 11, 14, 12, 0);
  const todayKey = dayKey(local(2026, 11, 13, 23, 30));
  store.days[todayKey] = {
    date: todayKey,
    firstSeenAt: local(2026, 11, 13, 23, 45).toISOString(),
    lastSeenAt: local(2026, 11, 14, 7, 0).toISOString(),
    observedSeconds: 3600,
    windowStart: local(2026, 11, 13, 23, 30).toISOString(),
    windowEnd: local(2026, 11, 14, 7, 30).toISOString()
  };
  const summary = buildSleepSummary(store, now, config);
  assert.equal(summary.chart.length, 30);
  assert.equal(summary.chart[29].record, null);
  assert.equal(summary.chart[28].date, todayKey);
  assert.equal(summary.chart[28].record.observedSeconds, 3600);
  assert.equal(summary.stats.recordedDays, 1);
  assert.equal(summary.stats.averageSeconds, 3600);
  assert.equal(summary.records[0].date, todayKey);
});

test('streak counts completed nights since the last late-night record', () => {
  const store = createSleepStore();
  const now = local(2026, 11, 14, 12, 0);
  store.days['2026-11-12'] = {
    date: '2026-11-12',
    firstSeenAt: local(2026, 11, 12, 23, 35).toISOString(),
    lastSeenAt: local(2026, 11, 13, 1, 0).toISOString(),
    observedSeconds: 3600,
    windowStart: local(2026, 11, 12, 23, 30).toISOString(),
    windowEnd: local(2026, 11, 13, 7, 30).toISOString()
  };
  const summary = buildSleepSummary(store, now, config);
  assert.equal(summary.stats.recordedDays, 1);
  assert.equal(summary.stats.lastLateNightDate, '2026-11-12');
  assert.equal(summary.stats.streakDays, 1);
  assert.equal(summary.stats.noRecords, false);

  store.days['2026-11-13'] = {
    date: '2026-11-13',
    firstSeenAt: local(2026, 11, 13, 23, 35).toISOString(),
    lastSeenAt: local(2026, 11, 14, 1, 0).toISOString(),
    observedSeconds: 1800,
    windowStart: local(2026, 11, 13, 23, 30).toISOString(),
    windowEnd: local(2026, 11, 14, 7, 30).toISOString()
  };
  assert.equal(buildSleepSummary(store, now, config).stats.streakDays, 0);
});

test('no late-night records in 30 days reports an empty chart state', () => {
  const store = createSleepStore();
  const summary = buildSleepSummary(store, local(2026, 11, 14, 12, 0), config);
  assert.equal(summary.stats.recordedDays, 0);
  assert.equal(summary.stats.noRecords, true);
  assert.equal(summary.records.length, 0);
  assert.ok(summary.chart.every((entry) => entry.record === null));
});

test('retention removes entries older than 30 calendar days', () => {
  const store = createSleepStore();
  const now = local(2026, 11, 30, 12, 0);
  const oldKey = '2026-10-31';
  const keepKey = '2026-11-01';
  store.days[oldKey] = { date: oldKey, firstSeenAt: local(2026, 10, 31, 23, 30).toISOString(), lastSeenAt: local(2026, 10, 31, 23, 30).toISOString(), observedSeconds: 60 };
  store.days[keepKey] = { date: keepKey, firstSeenAt: local(2026, 11, 1, 23, 30).toISOString(), lastSeenAt: local(2026, 11, 1, 23, 30).toISOString(), observedSeconds: 60 };
  const removed = pruneSleepStore(store, now, 30);
  assert.equal(removed, 1);
  assert.equal(store.days[oldKey], undefined);
  assert.ok(store.days[keepKey]);
});

test('normalizeSleepStore validates persisted records', () => {
  const store = normalizeSleepStore({
    days: {
      '2026-11-13': { firstSeenAt: local(2026, 11, 13, 23, 30).toISOString(), observedSeconds: 120 },
      'bad-key': { firstSeenAt: local(2026, 11, 13, 23, 30).toISOString(), observedSeconds: 120 },
      '2026-11-14': { firstSeenAt: 'not-a-date', observedSeconds: 120 }
    }
  });
  assert.deepEqual(Object.keys(store.days), ['2026-11-13']);
  assert.equal(store.days['2026-11-13'].observedSeconds, 120);
});

test('parseDateKey rejects impossible dates', () => {
  assert.ok(parseDateKey('2026-02-28'));
  assert.equal(parseDateKey('2026-02-30'), null);
  assert.equal(parseDateKey('11-13'), null);
});
