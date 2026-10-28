'use strict';

const DEFAULT_CONFIG = Object.freeze({
  enabled: true,
  startTime: '23:00',
  endTime: '07:00',
  intervalMinutes: 30,
  displaySeconds: 12,
  title: '夜深了，旅行者',
  message: '提瓦特的星空再美，也不及一场好梦。\n放下冒险，去休息吧。',
  sound: 'harp',
  volume: 0.55,
  autoStart: false,
  clickThrough: false,
  allDisplays: false,
  showCountdown: true
});

const SOUNDS = new Set(['harp', 'chime', 'none']);

function clampNumber(value, min, max, fallback) {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.min(max, Math.max(min, n));
}

function cleanText(value, max, fallback) {
  if (typeof value !== 'string') return fallback;
  const text = value.replace(/\r\n/g, '\n').trim();
  if (!text) return fallback;
  return text.slice(0, max);
}

function validTime(value, fallback) {
  if (typeof value !== 'string') return fallback;
  const match = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!match) return fallback;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return fallback;
  return String(hour).padStart(2, '0') + ':' + String(minute).padStart(2, '0');
}

function normalizeConfig(raw) {
  const input = raw && typeof raw === 'object' ? raw : {};
  const interval = Math.round(clampNumber(input.intervalMinutes, 1, 720, DEFAULT_CONFIG.intervalMinutes));
  const displaySeconds = Math.round(clampNumber(input.displaySeconds, 4, 60, DEFAULT_CONFIG.displaySeconds));
  const volume = clampNumber(input.volume, 0, 1, DEFAULT_CONFIG.volume);

  return {
    enabled: typeof input.enabled === 'boolean' ? input.enabled : DEFAULT_CONFIG.enabled,
    startTime: validTime(input.startTime, DEFAULT_CONFIG.startTime),
    endTime: validTime(input.endTime, DEFAULT_CONFIG.endTime),
    intervalMinutes: interval,
    displaySeconds,
    title: cleanText(input.title, 18, DEFAULT_CONFIG.title),
    message: cleanText(input.message, 160, DEFAULT_CONFIG.message),
    sound: SOUNDS.has(input.sound) ? input.sound : DEFAULT_CONFIG.sound,
    volume: Math.round(volume * 100) / 100,
    autoStart: typeof input.autoStart === 'boolean' ? input.autoStart : DEFAULT_CONFIG.autoStart,
    clickThrough: typeof input.clickThrough === 'boolean' ? input.clickThrough : DEFAULT_CONFIG.clickThrough,
    allDisplays: typeof input.allDisplays === 'boolean' ? input.allDisplays : DEFAULT_CONFIG.allDisplays,
    showCountdown: typeof input.showCountdown === 'boolean' ? input.showCountdown : DEFAULT_CONFIG.showCountdown
  };
}

module.exports = { DEFAULT_CONFIG, normalizeConfig, SOUNDS, clampNumber, validTime };
