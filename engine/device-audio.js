(function(global){'use strict';
// Device TTS derived from the AKSI/ATASYA audio pattern; no qari recording.
const SPEECH_SETTINGS = Object.freeze({ lang: 'ar-SA', rate: .72, pitch: 1, volume: 1 });
function makeAudioTargets(content) {
  const targets = {};
  for (const v of content.verses) {
    if (v.approval_status !== 'OWNER_APPROVED_CONTENT') throw Error('UNAPPROVED_AUDIO_TEXT');
    targets['FATIHAH-AUD-' + v.id.split('-')[1]] = { kind: 'ayat', parts: [v.arabic_candidate] };
  }
  for (const t of content.tokens) {
    if (t.approval_status !== 'OWNER_APPROVED_CONTENT') throw Error('UNAPPROVED_AUDIO_TEXT');
    targets[t.id] = { kind: 'kalimah', parts: [t.arabic_exact_slice] };
  }
  targets['FATIHAH-AUD-FULL'] = { kind: 'surah', parts: content.verses.map(v => v.arabic_candidate) };
  return targets;
}
class DeviceSpeechAudio {
  #targets; #synth; #Utterance; #timer; #clear; #notify; #generation = 0; #active = null; #watch = null; #disposed = false; #unbind = [];
  #state = { phase: 'idle', targetId: null, reason: null, source: 'device-tts', label: 'Suara mesin peranti seperti AKSI/ATASYA; bukan rakaman qari.', religiousReview: 'NOT_PERFORMED' };
  constructor({ content, synth = globalThis.speechSynthesis, Utterance = globalThis.SpeechSynthesisUtterance, setTimer = (fn, ms) => globalThis.setTimeout(fn, ms), clearTimer = id => globalThis.clearTimeout(id), onStatus = () => {} }) {
    this.#targets = makeAudioTargets(content); this.#synth = synth; this.#Utterance = Utterance; this.#timer = setTimer; this.#clear = clearTimer; this.#notify = onStatus;
    const changed = () => { if (!this.#active && !this.#disposed) this.#emit('idle', null, 'VOICES_CHANGED_RETRY_ON_USER_ACTION'); };
    synth?.addEventListener?.('voiceschanged', changed); this.#unbind.push(() => synth?.removeEventListener?.('voiceschanged', changed));
  }
  #emit(phase, targetId, reason = null, extras = {}) { this.#state = { ...this.#state, ...extras, phase, targetId, reason }; try { this.#notify(this.status()); } catch {} }
  status() { return JSON.parse(JSON.stringify(this.#state)); }
  #voice() {
    try { const all = this.#synth?.getVoices?.() || []; return all.find(v => /^ar[-_]SA$/i.test(v.lang)) || all.find(v => /^ar(?:[-_]|$)/i.test(v.lang)) || null; } catch { return null; }
  }
  availability() {
    const supported = !this.#disposed && typeof this.#synth?.speak === 'function' && typeof this.#synth?.cancel === 'function' && typeof this.#Utterance === 'function';
    return { available: supported, arabicVoiceListed: !!this.#voice(), voiceSelection: this.#voice() ? 'explicit-arabic-voice' : 'browser-language-fallback', source: 'device-tts', label: this.#state.label, reason: !supported ? 'SPEECH_API_UNAVAILABLE' : !this.#voice() ? 'ARABIC_VOICE_NOT_LISTED_TRY_LANGUAGE' : null, textLearningAvailable: true, qari: null };
  }
  play(targetId, { userInitiated = false } = {}) {
    if (!userInitiated) { if (this.#active) return { ...this.status(), requestError: 'USER_ACTION_REQUIRED' }; this.#emit('blocked', targetId, 'USER_ACTION_REQUIRED'); return this.status(); }
    const target = this.#targets[targetId];
    if (!Object.prototype.hasOwnProperty.call(this.#targets, targetId) || !target) { if (this.#active) return { ...this.status(), requestError: 'UNKNOWN_AUDIO_TARGET' }; this.#emit('error', targetId, 'UNKNOWN_AUDIO_TARGET'); return this.status(); }
    if (this.#active?.id === targetId) { this.stop('toggle'); return this.status(); }
    this.stop('replace');
    const availability = this.availability(); if (!availability.available) { this.#emit('unavailable', targetId, availability.reason); return this.status(); }
    const voice = this.#voice(), token = this.#generation;
    this.#active = { id: targetId, index: 0, parts: target.parts, voice, token };
    this.#speakNext(token); return this.status();
  }
  #speakNext(token) {
    const a = this.#active; if (!a || token !== this.#generation) return;
    const text = a.parts[a.index];
    let u;
    try { u = new this.#Utterance(text); Object.assign(u, SPEECH_SETTINGS); if (a.voice) u.voice = a.voice; } catch { this.#finish(token, 'UTTERANCE_CREATION_FAILED'); return; }
    a.utterance = u;
    this.#emit('preparing', a.id, null, { part: a.index + 1, totalParts: a.parts.length, voiceName: a.voice?.name || null, voiceLang: a.voice?.lang || null, requestedLang: SPEECH_SETTINGS.lang, voiceSelection: a.voice ? 'explicit-arabic-voice' : 'browser-language-fallback', localService: a.voice?.localService ?? null });
    u.onstart = () => { if (token === this.#generation && this.#active?.utterance === u) this.#emit('playing', a.id); };
    u.onerror = event => { if (this.#active?.utterance === u) this.#finish(token, event?.error || 'SPEECH_ERROR'); };
    u.onend = () => {
      if (token !== this.#generation || this.#active?.utterance !== u) return;
      this.#clear(this.#watch); this.#watch = null;
      // Clear the old utterance before advancing so late events cannot affect the next one.
      a.utterance = null; a.index++;
      if (a.index < a.parts.length) this.#speakNext(token); else this.#finish(token, null);
    };
    this.#watch = this.#timer(() => { if (this.#active?.utterance === u) this.#finish(token, 'SPEECH_TIMEOUT'); }, Math.max(20_000, text.length * 650));
    try { this.#synth.speak(u); } catch { this.#finish(token, 'SPEAK_FAILED'); }
  }
  #finish(token, error) {
    if (token !== this.#generation || !this.#active) return;
    const id = this.#active.id; this.#active = null; this.#generation++; this.#clear(this.#watch); this.#watch = null;
    if (error) { try { this.#synth.cancel(); } catch {} }
    this.#emit(error ? 'error' : 'ended', id, error, { assessmentCredit: false, religiousReview: 'NOT_PERFORMED' });
  }
  stop(reason = 'stop') {
    this.#generation++; this.#clear(this.#watch); this.#watch = null; this.#active = null;
    try { this.#synth?.cancel?.(); } catch {}
    this.#emit('stopped', null, reason, { assessmentCredit: false });
  }
  bindLifecycle(doc, win) {
    const hidden = () => { if (doc.hidden) this.stop('hidden'); }, pagehide = () => this.stop('pagehide');
    doc.addEventListener('visibilitychange', hidden); win.addEventListener('pagehide', pagehide);
    let bound = true; const remove = () => { if (!bound) return; bound = false; doc.removeEventListener('visibilitychange', hidden); win.removeEventListener('pagehide', pagehide); };
    this.#unbind.push(remove); return remove;
  }
  dispose() { this.stop('dispose'); this.#disposed = true; for (const remove of this.#unbind) remove(); this.#unbind = []; }
}


global.ASKDeviceAudio=DeviceSpeechAudio;
})(typeof window!=='undefined'?window:globalThis);