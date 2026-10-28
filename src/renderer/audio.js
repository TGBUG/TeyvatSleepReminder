/* Tiny synthesized notification sounds. No audio files, no network. */
(function () {
  'use strict';

  let ctx = null;
  let master = null;
  let dry = null;
  let wet = null;

  function makeImpulse(context) {
    const seconds = 2.2;
    const length = Math.floor(context.sampleRate * seconds);
    const buffer = context.createBuffer(2, length, context.sampleRate);
    for (let channel = 0; channel < 2; channel += 1) {
      const data = buffer.getChannelData(channel);
      for (let i = 0; i < length; i += 1) {
        const decay = Math.pow(1 - i / length, 2.6);
        data[i] = (Math.random() * 2 - 1) * decay;
      }
    }
    return buffer;
  }

  function ensureContext() {
    if (ctx) return ctx;
    const AudioCtx = window.AudioContext || window.webkitAudioContext;
    if (!AudioCtx) return null;
    ctx = new AudioCtx();
    master = ctx.createGain();
    master.gain.value = 0.55;
    dry = ctx.createGain();
    dry.gain.value = 0.82;
    wet = ctx.createGain();
    wet.gain.value = 0.22;
    const convolver = ctx.createConvolver();
    convolver.buffer = makeImpulse(ctx);
    master.connect(dry);
    dry.connect(ctx.destination);
    master.connect(convolver);
    convolver.connect(wet);
    wet.connect(ctx.destination);
    return ctx;
  }

  function pluck(frequency, when, duration, level, type) {
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    const filter = ctx.createBiquadFilter();
    osc.type = type || 'triangle';
    osc.frequency.setValueAtTime(frequency, when);
    filter.type = 'lowpass';
    filter.frequency.setValueAtTime(4200, when);
    filter.frequency.exponentialRampToValueAtTime(1400, when + duration);
    gain.gain.setValueAtTime(0.0001, when);
    gain.gain.exponentialRampToValueAtTime(level, when + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, when + duration);
    osc.connect(filter);
    filter.connect(gain);
    gain.connect(master);
    osc.start(when);
    osc.stop(when + duration + 0.05);

    const overtone = ctx.createOscillator();
    const overtoneGain = ctx.createGain();
    overtone.type = 'sine';
    overtone.frequency.setValueAtTime(frequency * 2.005, when);
    overtoneGain.gain.setValueAtTime(0.0001, when);
    overtoneGain.gain.exponentialRampToValueAtTime(level * 0.22, when + 0.008);
    overtoneGain.gain.exponentialRampToValueAtTime(0.0001, when + duration * 0.55);
    overtone.connect(overtoneGain);
    overtoneGain.connect(master);
    overtone.start(when);
    overtone.stop(when + duration * 0.6);
  }

  function bell(frequency, when, duration, level) {
    const partials = [1, 2.01, 3.02];
    partials.forEach(function (ratio, index) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(frequency * ratio, when);
      gain.gain.setValueAtTime(0.0001, when);
      gain.gain.exponentialRampToValueAtTime(level / (index + 1.4), when + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, when + duration * (1 - index * 0.18));
      osc.connect(gain);
      gain.connect(master);
      osc.start(when);
      osc.stop(when + duration + 0.05);
    });
  }

  function play(kind, volume) {
    if (!kind || kind === 'none') return;
    const context = ensureContext();
    if (!context) return;
    if (context.state === 'suspended') context.resume().catch(function () {});
    const level = Math.max(0, Math.min(1, Number(volume) || 0.55));
    const now = context.currentTime + 0.04;
    master.gain.setTargetAtTime(level * 0.9, now, 0.02);

    if (kind === 'chime') {
      const notes = [1046.5, 1318.5, 1568.0, 2093.0];
      notes.forEach(function (freq, index) {
        bell(freq, now + index * 0.16, 2.6, 0.16);
      });
      return;
    }

    const notes = [659.25, 987.77, 1318.51, 1567.98];
    notes.forEach(function (freq, index) {
      pluck(freq, now + index * 0.115, 1.9 - index * 0.12, 0.18, index === 0 ? 'triangle' : 'sine');
    });
    pluck(329.63, now, 2.4, 0.07, 'sine');
  }

  window.TeyvatAudio = { play: play };
})();
