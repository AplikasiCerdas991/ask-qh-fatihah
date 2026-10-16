(function(global){'use strict';
// Pure assessment policy. No DOM, storage, speech or canonical text literals.
const profiles=['adult','kid'],own=(x,k)=>Object.hasOwn(x,k),object=x=>x!==null&&typeof x==='object'&&!Array.isArray(x);
const sameSet=(a,b)=>Array.isArray(a)&&Array.isArray(b)&&a.length===b.length&&new Set(a).size===a.length&&a.every(x=>b.includes(x));
function validDraft(i,d,complete=false){
    if (i.type === 'MCQ') return (!complete && d === null) || i.option_refs.includes(d);
    if (i.type === 'TF') return (!complete && d === null) || typeof d === 'boolean';
    if (i.type === 'ORDER') return Array.isArray(d) && new Set(d).size === d.length && d.every(x => i.token_refs.includes(x)) && (!complete || d.length === i.token_refs.length);
    if (i.type === 'PAIR') return object(d) && Object.keys(d).every(l => i.left_refs.includes(l) && i.right_refs.includes(d[l])) && new Set(Object.values(d)).size === Object.keys(d).length && (!complete || Object.keys(d).length === i.left_refs.length);
    return false;
  }
function empty(i){ return i.type === 'PAIR' ? {} : i.type === 'ORDER' ? [] : null; }
function evaluate(i,answer,content,requireThat){
    requireThat(validDraft(i, answer, true), 'INCOMPLETE_OR_INVALID_ANSWER');
    if (i.type === 'PAIR') return i.valid_pairs.map(([l, r]) => ({ scoreUnitId: i.id + '::' + l, correct: answer[l] === r }));
    let correct;
    if (i.type === 'MCQ') correct = answer === i.answer_ref;
    if (i.type === 'TF') correct = answer === i.expected_truth;
    if (i.type === 'ORDER') {
      const text = id => content.tokens.find(t => t.id === id)?.arabic_exact_slice;
      correct = answer.every((id, n) => id === i.answer_token_refs[n] || (i.equivalent_occurrences || []).some(group => group.includes(id) && group.includes(i.answer_token_refs[n]) && text(id) === text(i.answer_token_refs[n])));
    }
    return [{ scoreUnitId: i.id, correct }];
  }
function orders(item,shuffle){ const x = {}; for (const k of ['option_refs', 'left_refs', 'right_refs', 'token_refs']) if (item[k]) x[k] = shuffle(item[k]); return x; }
function validateItem(i,c,requireThat){const ids=new Set(c.refs.map(x=>x.id));
      requireThat(i.approval_status === 'OWNER_APPROVED_CONTENT' && i.content_version === c.version, 'UNAPPROVED_ITEM_OR_VERSION');
      requireThat(['FLASH', 'MCQ', 'TF', 'PAIR', 'ORDER'].includes(i.type), 'ITEM_TYPE');
      for (const k of ['arabic_ref', 'answer_ref', 'correction_ref', 'displayed_meaning_ref', 'front_ref', 'back_ref']) if (own(i, k)) requireThat(ids.has(i[k]), 'MISSING_REF');
      for (const k of ['option_refs', 'token_refs', 'answer_token_refs', 'left_refs', 'right_refs']) if (own(i, k)) requireThat(Array.isArray(i[k]) && i[k].every(r => ids.has(r)), 'MISSING_REF');
      if (i.type === 'MCQ') requireThat(i.option_refs.length === 3 && new Set(i.option_refs).size === 3 && i.option_refs.includes(i.answer_ref), 'MCQ_KEY');
      if (i.type === 'TF') requireThat(typeof i.expected_truth === 'boolean', 'TF_KEY');
      if (i.type === 'PAIR') requireThat(profiles.includes(i.profile) && i.left_refs.length === i.right_refs.length && i.valid_pairs.length === i.left_refs.length && new Set(i.left_refs).size === i.left_refs.length && new Set(i.right_refs).size === i.right_refs.length && new Set(i.valid_pairs.map(p => p[0])).size === i.left_refs.length && new Set(i.valid_pairs.map(p => p[1])).size === i.right_refs.length && i.valid_pairs.every(([l, r]) => i.left_refs.includes(l) && i.right_refs.includes(r)), 'PAIR_KEY');
      if (i.type === 'ORDER') requireThat(i.token_refs.length > 0 && new Set(i.token_refs).size === i.token_refs.length && sameSet(i.token_refs, i.answer_token_refs), 'ORDER_KEY');}
global.ASKTrainingPolicy=Object.freeze({contractVersion:1,id:'FATIHAH-P13-TRAINING-POLICY-01',trainingTypes:Object.freeze(['MCQ','TF','PAIR','ORDER']),retentionDelayMs:86400000,validDraft,empty,evaluate,orders,validateItem,applicable:(i,profile)=>i.type!=='FLASH'&&(i.type!=='PAIR'||i.profile===profile)});
})(typeof window!=='undefined'?window:globalThis);
