'use strict';

const api = window.sleepAPI;
const $ = (id) => document.getElementById(id);
const mainScroll = $('mainScroll');
const formIds = [
  'startTime', 'endTime', 'intervalMinutes', 'displaySeconds', 'title', 'message',
  'volume', 'showCountdown', 'clickThrough', 'allDisplays', 'enabled', 'autoStart',
  'sleepStartTime', 'sleepEndTime', 'sleepPromptEnabled', 'sleepPrompt'
];

const COPY_PRESETS = {
  gentle: {
    title: '夜深了，旅行者',
    message: '提瓦特的星空再美，也不及一场好梦。\n放下冒险，去休息吧。'
  },
  short: {
    title: '该休息啦',
    message: '旅行者，明天再继续冒险吧。晚安。'
  },
  dramatic: {
    title: '星光也需歇息',
    message: '即使是跨越星海的旅人，也需要在夜色里停泊。\n闭上眼睛，让风替你守夜。'
  }
};

let savedConfig = null;
let meta = null;
let status = null;
let selectedSound = 'harp';
let toastTimer = null;
let saveStateTimer = null;
let dirty = false;

function pad(n) { return String(n).padStart(2, '0'); }

function clampInt(value, min, max, fallback) {
  const number = Number.parseInt(value, 10);
  if (!Number.isFinite(number)) return fallback;
  return Math.min(max, Math.max(min, number));
}

function clockToMinutes(value) {
  const match = /^(\d{1,2}):(\d{2})$/.exec(String(value || ''));
  if (!match) return null;
  const hour = Number(match[1]);
  const minute = Number(match[2]);
  if (hour > 23 || minute > 59) return null;
  return hour * 60 + minute;
}

function formatClock(value) {
  const minutes = clockToMinutes(value);
  if (minutes === null) return '--:--';
  return pad(Math.floor(minutes / 60)) + ':' + pad(minutes % 60);
}

function formatCountdown(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const rest = total % 60;
  return pad(hours) + ':' + pad(minutes) + ':' + pad(rest);
}

function formatDuration(minutes) {
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  if (hours && rest) return hours + ' 小时 ' + pad(rest) + ' 分';
  if (hours) return hours + ' 小时';
  return rest + ' 分钟';
}

function windowMinutes(start, end) {
  const startMin = clockToMinutes(start);
  const endMin = clockToMinutes(end);
  if (startMin === null || endMin === null) return 0;
  if (startMin === endMin) return 24 * 60;
  if (startMin < endMin) return endMin - startMin;
  return 24 * 60 - startMin + endMin;
}

function collectConfig() {
  return {
    enabled: $('enabled').checked,
    startTime: formatClock($('startTime').value),
    endTime: formatClock($('endTime').value),
    intervalMinutes: clampInt($('intervalMinutes').value, 5, 180, 30),
    displaySeconds: clampInt($('displaySeconds').value, 4, 60, 12),
    title: $('title').value,
    message: $('message').value,
    sound: selectedSound,
    volume: clampInt($('volume').value, 0, 100, 55) / 100,
    autoStart: $('autoStart').checked,
    clickThrough: $('clickThrough').checked,
    allDisplays: $('allDisplays').checked,
    showCountdown: $('showCountdown').checked,
    sleepStartTime: formatClock($('sleepStartTime').value),
    sleepEndTime: formatClock($('sleepEndTime').value),
    sleepPromptEnabled: $('sleepPromptEnabled').checked,
    sleepPrompt: $('sleepPrompt').value
  };
}

function configsEqual(a, b) {
  return JSON.stringify(a) === JSON.stringify(b);
}

function setDirty(value) {
  dirty = Boolean(value);
  const note = document.querySelector('.footer-note');
  const state = $('saveState');
  const button = $('saveBtn');
  if (!note || !state || !button) return;
  note.classList.toggle('is-dirty', dirty);
  button.classList.toggle('is-dirty', dirty);
  if (dirty) {
    state.textContent = '有未保存的更改';
  } else {
    state.textContent = '所有更改将在保存后生效';
  }
}

function refreshDirty() {
  if (!savedConfig) return;
  setDirty(!configsEqual(collectConfig(), savedConfig));
}

function updateRangeVisual(input) {
  if (!input) return;
  const min = Number(input.min) || 0;
  const max = Number(input.max) || 100;
  const value = Number(input.value) || 0;
  const percent = max === min ? 0 : ((value - min) / (max - min)) * 100;
  input.style.setProperty('--fill', percent + '%');
}

function setRangeValue(id, value, fallback) {
  const range = $(id);
  if (!range) return;
  range.value = clampInt(value, Number(range.min) || 0, Number(range.max) || 100, fallback);
  updateRangeVisual(range);
}

function updateSoundUI() {
  document.querySelectorAll('.sound-card').forEach((card) => {
    card.classList.toggle('selected', card.dataset.sound === selectedSound);
  });
}

function updateTimeline() {
  const track = $('timelineTrack');
  if (!track) return;
  track.querySelectorAll('.timeline-seg').forEach((node) => node.remove());

  const startMin = clockToMinutes($('startTime').value);
  const endMin = clockToMinutes($('endTime').value);
  if (startMin === null || endMin === null) return;

  const addSegment = (from, to) => {
    if (to <= from) return;
    const segment = document.createElement('div');
    segment.className = 'timeline-seg';
    segment.style.left = (from / 1440) * 100 + '%';
    segment.style.width = ((to - from) / 1440) * 100 + '%';
    track.appendChild(segment);
  };

  if (startMin === endMin) {
    addSegment(0, 1440);
  } else if (startMin < endMin) {
    addSegment(startMin, endMin);
  } else {
    addSegment(0, endMin);
    addSegment(startMin, 1440);
  }
}

function updateDerived() {
  const start = formatClock($('startTime').value);
  const end = formatClock($('endTime').value);
  const interval = clampInt($('intervalMinutes').value, 5, 180, 30);
  const seconds = clampInt($('displaySeconds').value, 4, 60, 12);
  const minutes = windowMinutes(start, end);
  const count = minutes > 0 ? Math.max(1, Math.ceil(minutes / interval)) : 0;
  const startMin = clockToMinutes(start);
  const endMin = clockToMinutes(end);
  const crosses = startMin !== null && endMin !== null && startMin > endMin;
  const allDay = startMin !== null && endMin !== null && startMin === endMin;

  $('intervalValue').textContent = interval + ' 分钟';
  $('durationValue').textContent = seconds + ' 秒';
  $('titleCount').textContent = $('title').value.length + ' / 18';
  $('messageCount').textContent = $('message').value.length + ' / 120';
  $('volumeValue').textContent = $('volume').value + '%';

  setRangeValue('intervalRange', interval, 30);
  setRangeValue('durationRange', seconds, 12);
  setRangeValue('volume', $('volume').value, 55);
  updateRangeVisual($('intervalRange'));
  updateRangeVisual($('durationRange'));

  const mode = allDay ? '全天生效' : crosses ? '跨越午夜' : '当日生效';
  $('timeHint').textContent = minutes > 0
    ? mode + ' · 共 ' + formatDuration(minutes) + ' · 预计 ' + count + ' 次提醒'
    : '请选择完整的开始与结束时间';

  $('estimateText').textContent = allDay
    ? '全天预计提醒 ' + count + ' 次'
    : (crosses ? '今夜预计提醒 ' : '本时段预计提醒 ') + count + ' 次';
  $('estimateSub').textContent = minutes > 0
    ? '首次提醒将在 ' + start + ' 出现，每 ' + interval + ' 分钟一次。'
    : '设置时间后，这里会显示预计的提醒次数。';

  $('sleepPromptCount').textContent = $('sleepPrompt').value.length + ' / 80';
  const promptEnabled = $('sleepPromptEnabled').checked;
  $('sleepPrompt').disabled = !promptEnabled;
  $('sleepPromptEditor').classList.toggle('is-disabled', !promptEnabled);

  updateTimeline();
}

function populate(config, metaInfo) {
  if (!config) return;
  $('enabled').checked = Boolean(config.enabled);
  $('startTime').value = config.startTime;
  $('endTime').value = config.endTime;
  $('intervalMinutes').value = String(config.intervalMinutes);
  $('displaySeconds').value = String(config.displaySeconds);
  $('title').value = config.title;
  $('message').value = config.message;
  $('volume').value = String(Math.round((config.volume || 0) * 100));
  $('showCountdown').checked = Boolean(config.showCountdown);
  $('clickThrough').checked = Boolean(config.clickThrough);
  $('allDisplays').checked = Boolean(config.allDisplays);
  $('autoStart').checked = Boolean(config.autoStart);
  $('sleepStartTime').value = config.sleepStartTime;
  $('sleepEndTime').value = config.sleepEndTime;
  $('sleepPromptEnabled').checked = Boolean(config.sleepPromptEnabled);
  $('sleepPrompt').value = config.sleepPrompt;
  selectedSound = config.sound || 'harp';
  updateSoundUI();
  updateDerived();
  savedConfig = collectConfig();
  setDirty(false);

  if (metaInfo) {
    meta = metaInfo;
    $('versionLabel').textContent = 'v' + meta.version;
    const hint = $('autoStartHint');
    if (hint) {
      hint.textContent = meta.autoStartSupported
        ? '登录 Windows 后自动在托盘运行'
        : '打包版中生效；当前为开发预览';
    }
  }
}

function applyStatus(next) {
  if (!next) return;
  status = next;
  const enabled = Boolean(next.enabled);
  const inWindow = Boolean(next.inWindow);
  const stateText = !enabled ? '已暂停' : inWindow ? '提醒中' : '等待时段';
  const chip = !enabled ? 'OFF' : inWindow ? 'ON' : 'IDLE';
  const panel = document.querySelector('.side-status');

  $('sideState').textContent = stateText;
  $('sideChip').textContent = chip;
  $('heroState').textContent = stateText;
  $('sideStart').textContent = next.window ? next.window.start : '--:--';
  $('sideEnd').textContent = next.window ? next.window.end : '--:--';

  const nextLabel = enabled ? (next.nextLabel || '—') : '已暂停';
  $('sideNext').textContent = nextLabel;
  $('heroNext').textContent = nextLabel;
  const countdown = enabled ? formatCountdown(next.secondsToNext) : '—';
  $('sideCountdown').textContent = countdown;
  $('heroCountdown').textContent = countdown;

  if (panel) {
    panel.classList.toggle('is-waiting', enabled && !inWindow);
    panel.classList.toggle('is-off', !enabled);
  }

  const dot = $('heroDot');
  if (dot) {
    dot.style.background = !enabled ? '#a06b61' : inWindow ? '#b99a5f' : '#9aa2b1';
    dot.style.boxShadow = !enabled
      ? '0 0 6px rgba(160,107,97,.35)'
      : inWindow
        ? '0 0 6px rgba(185,154,95,.55)'
        : 'none';
  }

  applySleepStatus(next.sleep);
}

function formatDurationSeconds(seconds) {
  const total = Math.max(0, Math.round(Number(seconds) || 0));
  if (total < 60) return '不足 1 分钟';
  const hours = Math.floor(total / 3600);
  const minutes = Math.round((total % 3600) / 60);
  if (hours && minutes) return hours + ' 小时 ' + minutes + ' 分';
  if (hours) return hours + ' 小时';
  return minutes + ' 分钟';
}

function formatIsoClock(iso) {
  if (!iso) return '--:--';
  const date = new Date(iso);
  if (Number.isNaN(date.getTime())) return '--:--';
  return pad(date.getHours()) + ':' + pad(date.getMinutes());
}

function applySleepStatus(sleep) {
  if (!sleep) return;
  const active = Boolean(sleep.active);
  $('sleepStatusText').textContent = active ? '熬夜记录中' : '等待睡觉时间';
  $('sleepStatusSub').textContent = active
    ? (sleep.windowStart || '--:--') + ' – ' + (sleep.windowEnd || '--:--') + ' · 程序运行中'
    : '下次 · ' + (sleep.nextLabel || '—');
  $('sleepCurrent').textContent = active
    ? '今晚熬夜 ' + formatDurationSeconds(sleep.currentSeconds)
    : '今晚尚未熬夜';
  const dot = $('sleepStatusDot');
  if (dot) dot.classList.toggle('is-active', active);
}

function renderSleepData(data) {
  if (!data) return;

  $('sleepRecordedDays').textContent = data.stats.recordedDays + ' 天';
  $('sleepAverage').textContent = data.stats.recordedDays
    ? formatDurationSeconds(data.stats.averageSeconds)
    : '—';
  $('sleepStreak').textContent = data.stats.noRecords
    ? '30 天+'
    : data.stats.streakDays + ' 天';

  applySleepStatus({
    active: data.state.active,
    windowStart: data.windowStart,
    windowEnd: data.windowEnd,
    nextLabel: data.state.nextLabel,
    currentSeconds: data.current ? data.current.observedSeconds : 0
  });

  const chart = $('sleepChart');
  const labels = $('sleepChartLabels');
  chart.textContent = '';
  labels.textContent = '';
  chart.classList.toggle('is-empty', Boolean(data.stats.noRecords));

  if (data.stats.noRecords) {
    const empty = document.createElement('div');
    empty.className = 'sleep-chart-empty';
    empty.textContent = '最近30天都没有熬夜，做的不错哦！';
    chart.appendChild(empty);
  } else {
    const maxSeconds = Math.max(60, Number(data.windowMinutes || 480) * 60);
    data.chart.forEach((entry) => {
      const slot = document.createElement('div');
      slot.className = 'sleep-bar-slot';
      if (entry.record) {
        const bar = document.createElement('div');
        bar.className = 'sleep-bar';
        const percent = Math.min(100, Math.max(2.5, (entry.record.observedSeconds / maxSeconds) * 100));
        bar.style.height = percent + '%';
        bar.title = entry.label + ' · 熬夜 ' + formatDurationSeconds(entry.record.observedSeconds) + ' · ' + formatIsoClock(entry.record.firstSeenAt) + ' 起';
        slot.appendChild(bar);
      } else {
        slot.classList.add('is-empty');
        slot.title = entry.label + ' · 无熬夜';
      }
      chart.appendChild(slot);
    });

    data.chart.forEach((entry, index) => {
      const label = document.createElement('span');
      label.className = 'sleep-chart-label';
      if (index % 5 === 0 || index === data.chart.length - 1) {
        label.textContent = entry.label;
      }
      labels.appendChild(label);
    });
  }

  const recordsBox = $('sleepRecords');
  recordsBox.textContent = '';
  if (!data.records.length) {
    const empty = document.createElement('div');
    empty.className = 'sleep-empty';
    empty.textContent = '最近30天没有熬夜记录。继续保持，做的不错哦！';
    recordsBox.appendChild(empty);
    return;
  }

  data.records.forEach((record) => {
    const row = document.createElement('div');
    row.className = 'sleep-record-row';

    const date = document.createElement('span');
    date.className = 'sleep-record-date';
    date.textContent = record.label;

    const first = document.createElement('span');
    first.className = 'sleep-record-first';
    first.textContent = formatIsoClock(record.firstSeenAt) + ' 起';

    const duration = document.createElement('b');
    duration.className = 'sleep-record-duration';
    duration.textContent = formatDurationSeconds(record.observedSeconds);

    row.append(date, first, duration);
    recordsBox.appendChild(row);
  });
}

async function refreshSleepLog() {
  try {
    const data = await api.getSleepLog();
    renderSleepData(data);
  } catch (error) {
    console.warn('读取熬夜记录失败', error);
  }
}

function showToast(message, tone) {
  const toast = $('toast');
  const text = $('toastText');
  if (!toast || !text) return;
  text.textContent = message;
  toast.classList.toggle('warn', tone === 'warn');
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), 3200);
}

function setActiveNav(id) {
  document.querySelectorAll('.nav-item').forEach((item) => {
    item.classList.toggle('active', item.dataset.target === id);
  });
}

function scrollToSection(id) {
  const section = $(id);
  if (!section) return;
  const top = Math.max(0, section.offsetTop - 18);
  mainScroll.scrollTo({ top, behavior: 'smooth' });
  setActiveNav(id);
}

async function save() {
  if (!savedConfig) return;
  const config = collectConfig();
  if (clockToMinutes(config.startTime) === null || clockToMinutes(config.endTime) === null) {
    showToast('请选择完整的提醒开始和结束时间', 'warn');
    return;
  }
  if (clockToMinutes(config.sleepStartTime) === null || clockToMinutes(config.sleepEndTime) === null) {
    showToast('请选择完整的睡觉和起床时间', 'warn');
    return;
  }

  const button = $('saveBtn');
  const previousText = button.querySelector('span').textContent;
  button.querySelector('span').textContent = '保存中…';
  button.disabled = true;
  try {
    const result = await api.saveConfig(config);
    if (!result || !result.ok) {
      showToast('保存失败，请稍后重试', 'warn');
      return;
    }
    populate(result.config, result.meta || meta);
    applyStatus(result.status);
    refreshSleepLog();
    showToast('设置已保存并生效');
    clearTimeout(saveStateTimer);
    $('saveState').textContent = '设置已保存';
    saveStateTimer = setTimeout(() => {
      if (!dirty) $('saveState').textContent = '所有更改将在保存后生效';
    }, 2600);
    if (result.warnings && result.warnings.length) {
      setTimeout(() => showToast(result.warnings[0], 'warn'), 900);
    }
  } catch (error) {
    console.error(error);
    showToast('保存失败：' + (error.message || '未知错误'), 'warn');
  } finally {
    button.querySelector('span').textContent = previousText;
    button.disabled = false;
  }
}

async function init() {
  try {
    const data = await api.getConfig();
    populate(data.config, data.meta);
    applyStatus(data.status);
    refreshSleepLog();
  } catch (error) {
    console.error(error);
    showToast('读取配置失败：' + (error.message || '未知错误'), 'warn');
  }

  formIds.forEach((id) => {
    const input = $(id);
    if (!input) return;
    input.addEventListener('input', () => {
      updateDerived();
      refreshDirty();
    });
    input.addEventListener('change', () => {
      updateDerived();
      refreshDirty();
    });
  });

  document.querySelectorAll('.step-btn').forEach((button) => {
    button.addEventListener('click', () => {
      const input = $(button.dataset.target);
      if (!input) return;
      const step = Number(button.dataset.step) || 0;
      const next = clampInt(Number(input.value) + step, Number(input.min), Number(input.max), Number(input.value));
      input.value = String(next);
      input.dispatchEvent(new Event('input', { bubbles: true }));
    });
  });

  $('intervalRange').addEventListener('input', (event) => {
    $('intervalMinutes').value = event.target.value;
    updateDerived();
    refreshDirty();
  });

  $('durationRange').addEventListener('input', (event) => {
    $('displaySeconds').value = event.target.value;
    updateDerived();
    refreshDirty();
  });

  ['intervalMinutes', 'displaySeconds'].forEach((id) => {
    const input = $(id);
    if (!input) return;
    input.addEventListener('blur', () => {
      input.value = String(clampInt(input.value, Number(input.min), Number(input.max), Number(input.value)));
      updateDerived();
      refreshDirty();
    });
  });

  $('volume').addEventListener('input', () => {
    updateDerived();
    refreshDirty();
  });
  $('volume').addEventListener('change', () => {
    if (selectedSound !== 'none') {
      window.TeyvatAudio.play(selectedSound, Number($('volume').value) / 100);
    }
  });

  document.querySelectorAll('.time-preset').forEach((button) => {
    button.addEventListener('click', () => {
      $('startTime').value = button.dataset.start;
      $('endTime').value = button.dataset.end;
      $('startTime').dispatchEvent(new Event('input', { bubbles: true }));
      $('endTime').dispatchEvent(new Event('input', { bubbles: true }));
    });
  });

  document.querySelectorAll('.sleep-preset').forEach((button) => {
    button.addEventListener('click', () => {
      $('sleepStartTime').value = button.dataset.sleepStart;
      $('sleepEndTime').value = button.dataset.sleepEnd;
      $('sleepStartTime').dispatchEvent(new Event('input', { bubbles: true }));
      $('sleepEndTime').dispatchEvent(new Event('input', { bubbles: true }));
    });
  });

  document.querySelectorAll('.copy-preset').forEach((button) => {
    button.addEventListener('click', () => {
      const preset = COPY_PRESETS[button.dataset.preset];
      if (!preset) return;
      $('title').value = preset.title;
      $('message').value = preset.message;
      $('title').dispatchEvent(new Event('input', { bubbles: true }));
      $('message').dispatchEvent(new Event('input', { bubbles: true }));
    });
  });

  document.querySelectorAll('.sound-card').forEach((card) => {
    card.addEventListener('click', () => {
      selectedSound = card.dataset.sound;
      updateSoundUI();
      refreshDirty();
      if (selectedSound !== 'none') {
        window.TeyvatAudio.play(selectedSound, Number($('volume').value) / 100);
      }
    });
  });

  $('listenBtn').addEventListener('click', () => {
    if (selectedSound === 'none') {
      showToast('当前选择了静音');
      return;
    }
    window.TeyvatAudio.play(selectedSound, Number($('volume').value) / 100);
  });

  $('previewBtn').addEventListener('click', async () => {
    updateDerived();
    const config = collectConfig();
    try {
      await api.preview(config);
      showToast('预览已显示在屏幕上方');
    } catch (error) {
      showToast('预览失败：' + (error.message || '未知错误'), 'warn');
    }
  });

  $('testBtn').addEventListener('click', async () => {
    try {
      await api.remindNow();
      showToast('提醒已显示在屏幕上方');
    } catch (error) {
      showToast('提醒失败：' + (error.message || '未知错误'), 'warn');
    }
  });

  $('saveBtn').addEventListener('click', save);
  $('minimizeBtn').addEventListener('click', () => api.minimize());
  $('closeBtn').addEventListener('click', () => api.close());
  $('openDataBtn').addEventListener('click', async () => {
    const result = await api.openDataDir();
    if (result && result.ok === false) showToast('无法打开数据目录：' + (result.error || '未知错误'), 'warn');
  });

  $('resetBtn').addEventListener('click', () => {
    $('modal').hidden = false;
  });
  $('modalCancel').addEventListener('click', () => {
    $('modal').hidden = true;
  });
  $('modalConfirm').addEventListener('click', async () => {
    $('modal').hidden = true;
    try {
      const result = await api.resetConfig();
      populate(result.config, result.meta || meta);
      applyStatus(result.status);
      refreshSleepLog();
      showToast('已恢复默认设置');
    } catch (error) {
      showToast('恢复默认失败：' + (error.message || '未知错误'), 'warn');
    }
  });
  $('modal').addEventListener('click', (event) => {
    if (event.target === $('modal')) $('modal').hidden = true;
  });

  document.querySelectorAll('.nav-item').forEach((item) => {
    item.addEventListener('click', () => scrollToSection(item.dataset.target));
  });

  mainScroll.addEventListener('scroll', () => {
    const sections = Array.from(document.querySelectorAll('.card'));
    const marker = mainScroll.scrollTop + 110;
    let current = sections[0] ? sections[0].id : null;
    sections.forEach((section) => {
      if (section.offsetTop <= marker) current = section.id;
    });
    if (mainScroll.scrollTop + mainScroll.clientHeight >= mainScroll.scrollHeight - 8 && sections.length) {
      current = sections[sections.length - 1].id;
    }
    if (current) setActiveNav(current);
  }, { passive: true });

  api.onStatus(applyStatus);

  // Derive the countdown from the next timestamp so missed broadcasts cannot drift.
  setInterval(() => {
    if (!status || !status.enabled || !status.nextAt) return;
    const seconds = Math.max(0, Math.round((new Date(status.nextAt).getTime() - Date.now()) / 1000));
    $('sideCountdown').textContent = formatCountdown(seconds);
    $('heroCountdown').textContent = formatCountdown(seconds);
  }, 500);

  setInterval(refreshSleepLog, 30000);

  document.addEventListener('keydown', (event) => {
    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 's') {
      event.preventDefault();
      save();
    }
    if (event.key === 'Escape') {
      if (!$('modal').hidden) {
        $('modal').hidden = true;
      }
    }
  });

  window.addEventListener('focus', async () => {
    try {
      applyStatus(await api.getStatus());
      await refreshSleepLog();
    } catch (_) { /* ignore */ }
  });

  updateDerived();
  refreshDirty();
}

init();
