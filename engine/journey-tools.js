(function(global){'use strict';
const copy=x=>JSON.parse(JSON.stringify(x)),profiles=['adult','kid'];
class JourneyTools{
 constructor({content,release,storage=null,profile='adult',clock=Date.now,random=Math.random,journeyPolicy=global.ASKJourneyPolicy}){if(journeyPolicy?.contractVersion!==1)throw Error('JOURNEY_POLICY_REQUIRED');this.policy=journeyPolicy;this.content=content;this.release=release;this.storage=storage;this.clock=clock;this.random=random;this.cache={};this.protected=new Set();this.messages=[];this.selectProfile(profile)}
 key(){return `ASK-QH-GS:${this.release.schemaVersion}:${this.release.appId}:journey-tools:${this.profile}`}
 blank(){return {schema:1,appId:this.release.appId,contentHash:this.release.contentHash,profile:this.profile,serial:0,sequence:null,reverse:null,results:[],reflection:{}}}
 valid(s){return this.policy.valid.call(this,s)}
 selectProfile(profile){if(!profiles.includes(profile))throw Error('UNKNOWN_PROFILE');if(this.profile)this.pause();this.profile=profile;if(this.cache[profile])return;let raw=null;try{raw=this.storage?.getItem(this.key())}catch{this.messages.push('STORAGE_UNAVAILABLE')}if(raw!==null&&raw!==undefined){try{const s=JSON.parse(raw);if(!this.valid(s))throw Error('INVALID');this.cache[profile]=s;return}catch{this.protected.add(profile);this.messages.push('EXTENSION_RECORD_PROTECTED:'+profile)}}this.cache[profile]=this.blank()}
 state(){return copy(this.cache[this.profile])}
 save(){if(this.protected.has(this.profile))return false;try{if(!this.storage)throw Error('NO_STORAGE');this.storage.setItem(this.key(),JSON.stringify(this.cache[this.profile]));return true}catch{this.messages.push('EXTENSION_NOT_SAVED');return false}}
 shuffle(ids){const a=[...ids];for(let i=a.length-1;i>0;i--){const j=Math.floor(this.random()*(i+1));if(j<0||j>i)throw Error('INVALID_RANDOM');[a[i],a[j]]=[a[j],a[i]]}return a}
 start(kind,{level=2,start=0}={}){if(!['sequence','reverse'].includes(kind))throw Error('UNKNOWN_KIND');const plan=this.policy.plan(kind,{level,start},this.content,this.profile,a=>this.shuffle(a));this.pause();const s=this.cache[this.profile],session={id:kind+'-'+(++s.serial),kind,plan,cursor:0,phase:'ANSWER',draft:kind==='sequence'?[]:null,receipts:[],paused:false,createdAt:this.clock()};s[kind]=session;this.save();return this.current(kind)}
 current(kind){if(!['sequence','reverse'].includes(kind))throw Error('UNKNOWN_KIND');const s=this.cache[this.profile][kind];return s?copy(s):null}
 edit(kind,action,id){const s=this.cache[this.profile][kind];if(!s||s.paused||s.phase!=='ANSWER')throw Error('NOT_ANSWERING');const item=s.plan[s.cursor];if(kind==='sequence'){if(action==='pick'){if(!item.choices.includes(id)||s.draft.includes(id))throw Error('INVALID_PICK');s.draft.push(id)}else if(action==='undo')s.draft.pop();else if(action==='clear')s.draft=[];else throw Error('INVALID_ACTION')}else{if(action!=='choose'||!item.choices.includes(id))throw Error('INVALID_CHOICE');s.draft=id}this.save()}
 check(kind){const s=this.cache[this.profile][kind];if(!s||s.paused)throw Error('NO_SESSION');if(s.phase==='FEEDBACK')return copy(s.receipts[s.cursor]);if(s.phase!=='ANSWER')throw Error('NOT_ANSWERING');const q=s.plan[s.cursor];if(kind==='sequence'&&s.draft.length!==q.answer.length||kind==='reverse'&&s.draft===null)throw Error('INCOMPLETE');const receipt={itemId:q.id,answer:copy(s.draft),correct:this.policy.isCorrect(q,s.draft),at:this.clock()};s.receipts.push(receipt);s.phase='FEEDBACK';this.save();return copy(receipt)}
 next(kind){const s=this.cache[this.profile][kind];if(!s||s.paused||s.phase!=='FEEDBACK')throw Error('NOT_CHECKED');if(s.cursor===s.plan.length-1){s.phase='RESULT';s.completedAt=this.clock();this.cache[this.profile].results.push({sessionId:s.id,kind,correct:s.receipts.filter(r=>r.correct).length,total:s.plan.length,level:kind==='sequence'?s.plan[0].answer.length:null,start:kind==='sequence'?this.content.verses.findIndex(v=>v.id===s.plan[0].answer[0]):null,at:s.completedAt})}else{s.cursor++;s.phase='ANSWER';s.draft=kind==='sequence'?[]:null}this.save()}
 pause(kindOnly=null){const s=this.cache[this.profile];if(!s)return;for(const kind of ['sequence','reverse'])if((kindOnly===null||kindOnly===kind)&&s[kind]&&s[kind].phase!=='RESULT')s[kind].paused=true;this.save()}
 resume(kind){const s=this.cache[this.profile][kind];if(!s||s.phase==='RESULT')throw Error('NO_SESSION');this.pause();s.paused=false;this.save()}
 reflect(id,value){if(!['read','meaning','practice'].includes(id)||typeof value!=='boolean')throw Error('INVALID_REFLECTION');this.cache[this.profile].reflection[id]=value;this.save()}
 assertReset(){if(this.protected.has(this.profile))throw Error('EXTENSION_RECORD_PROTECTED')}
 reset({confirmed=false}={}){if(confirmed!==true)throw Error('CONFIRMATION_REQUIRED');this.assertReset();this.cache[this.profile]=this.blank();this.save()}
 summary(){return this.policy.summary.call(this)}
 recommend(learning){return this.policy.recommend.call(this,learning)}
}
global.ASKJourneyTools=JourneyTools;
})(typeof window!=='undefined'?window:globalThis);
