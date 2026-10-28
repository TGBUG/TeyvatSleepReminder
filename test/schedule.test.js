'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getScheduleState, parseTime, describeWindow } = require('../src/core/schedule');
const { normalizeConfig, DEFAULT_CONFIG } = require('../src/core/config');

function local(y, mo, d, h, mi, s = 0) {
  return new Date(y, mo - 1, d, h, mi, s, 0);
}

const base = { startTime: '23:00', endTime: '07:00', intervalMinutes: 30 };

test('parseTime validates values', () => {
  assert.equal(parseTime('23:30', 0), 1410);
  assert.equal(parseTime('7:05', 0), 425);
  assert.equal(parseTime('24:00', 99), 99);
  assert.equal(parseTime('bad', 99), 99);
});

test('overnight window is active after midnight and keeps one window', () => {
  const state = getScheduleState(local(2026, 10, 28, 1, 0), base);
  assert.equal(state.active, true);
  assert.equal(state.slotIndex, 4);
  assert.equal(state.windowStart, local(2026, 10, 27, 23, 0).toISOString());
  assert.equal(state.windowEnd, local(2026, 10, 28, 7, 0).toISOString());
  assert.equal(state.nextAt, local(2026, 10, 28, 1, 30).toISOString());
});

test('overnight window before start is inactive and points at tonight', () => {
  const state = getScheduleState(local(2026, 10, 28, 22, 0), base);
  assert.equal(state.active, false);
  assert.equal(state.nextAt, local(2026, 10, 28, 23, 0).toISOString());
});

test('overnight window after end is inactive and points at tonight', () => {
  const state = getScheduleState(local(2026, 10, 28, 8, 0), base);
  assert.equal(state.active, false);
  assert.equal(state.nextAt, local(2026, 10, 28, 23, 0).toISOString());
});

test('end boundary is exclusive and next slot skips past the end', () => {
  const atEnd = getScheduleState(local(2026, 10, 28, 7, 0), base);
  assert.equal(atEnd.active, false);
  const beforeEnd = getScheduleState(local(2026, 10, 28, 6, 45), base);
  assert.equal(beforeEnd.nextAt, local(2026, 10, 28, 23, 0).toISOString());
  assert.equal(beforeEnd.nextWindowStart, local(2026, 10, 28, 23, 0).toISOString());
});

test('start boundary fires slot zero', () => {
  const state = getScheduleState(local(2026, 10, 28, 23, 0), base);
  assert.equal(state.active, true);
  assert.equal(state.slotIndex, 0);
  assert.equal(state.slotKey, '2026-10-28#0');
});

test('daytime window works and slot key is stable within a slot', () => {
  const daytime = { startTime: '09:00', endTime: '18:00', intervalMinutes: 60 };
  const a = getScheduleState(local(2026, 10, 28, 10, 25), daytime);
  const b = getScheduleState(local(2026, 10, 28, 10, 55), daytime);
  assert.equal(a.active, true);
  assert.equal(a.slotIndex, 1);
  assert.equal(a.nextAt, local(2026, 10, 28, 11, 0).toISOString());
  assert.equal(a.slotKey, b.slotKey);
});

test('midnight start time is valid', () => {
  const daytime = { startTime: '00:00', endTime: '08:00', intervalMinutes: 30 };
  const state = getScheduleState(local(2026, 10, 28, 0, 0), daytime);
  assert.equal(state.active, true);
  assert.equal(state.slotIndex, 0);
  assert.equal(state.nextAt, local(2026, 10, 28, 0, 30).toISOString());
});

test('equal start and end is a 24 hour window', () => {
  const allDay = { startTime: '00:00', endTime: '00:00', intervalMinutes: 60 };
  const state = getScheduleState(local(2026, 10, 28, 15, 20), allDay);
  assert.equal(state.active, true);
  assert.equal(state.windowStart, local(2026, 10, 28, 0, 0).toISOString());
  assert.equal(describeWindow(allDay).allDay, true);
});

test('normalizeConfig clamps unsafe values and keeps text', () => {
  const config = normalizeConfig({
    startTime: '25:00',
    endTime: '7:05',
    intervalMinutes: 0,
    displaySeconds: 999,
    volume: 9,
    sound: 'nope',
    title: '',
    message: '  line1\r\nline2  '
  });
  assert.equal(config.startTime, DEFAULT_CONFIG.startTime);
  assert.equal(config.endTime, '07:05');
  assert.equal(config.intervalMinutes, 1);
  assert.equal(config.displaySeconds, 60);
  assert.equal(config.volume, 1);
  assert.equal(config.sound, DEFAULT_CONFIG.sound);
  assert.equal(config.title, DEFAULT_CONFIG.title);
  assert.equal(config.message, 'line1\nline2');
});

test('slotKey changes when the date rolls over', () => {
  const a = getScheduleState(local(2026, 10, 28, 23, 45), base);
  const b = getScheduleState(local(2026, 10, 29, 0, 15), base);
  assert.notEqual(a.slotKey, b.slotKey);
  assert.equal(b.slotIndex, 2);
});
