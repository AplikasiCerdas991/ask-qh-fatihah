(function(global){
// Framework-free headless core. It neither renders UI nor changes canonical data.
const STORAGE_KEY = 'SHARED_ENGINE_PAYLOAD';
const clone = x => JSON.parse(JSON.stringify(x));
const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
const own = (x, k) => Object.hasOwn(x, k);
const modes = ['training', 'full', 'retention'];
const profiles = ['adult', 'kid'];
const stamp = x => Number.isSafeInteger(x) && x >= 0;
function requireThat(condition, code) { if (!condition) throw new EngineError(code); }
class EngineError extends Error { constructor(code) { super(code); this.code = code; } }
const blankProfile = () => ({ studySeen: [], currentStudy: null, flash: {}, sessions: {}, activeSessionId: null, receipts: {}, records: { training: {}, full: {}, retention: {} }, results: [], retentionSchedule: null, lastObservedAt: null });

class LearningEngine {
  #policy; #c; #state; #storage; #clock; #random; #notice = []; #raw = null; #protected = false; #audio;
  constructor({ content, storage = null, clock = Date.now, random = Math.random, audio = null, purpose, trainingPolicy = global.ASKTrainingPolicy }) {
    requireThat(['headless-test', 'prototype-local'].includes(purpose), 'RELEASE_GATED');
    requireThat(trainingPolicy?.contractVersion === 1, 'TRAINING_POLICY_REQUIRED'); this.#policy = trainingPolicy;
    this.#c = clone(content); this.#storage = storage; this.#clock = clock; this.#random = random; this.#audio = audio;
    this.#validateContent(); this.#state = this.#fresh();
    if (storage) { try { this.#raw = storage.getItem(STORAGE_KEY); if (this.#raw !== null) this.#hydrate(JSON.parse(this.#raw)); } catch { this.#notice.push('STORAGE_READ_OR_PARSE_FAILED'); } }
  }
  #fresh() { return { schemaVersion: 1, contentVersion: this.#c.version, contentHash: this.#c.hash, storageGeneration: 0, nextSerial: 1, activeProfile: 'adult', profiles: { adult: blankProfile(), kid: blankProfile() } }; }
  #validateContent() {
    const c = this.#c;
    requireThat(object(c) && typeof c.hash === 'string' && c.hash.length === 64 && typeof c.version === 'string', 'CONTENT_IDENTITY');
    requireThat(Array.isArray(c.verses) && c.verses.length > 0 && Array.isArray(c.tokens) && c.tokens.length > 0 && Array.isArray(c.items), 'CONTENT_SHAPE');
    requireThat(new Set(c.items.map(x => x.id)).size === c.items.length && new Set(c.tokens.map(x => x.id)).size === c.tokens.length, 'DUPLICATE_CONTENT_ID');
    const ids = new Set(c.refs.map(x => x.id));
    requireThat(ids.size === c.refs.length, 'DUPLICATE_REF');
    for (const v of c.verses) {
      requireThat(v.approval_status === 'OWNER_APPROVED_CONTENT', 'UNAPPROVED_CONTENT');
      requireThat(c.tokens.filter(t => t.ayat_id === v.id).map(t => t.arabic_exact_slice).join(' ') === v.arabic_candidate, 'TOKEN_REJOIN');
      requireThat(c.refs.find(r => r.id === v.id + '-AR')?.value === v.arabic_candidate && c.refs.find(r => r.id === v.id + '-MS')?.value === v.translation_candidate_ms, 'VERSE_REF_MISMATCH');
    }
    requireThat(c.tokens.every(t => t.approval_status === 'OWNER_APPROVED_CONTENT'), 'UNAPPROVED_GLOSS');
    for (const i of c.items) this.#policy.validateItem(i,c,requireThat);
  }
  #sameSet(a, b) { return Array.isArray(a) && Array.isArray(b) && a.length === b.length && new Set(a).size === a.length && a.every(x => b.includes(x)); }
  #item(id) { const x = this.#c.items.find(x => x.id === id); requireThat(x, 'UNKNOWN_ITEM'); return x; }
  #applicable(profile) { return this.#c.items.filter(x => this.#policy.applicable(x,profile)).map(x => x.id); }
  #p() { return this.#state.profiles[this.#state.activeProfile]; }
  #now() { const n = this.#clock(); requireThat(stamp(n), 'INVALID_CLOCK'); return n; }
  #shuffle(a) { const x = [...a]; for (let i = x.length - 1; i > 0; i--) { const v = this.#random(); requireThat(Number.isFinite(v) && v >= 0 && v < 1, 'INVALID_RANDOM'); const j = Math.floor(v * (i + 1)); [x[i], x[j]] = [x[j], x[i]]; } return x; }
  #orders(item) { return this.#policy.orders(item,a=>this.#shuffle(a)); }
  #validDraft(i,d,complete=false) { return this.#policy.validDraft(i,d,complete); }
  #empty(i) { return this.#policy.empty(i); }
  #evaluate(i,answer) { return this.#policy.evaluate(i,answer,this.#c,requireThat); }
  #rebuild(p) {
    p.records = { training: {}, full: {}, retention: {} };
    for (const r of Object.values(p.receipts).sort((a, b) => a.sequence - b.sequence)) {
      for (const u of this.#evaluate(this.#item(r.itemId), r.answer)) {
        const scope = p.records[r.scope], prev = scope[u.scoreUnitId];
        const entry = { correct: u.correct, at: r.at, receiptId: r.id };
        scope[u.scoreUnitId] = { first: prev?.first || entry, latest: entry, attempts: (prev?.attempts || 0) + 1, wrongCount: (prev?.wrongCount || 0) + Number(!u.correct) };
      }
    }
  }
  #hydrate(raw) {
    if (!object(raw) || raw.schemaVersion !== 1) { this.#protected = true; this.#notice.push('UNKNOWN_SCHEMA_EXPORT_BEFORE_RECOVERY'); return; }
    if (raw.contentVersion !== this.#c.version || raw.contentHash !== this.#c.hash) { this.#protected = true; this.#notice.push('CONTENT_VERSION_CHANGED_ARCHIVE_REQUIRED'); return; }
    const next = this.#fresh();
    next.storageGeneration = stamp(raw.storageGeneration) ? raw.storageGeneration : 0;
    next.activeProfile = profiles.includes(raw.activeProfile) ? raw.activeProfile : 'adult';
    let maxSerial = 0;
    for (const mode of profiles) {
      const old = raw.profiles?.[mode], p = next.profiles[mode];
      if (!object(old)) { this.#notice.push('PROFILE_RECOVERED:' + mode); continue; }
      const allowed = this.#applicable(mode);
      p.studySeen = Array.isArray(old.studySeen) ? [...new Set(old.studySeen.filter(id => this.#c.verses.some(v => v.id === id) || this.#c.tokens.some(t => t.id === id)))] : [];
      if (object(old.flash)) for (const [id, value] of Object.entries(old.flash)) if (this.#c.items.some(i => i.id === id && i.type === 'FLASH') && typeof value === 'boolean') p.flash[id] = value;
      if (object(old.currentStudy) && this.#c.verses.some(v => v.id === old.currentStudy.ayatId)) {
        const count = this.#c.tokens.filter(t => t.ayat_id === old.currentStudy.ayatId).length;
        p.currentStudy = { ayatId: old.currentStudy.ayatId, tokenIndex: Number.isInteger(old.currentStudy.tokenIndex) && old.currentStudy.tokenIndex >= 0 && old.currentStudy.tokenIndex < count ? old.currentStudy.tokenIndex : 0 };
        if (p.currentStudy.tokenIndex !== old.currentStudy.tokenIndex) this.#notice.push('STUDY_CURSOR_RECOVERED');
      }
      p.lastObservedAt = stamp(old.lastObservedAt) ? old.lastObservedAt : null;
      if (object(old.retentionSchedule) && stamp(old.retentionSchedule.startedAt) && old.retentionSchedule.dueAt === old.retentionSchedule.startedAt + this.#policy.retentionDelayMs) p.retentionSchedule = clone(old.retentionSchedule);
      if (object(old.sessions)) for (const [id, s] of Object.entries(old.sessions)) {
        const serial = /^S(\d+)$/.exec(id);
        const valid = serial && stamp(Number(serial[1])) && Number(serial[1]) < Number.MAX_SAFE_INTEGER - 1 && object(s) && s.id === id && s.profileId === mode && s.contentHash === this.#c.hash && s.contentVersion === this.#c.version && ['training', 'full', 'retention', 'retry'].includes(s.mode) && modes.includes(s.scope) && (s.mode === 'retry' || s.scope === s.mode) && Array.isArray(s.itemIds) && s.itemIds.length > 0 && this.#sameSet(s.itemIds, [...new Set(s.itemIds)]) && s.itemIds.every(i => allowed.includes(i)) && (!['full', 'retention'].includes(s.mode) || this.#sameSet(s.itemIds, allowed)) && ['QUESTION', 'FEEDBACK', 'RESULT'].includes(s.phase) && stamp(s.startedAt);
        if (!valid) { this.#notice.push('SESSION_QUARANTINED:' + id); continue; }
        maxSerial = Math.max(maxSerial, Number(serial[1]));
        const copy = clone(s); copy.orders = {};
        for (const itemId of copy.itemIds) {
          const item = this.#item(itemId); copy.orders[itemId] = {};
          for (const k of ['option_refs', 'left_refs', 'right_refs', 'token_refs']) if (item[k]) copy.orders[itemId][k] = this.#sameSet(s.orders?.[itemId]?.[k], item[k]) ? [...s.orders[itemId][k]] : [...item[k]];
        }
        p.sessions[id] = copy;
      }
      let seq = new Set();
      if (object(old.receipts)) for (const [id, r] of Object.entries(old.receipts).sort((a, b) => (a[1]?.sequence || 0) - (b[1]?.sequence || 0))) {
        const session = p.sessions[r?.sessionId];
        const item = this.#c.items.find(i => i.id === r?.itemId);
        const valid = object(r) && session && item && id === r.sessionId + '/' + r.itemId && r.id === id && session.itemIds.includes(r.itemId) && r.scope === session.scope && r.contentHash === this.#c.hash && stamp(r.at) && r.at >= session.startedAt && stamp(r.sequence) && r.sequence > 0 && !seq.has(r.sequence) && this.#validDraft(item, r.answer, true) && (session.scope !== 'retention' || (p.retentionSchedule && r.at >= p.retentionSchedule.dueAt));
        if (!valid) { this.#notice.push('RECEIPT_QUARANTINED:' + id); continue; }
        seq.add(r.sequence); p.receipts[id] = { id, sessionId: r.sessionId, itemId: r.itemId, scope: r.scope, contentHash: this.#c.hash, answer: clone(r.answer), units: this.#evaluate(item, r.answer), sequence: r.sequence, at: r.at };
      }
      this.#rebuild(p); p.results = [];
      for (const s of Object.values(p.sessions)) {
        const firstPending = s.itemIds.findIndex(id => !p.receipts[s.id + '/' + id]);
        if (firstPending === -1 && stamp(s.completedAt) && s.itemIds.every(id => p.receipts[s.id + '/' + id].at <= s.completedAt)) { s.phase = 'RESULT'; s.cursor = s.itemIds.length - 1; s.draft = null; p.results.push(this.#result(p, s)); continue; }
        delete s.completedAt;
        const validCursor = Number.isInteger(s.cursor) && s.cursor >= 0 && s.cursor < s.itemIds.length;
        if (!validCursor) { s.cursor = firstPending < 0 ? s.itemIds.length - 1 : firstPending; this.#notice.push('CURSOR_RECOVERED:' + s.id); }
        const receipt = p.receipts[s.id + '/' + s.itemIds[s.cursor]];
        if (!receipt && firstPending >= 0 && s.cursor !== firstPending) { s.cursor = firstPending; this.#notice.push('CURSOR_PREFIX_RECOVERED:' + s.id); }
        const current = this.#item(s.itemIds[s.cursor]);
        s.phase = p.receipts[s.id + '/' + current.id] ? 'FEEDBACK' : 'QUESTION';
        s.draft = s.phase === 'FEEDBACK' ? clone(p.receipts[s.id + '/' + current.id].answer) : this.#validDraft(current, s.draft) ? s.draft : this.#empty(current);
        s.paused = s.paused === true;
      }
      p.activeSessionId = own(p.sessions, old.activeSessionId) ? old.activeSessionId : null;
      // A timer must be backed by a complete full-session result in this version.
      const firstFull = p.results.filter(r => p.sessions[r.sessionId].mode === 'full').sort((a, b) => a.completedAt - b.completedAt)[0];
      if (p.retentionSchedule && (!firstFull || p.retentionSchedule.startedAt !== firstFull.completedAt)) { p.retentionSchedule = null; this.#notice.push('RETENTION_TIMER_RECOVERED'); }
      if (!p.retentionSchedule) {
        for (const [id, s] of Object.entries(p.sessions)) if (s.scope === 'retention') { delete p.sessions[id]; for (const key of Object.keys(p.receipts)) if (p.receipts[key].sessionId === id) delete p.receipts[key]; this.#notice.push('UNBACKED_RETENTION_QUARANTINED'); }
        p.results = p.results.filter(r => p.sessions[r.sessionId]); this.#rebuild(p);
        if (!p.sessions[p.activeSessionId]) p.activeSessionId = null;
      }
    }
    next.nextSerial = Math.max(maxSerial + 1, stamp(raw.nextSerial) && raw.nextSerial < Number.MAX_SAFE_INTEGER - 1 ? raw.nextSerial : 1); this.#state = next;
  }
  #save() {
    const p = this.#p(), now = this.#now(); p.lastObservedAt = Math.max(p.lastObservedAt ?? 0, now);
    this.#state.storageGeneration++;
    if (this.#protected) { this.#notice.push('RECOVERY_WRITE_PROTECTED'); return; }
    if (this.#storage) { try { this.#storage.setItem(STORAGE_KEY, JSON.stringify(this.#state)); } catch { this.#notice.push('PROGRESS_NOT_SAVED'); } }
  }
  snapshot() { return clone(this.#state); }
  notices() { return [...new Set(this.#notice)]; }
  exportState() { return { current: this.snapshot(), recoveredOriginal: this.#raw }; }
  recoveryAdopt({ confirmed = false } = {}) { requireThat(confirmed, 'CONFIRMATION_REQUIRED'); this.#protected = false; this.#save(); }
  #session() { const s = this.#p().sessions[this.#p().activeSessionId]; requireThat(s, 'NO_ACTIVE_SESSION'); return s; }
  #gateRetention(p = this.#p()) { const n = this.#now(); requireThat(p.retentionSchedule && n >= p.retentionSchedule.dueAt, 'RETENTION_NOT_DUE'); requireThat(p.lastObservedAt === null || n >= p.lastObservedAt, 'CLOCK_ROLLBACK'); }
  study(ayatId, tokenIndex = 0) {
    this.stopAudio('navigation');
    const ts = this.#c.tokens.filter(t => t.ayat_id === ayatId); requireThat(ts.length > 0, 'UNKNOWN_AYAT');
    const valid = Number.isInteger(tokenIndex) && tokenIndex >= 0 && tokenIndex < ts.length;
    if (!valid) this.#notice.push('STUDY_CURSOR_RECOVERED');
    this.#p().currentStudy = { ayatId, tokenIndex: valid ? tokenIndex : 0 }; this.#save(); return clone(this.#p().currentStudy);
  }
  markDisplayed(id) { requireThat(this.#c.verses.some(v => v.id === id) || this.#c.tokens.some(t => t.id === id), 'UNKNOWN_STUDY_ID'); if (!this.#p().studySeen.includes(id)) this.#p().studySeen.push(id); this.#save(); }
  reveal(itemId, show) { requireThat(this.#item(itemId).type === 'FLASH' && typeof show === 'boolean', 'FLASH_ARGUMENT'); this.#p().flash[itemId] = show; this.#save(); }
  start({ mode = 'training', itemIds, scope = 'training' } = {}) {
    requireThat(['training', 'full', 'retention', 'retry'].includes(mode), 'INVALID_MODE');
    if (mode === 'retention' || (mode === 'retry' && scope === 'retention')) this.#gateRetention();
    const allowed = this.#applicable(this.#state.activeProfile);
    let ids;
    if (mode === 'retry') {
      requireThat(modes.includes(scope), 'INVALID_SCOPE');
      const needs = this.needs(scope); ids = allowed.filter(id => needs.some(n => n === id || n.startsWith(id + '::')));
    } else { scope = mode; ids = mode === 'training' && itemIds ? [...itemIds] : allowed; }
    requireThat(ids.length > 0 && this.#sameSet(ids, [...new Set(ids)]) && ids.every(id => allowed.includes(id)), 'INVALID_OR_EMPTY_PLAN');
    if (this.#p().activeSessionId) { const prior = this.#session(); if (prior.phase !== 'RESULT') prior.paused = true; }
    this.stopAudio('start-session');
    const id = 'S' + this.#state.nextSerial++, plan = this.#shuffle(ids);
    const s = { id, profileId: this.#state.activeProfile, contentVersion: this.#c.version, contentHash: this.#c.hash, mode, scope, itemIds: plan, cursor: 0, phase: 'QUESTION', paused: false, draft: this.#empty(this.#item(plan[0])), orders: Object.fromEntries(plan.map(id => [id, this.#orders(this.#item(id))])), startedAt: this.#now() };
    this.#p().sessions[id] = s; this.#p().activeSessionId = id; this.#save(); return id;
  }
  current() { const s = this.#session(), item = this.#item(s.itemIds[s.cursor]); return { session: clone(s), item: clone(item) }; }
  #editable(type) { const s = this.#session(), i = this.#item(s.itemIds[s.cursor]); requireThat(!s.paused && s.phase === 'QUESTION', 'NOT_EDITABLE'); if (type) requireThat(i.type === type, 'WRONG_TYPE'); return { s, i }; }
  select(value) { const { s, i } = this.#editable(); requireThat(['MCQ', 'TF'].includes(i.type) && this.#validDraft(i, value), 'INVALID_CHOICE'); s.draft = value; this.#save(); }
  pair(left, right) { const { s, i } = this.#editable('PAIR'); requireThat(i.left_refs.includes(left) && i.right_refs.includes(right), 'INVALID_PAIR_REF'); requireThat(!Object.entries(s.draft).some(([l, r]) => l !== left && r === right), 'RIGHT_ALREADY_USED'); s.draft[left] = right; this.#save(); }
  unpair(left) { const { s, i } = this.#editable('PAIR'); requireThat(i.left_refs.includes(left), 'INVALID_PAIR_REF'); delete s.draft[left]; this.#save(); }
  orderPick(id) { const { s, i } = this.#editable('ORDER'); requireThat(i.token_refs.includes(id) && !s.draft.includes(id), 'INVALID_OR_DUPLICATE_TOKEN'); s.draft.push(id); this.#save(); }
  orderUndo() { const { s } = this.#editable('ORDER'); s.draft.pop(); this.#save(); }
  clearDraft() { const { s, i } = this.#editable(); s.draft = this.#empty(i); this.#save(); }
  submit() {
    const p = this.#p(), s = this.#session(); requireThat(!s.paused && s.phase !== 'RESULT', 'SESSION_NOT_ACTIVE');
    const i = this.#item(s.itemIds[s.cursor]), id = s.id + '/' + i.id;
    if (p.receipts[id]) return clone(p.receipts[id]);
    requireThat(s.phase === 'QUESTION', 'NOT_EDITABLE');
    if (s.scope === 'retention') this.#gateRetention();
    const units = this.#evaluate(i, s.draft);
    const r = { id, sessionId: s.id, itemId: i.id, scope: s.scope, contentHash: this.#c.hash, answer: clone(s.draft), units, sequence: Math.max(0, ...Object.values(p.receipts).map(r => r.sequence)) + 1, at: this.#now() };
    p.receipts[id] = r; this.#rebuild(p); s.phase = 'FEEDBACK'; this.#save(); return clone(r);
  }
  #result(p, s) {
    const rr = s.itemIds.map(id => p.receipts[s.id + '/' + id]);
    const units = rr.flatMap(r => this.#evaluate(this.#item(r.itemId), r.answer));
    return { sessionId: s.id, mode: s.mode, scope: s.scope, correct: units.filter(u => u.correct).length, total: units.length, completedAt: s.completedAt, itemCount: s.itemIds.length };
  }
  next() {
    const p = this.#p(), s = this.#session(); requireThat(!s.paused && s.phase === 'FEEDBACK', 'FEEDBACK_REQUIRED');
    if (s.cursor < s.itemIds.length - 1) { s.cursor++; const receipt = p.receipts[s.id + '/' + s.itemIds[s.cursor]]; s.phase = receipt ? 'FEEDBACK' : 'QUESTION'; s.draft = receipt ? clone(receipt.answer) : this.#empty(this.#item(s.itemIds[s.cursor])); }
    else {
      requireThat(s.itemIds.every(id => p.receipts[s.id + '/' + id]), 'MISSING_RECEIPT');
      s.completedAt = this.#now(); s.phase = 'RESULT'; const result = this.#result(p, s); p.results.push(result);
      if (s.mode === 'full' && !p.retentionSchedule) p.retentionSchedule = { startedAt: s.completedAt, dueAt: s.completedAt + this.#policy.retentionDelayMs };
    }
    this.#save(); return s.phase;
  }
  pause() { const s = this.#session(); requireThat(s.phase !== 'RESULT', 'ALREADY_COMPLETE'); s.paused = true; this.stopAudio('pause'); this.#save(); }
  resume(sessionId = this.#p().activeSessionId) { const s = this.#p().sessions[sessionId]; requireThat(s && s.phase !== 'RESULT', 'NO_RESUMABLE_SESSION'); this.#p().activeSessionId = sessionId; s.paused = false; this.#save(); return this.current(); }
  switchProfile(profile) { requireThat(profiles.includes(profile), 'UNKNOWN_PROFILE'); const s = this.#p().sessions[this.#p().activeSessionId]; if (s && s.phase !== 'RESULT') s.paused = true; this.stopAudio('profile'); this.#state.activeProfile = profile; this.#save(); }
  needs(scope = 'training') { requireThat(modes.includes(scope), 'INVALID_SCOPE'); return Object.entries(this.#p().records[scope]).filter(([, r]) => !r.latest.correct).map(([id]) => id); }
  progress() {
    const p = this.#p(), allowed = this.#applicable(this.#state.activeProfile), units = allowed.flatMap(id => { const i = this.#item(id); return i.type === 'PAIR' ? i.left_refs.map(l => id + '::' + l) : [id]; });
    const trained = units.filter(id => p.records.training[id]?.latest.correct).length;
    return { seen: p.studySeen.length, trainedCorrect: trained, total: units.length, trained: trained === units.length, moduleCompleted: p.results.some(r => r.mode === 'full'), modulePassed: p.results.some(r => r.mode === 'full' && r.correct === r.total), retentionPassed: p.results.some(r => r.mode === 'retention' && r.correct === r.total), results: clone(p.results) };
  }
  resetProfile({ confirmed = false } = {}) { requireThat(confirmed, 'CONFIRMATION_REQUIRED'); this.stopAudio('reset'); this.#state.profiles[this.#state.activeProfile] = blankProfile(); this.#save(); }
  audioAvailability() { return this.#audio?.availability?.() || { available: false, reason: 'NO_OWNER_APPROVED_RECORDING', textLearningAvailable: true }; }
  playAudio(targetId, options) { requireThat(typeof this.#audio?.play === 'function', 'AUDIO_ADAPTER_UNAVAILABLE'); return this.#audio.play(targetId, options); }
  stopAudio(reason = 'navigation') { try { this.#audio?.stop?.(reason); } catch { this.#notice.push('AUDIO_STOP_FAILED'); } }
  lifecycle(event) { requireThat(['navigation', 'hidden', 'pagehide'].includes(event), 'UNKNOWN_LIFECYCLE'); this.stopAudio(event); }
}


global.ASKLearningCore = LearningEngine;
})(typeof window!=='undefined'?window:globalThis);
