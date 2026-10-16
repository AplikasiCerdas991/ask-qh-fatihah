(function(global){'use strict';
// Shared facade: study, MCQ training and optional device speech. Full/retention UI remains disabled.
class SharedStudyEngine {
 #content; #release; #storage; #engines={}; #profile='adult'; #notices=[]; #views={adult:'learn',kid:'learn'};#flashCursors={adult:null,kid:null};
 constructor({content,release,storage=null,profile='adult',clock=Date.now,audio=null,trainingPolicy=global.ASKTrainingPolicy}){
  this.#content=content;this.#release=release;this.#storage=storage;
  this.trainingPolicy=trainingPolicy;this.clock=clock;this.audio=audio;this.selectProfile(profile);
 }
 #adapter(profile){
  const storage=this.#storage,release=this.#release,notes=this.#notices,views=this.#views,cursors=this.#flashCursors,content=this.#content;
  const key=`ASK-QH-GS:${release.schemaVersion}:${release.appId}:learning:${profile}`;
  let protectedRecord=false;
  return {
   getItem(){
    if(!storage)return null;
    let raw;try{raw=storage.getItem(key)}catch{notes.push('STORAGE_UNAVAILABLE');return null}
    if(raw===null)return null;
    try{
     const envelope=JSON.parse(raw);
     if(envelope.appId!==release.appId||envelope.profileId!==profile||envelope.schemaVersion!==release.schemaVersion||envelope.contentHash!==release.contentHash||!envelope.engine||envelope.engine.activeProfile!==profile)throw Error('IDENTITY');
     cursors[profile]=content.items.some(i=>i.type==='FLASH'&&i.id===envelope.flashCursor)?envelope.flashCursor:null;
     views[profile]=['learn','words'].includes(envelope.studyView)?envelope.studyView:'learn';return JSON.stringify(envelope.engine);
    }catch{protectedRecord=true;notes.push('OLD_RECORD_PRESERVED:'+profile);return null}
   },
   setItem(_unused,raw){
    if(protectedRecord)throw Error('RECOVERY_WRITE_PROTECTED');
    if(!storage){notes.push('PROGRESS_NOT_SAVED');throw Error('STORAGE_UNAVAILABLE')}
    const engine=JSON.parse(raw);
    const envelope={schemaVersion:release.schemaVersion,appId:release.appId,profileId:profile,contentHash:release.contentHash,buildId:release.buildId,studyView:views[profile],flashCursor:cursors[profile],engine};
    try{storage.setItem(key,JSON.stringify(envelope))}catch(e){notes.push('PROGRESS_NOT_SAVED');throw e}
   }
  };
 }
 selectProfile(profile){
  if(!['adult','kid'].includes(profile))throw Error('UNKNOWN_PROFILE');
  if(profile!==this.#profile&&this.#engines[this.#profile])this.pauseTraining();
  this.audio?.stop('profile');
  if(!this.#engines[profile]){
   const e=new global.ASKLearningCore({content:this.#content,storage:this.#adapter(profile),clock:this.clock,purpose:'prototype-local',audio:this.audio,trainingPolicy:this.trainingPolicy});
   if(e.snapshot().activeProfile!==profile)e.switchProfile(profile);
   this.#engines[profile]=e;
  }
  this.#profile=profile;
 }
 #engine(){return this.#engines[this.#profile]}
 #state(){return this.#engine().snapshot().profiles[this.#profile]}
 openStudyUnit(id,tokenIndex=0){return this.#engine().study(id,tokenIndex)}
 markUnitDisplayed(id){
  if(!this.#content.verses.some(v=>v.id===id))throw Error('UNKNOWN_UNIT');
  this.#engine().markDisplayed(id);
 }
 markTokenDisplayed(id){
  if(!this.#content.tokens.some(v=>v.id===id))throw Error('UNKNOWN_TOKEN');
  this.#engine().markDisplayed(id);
 }
 setStudyView(view){if(!['learn','words'].includes(view))throw Error('UNKNOWN_STUDY_VIEW');this.#views[this.#profile]=view}
 getCurrentStudy(){const s=this.#state().currentStudy;return s?{...s,view:this.#views[this.#profile]}:null}
 getStudyProgress(){
  const p=this.#state(),opened=this.#content.verses.filter(v=>p.studySeen.includes(v.id)).map(v=>v.id);
  return {profileId:this.#profile,openedUnitIds:opened,openedCount:opened.length,totalUnits:this.#content.verses.length,seenTokenCount:this.#content.tokens.filter(t=>p.studySeen.includes(t.id)).length,totalTokens:this.#content.tokens.length,currentStudy:this.getCurrentStudy(),allUnitsOpened:opened.length===this.#content.verses.length,assessmentConnected:true,audioConnected:!!this.audio};
 }
 flashCards(){return this.#content.items.filter(i=>i.type==='FLASH')}
 currentFlash(){const item=this.flashCards().find(i=>i.id===this.#flashCursors[this.#profile]);return item?{item,revealed:this.#state().flash[item.id]===true}:null}
 openFlash(id){if(!this.flashCards().some(i=>i.id===id))throw Error('UNKNOWN_FLASH');this.#flashCursors[this.#profile]=id;this.#engine().reveal(id,this.#state().flash[id]===true);return this.currentFlash()}
 revealFlash(show){const current=this.currentFlash();if(!current)throw Error('NO_FLASH');this.#engine().reveal(current.item.id,show)}
 startTraining(type='MCQ'){if(!this.trainingPolicy.trainingTypes.includes(type))throw Error('UNKNOWN_TRAINING_TYPE');const ids=this.#content.items.filter(i=>i.type===type&&(!i.profile||i.profile===this.#profile)).map(i=>i.id);return this.#engine().start({mode:'training',itemIds:ids})}
 training(type=null){const p=this.#state();const sessions=Object.values(p.sessions).filter(s=>s.mode==='training'&&(!type||this.#content.items.find(i=>i.id===s.itemIds[0])?.type===type));const active=sessions.find(s=>s.id===p.activeSessionId),s=active||sessions.at(-1);if(!s)return null;return {session:s,item:this.#content.items.find(i=>i.id===s.itemIds[s.cursor])}}
 activeExercise(){try{return this.#engine().current()}catch{return null}}
 fullSession(){const p=this.#state(),sessions=Object.values(p.sessions).filter(s=>s.mode==='full'),s=sessions.find(s=>s.id===p.activeSessionId)||sessions.at(-1);return s?{session:s,item:this.#content.items.find(i=>i.id===s.itemIds[s.cursor])}:null}
 startFull(){return this.#engine().start({mode:'full'})}
 resumeFull(){const t=this.fullSession();if(!t)throw Error('NO_RESUMABLE_SESSION');this.pauseTraining();return this.#engine().resume(t.session.id)}
 fullSummary(){const p=this.#state(),items=this.#content.items.filter(i=>i.type!=='FLASH'&&(!i.profile||i.profile===this.#profile)),units=items.flatMap(i=>i.type==='PAIR'?i.left_refs.map(ref=>i.id+'::'+ref):[i.id]);return {itemCount:items.length,total:units.length,results:p.results.filter(r=>r.mode==='full'),records:p.records.full,retentionSchedule:p.retentionSchedule}}
 retentionStatus(){const p=this.#state(),schedule=p.retentionSchedule,now=this.clock();const clockValid=Number.isSafeInteger(now)&&now>=0,rollback=clockValid&&p.lastObservedAt!==null&&now<p.lastObservedAt;return {schedule,now,eligible:!!schedule&&clockValid&&!rollback&&now>=schedule.dueAt,reason:!clockValid?'CLOCK_INVALID':rollback?'CLOCK_ROLLBACK':!schedule?'FULL_REQUIRED':now<schedule.dueAt?'NOT_DUE':'READY',remainingMs:schedule&&clockValid?Math.max(0,schedule.dueAt-now):null}}
 #requireRetention(){const status=this.retentionStatus();if(!status.eligible)throw Error(status.reason)}
 retentionSession(){const p=this.#state(),sessions=Object.values(p.sessions).filter(s=>s.mode==='retention'),s=sessions.find(s=>s.id===p.activeSessionId)||sessions.at(-1);return s?{session:s,item:this.#content.items.find(i=>i.id===s.itemIds[s.cursor])}:null}
 startRetention(){this.#requireRetention();return this.#engine().start({mode:'retention'})}
 resumeRetention(){this.#requireRetention();const t=this.retentionSession();if(!t)throw Error('NO_RESUMABLE_SESSION');this.pauseTraining();return this.#engine().resume(t.session.id)}
 retentionSummary(){const p=this.#state(),full=this.fullSummary();return {itemCount:full.itemCount,total:full.total,results:p.results.filter(r=>r.mode==='retention'),records:p.records.retention,...this.retentionStatus()}}
 #scope(scope){if(!['training','full','retention'].includes(scope))throw Error('INVALID_SCOPE')}
 retrySummary(scope){this.#scope(scope);const p=this.#state(),needs=this.#engine().needs(scope),items=this.#content.items.filter(i=>i.type!=='FLASH'&&(!i.profile||i.profile===this.#profile)&&needs.some(id=>id===i.id||id.startsWith(i.id+'::')));return {scope,needs,itemCount:items.length,scoreUnits:items.reduce((n,i)=>n+(i.type==='PAIR'?i.left_refs.length:1),0),results:p.results.filter(r=>r.mode==='retry'&&r.scope===scope)}}
 retrySession(scope){this.#scope(scope);const p=this.#state(),sessions=Object.values(p.sessions).filter(s=>s.mode==='retry'&&s.scope===scope),s=sessions.find(s=>s.id===p.activeSessionId)||sessions.at(-1);return s?{session:s,item:this.#content.items.find(i=>i.id===s.itemIds[s.cursor])}:null}
 startRetry(scope){this.#scope(scope);if(scope==='retention')this.#requireRetention();if(!this.retrySummary(scope).itemCount)throw Error('NO_RETRY_TARGETS');return this.#engine().start({mode:'retry',scope})}
 resumeRetry(scope){this.#scope(scope);if(scope==='retention')this.#requireRetention();const t=this.retrySession(scope);if(!t)throw Error('NO_RESUMABLE_SESSION');this.pauseTraining();return this.#engine().resume(t.session.id)}
 resetCurrentProfile({confirmed=false}={}){if(confirmed!==true)throw Error('CONFIRMATION_REQUIRED');if(this.notices().some(n=>/OLD_RECORD|PROTECTED|CONTENT_VERSION|UNKNOWN_SCHEMA/.test(n)))throw Error('RECOVERY_RECORD_PROTECTED');this.#flashCursors[this.#profile]=null;this.#views[this.#profile]='learn';this.#engine().resetProfile({confirmed:true})}
 exportRecord(){const p=this.#state();return {schemaVersion:this.#release.schemaVersion,buildId:this.#release.buildId,appId:this.#release.appId,profileId:this.#profile,contentVersion:this.#content.version,contentHash:this.#release.contentHash,exportedAt:this.clock(),record:p,flashCursor:this.#flashCursors[this.#profile],notices:this.notices(),audio:this.audio?.status?.()||null,limits:'Local record only; speech ended is not audible VQA or proof of memorisation; no other profile or credentials included'}}
 orderPick(id){this.#engine().orderPick(id)}
 orderUndo(){const t=this.activeExercise();if(t?.item.type!=='ORDER')throw Error('WRONG_TYPE');this.#engine().orderUndo()}
 orderClear(){const t=this.activeExercise();if(t?.item.type!=='ORDER')throw Error('WRONG_TYPE');this.#engine().clearDraft()}
 choose(ref){this.#engine().select(ref)}
 pair(left,right){this.#engine().pair(left,right)}
 unpair(left){this.#engine().unpair(left)}
 check(){const t=this.activeExercise();if(t?.session.scope==='retention')this.#requireRetention();if(t?.item.type==='PAIR'&&Object.keys(t.session.draft).length!==t.item.left_refs.length)throw Error('PAIR_INCOMPLETE');return this.#engine().submit()}
 nextQuestion(){if(this.activeExercise()?.session.scope==='retention')this.#requireRetention();return this.#engine().next()}
 pauseTraining(){const t=this.activeExercise();if(t&&t.session.phase!=='RESULT'&&!t.session.paused)this.#engine().pause()}
 resumeTraining(type=null){const t=this.training(type);if(!t)throw Error('NO_RESUMABLE_SESSION');const active=this.activeExercise();if(active?.session.id!==t.session.id)this.pauseTraining();return this.#engine().resume(t.session.id)}
 trainingSummary(type='MCQ'){const p=this.#state(),items=this.#content.items.filter(i=>i.type===type&&(!i.profile||i.profile===this.#profile)),ids=items.map(i=>i.id),units=items.flatMap(i=>i.type==='PAIR'?i.left_refs.map(ref=>i.id+'::'+ref):[i.id]);return {total:units.length,sets:ids.length,answered:units.filter(id=>p.records.training[id]).length,latestCorrect:units.filter(id=>p.records.training[id]?.latest.correct).length,results:p.results.filter(r=>r.mode==='training'&&p.sessions[r.sessionId]?.itemIds.every(id=>ids.includes(id))),records:p.records.training}}
 playAudio(id){return this.#engine().playAudio(id,{userInitiated:true})}
 stopAudio(reason){this.#engine().stopAudio(reason)}
 notices(){return [...new Set([...this.#notices,...this.#engine().notices()])]}
 diagnostics(){return this.#engine().exportState()}
}
global.ASKStudyEngine=SharedStudyEngine;
})(typeof window!=='undefined'?window:globalThis);
