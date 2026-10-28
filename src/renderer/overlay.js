'use strict';

const api = window.sleepAPI;
const banner = document.getElementById('banner');
const eyebrow = document.getElementById('eyebrow');
const title = document.getElementById('title');
const message = document.getElementById('message');
const nextText = document.getElementById('nextText');
const countEl = document.getElementById('count');
const countdownBox = document.getElementById('countdownBox');
const progress = document.getElementById('progress');
const confirmButton = document.getElementById('confirm');

const state = {
  active: false,
  duration: 12000,
  endAt: 0,
  raf: 0,
  inside: false,
  clickThrough: false,
  hideTimer: 0
};

function setInteractive(inside) {
  if (state.clickThrough) return;
  if (state.inside === inside) return;
  state.inside = inside;
  api.setInteractive(inside);
}

function resetProgress(duration) {
  progress.style.animation = 'none';
  void progress.offsetWidth;
  progress.style.animation = 'drain ' + duration + 'ms linear forwards';
}

function updateCountdown() {
  if (!state.active) return;
  const left = Math.max(0, state.endAt - performance.now());
  if (countEl) countEl.textContent = String(Math.ceil(left / 1000)).padStart(2, '0');
  if (left <= 0) {
    dismiss();
    return;
  }
  state.raf = requestAnimationFrame(updateCountdown);
}

function show(payload) {
  clearTimeout(state.hideTimer);
  cancelAnimationFrame(state.raf);
  state.active = true;
  state.duration = Math.max(4000, Number(payload.durationMs) || 12000);
  state.endAt = performance.now() + state.duration;
  state.clickThrough = Boolean(payload.clickThrough);
  document.body.classList.toggle('is-click-through', state.clickThrough);

  eyebrow.textContent = payload.eyebrow || '小铃的提醒';
  title.textContent = payload.title || '夜深了，旅行者';
  message.textContent = payload.message || '';
  nextText.textContent = payload.nextText || '';
  document.body.classList.toggle('hide-countdown', !payload.showCountdown);
  countdownBox.style.display = payload.showCountdown === false ? 'none' : '';
  if (countEl) countEl.textContent = String(Math.ceil(state.duration / 1000)).padStart(2, '0');

  banner.classList.remove('is-leaving', 'is-visible');
  void banner.offsetWidth;
  banner.classList.add('is-visible');
  resetProgress(state.duration);

  if (payload.playSound) {
    try {
      window.TeyvatAudio.play(payload.sound, payload.volume);
    } catch (error) {
      console.warn('提示音播放失败', error);
    }
  }

  state.raf = requestAnimationFrame(updateCountdown);
}

function hide() {
  state.active = false;
  cancelAnimationFrame(state.raf);
  clearTimeout(state.hideTimer);
  banner.classList.remove('is-visible');
  banner.classList.add('is-leaving');
  setInteractive(false);
}

function dismiss() {
  if (!state.active) return;
  state.active = false;
  cancelAnimationFrame(state.raf);
  setInteractive(false);
  banner.classList.remove('is-visible');
  banner.classList.add('is-leaving');
  clearTimeout(state.hideTimer);
  state.hideTimer = setTimeout(() => {
    api.overlayDismiss();
  }, 430);
}

api.onOverlayShow(show);
api.onOverlayHide(hide);

confirmButton.addEventListener('click', (event) => {
  event.stopPropagation();
  dismiss();
});

banner.addEventListener('click', () => {
  dismiss();
});

document.addEventListener('mousemove', (event) => {
  if (!state.active || state.clickThrough) return;
  const rect = banner.getBoundingClientRect();
  const inside =
    event.clientX >= rect.left - 2 &&
    event.clientX <= rect.right + 2 &&
    event.clientY >= rect.top - 2 &&
    event.clientY <= rect.bottom + 2;
  setInteractive(inside);
});

document.addEventListener('mouseleave', () => {
  setInteractive(false);
});

window.addEventListener('keydown', (event) => {
  if (event.key === 'Escape') dismiss();
});

window.addEventListener('DOMContentLoaded', () => {
  api.overlayReady();
});
