const {test}=require('node:test');
const assert=require('node:assert/strict');
const R=require('../js/repeated'),P=require('../js/permutation'),A=require('../js/analysis');
const subjects=rows=>rows.map((values,i)=>({id:String(i),subject:String(i),values}));
const fixture=[[1,2,3],[2,4,4],[1,3,5],[3,3,6]];
test('RM F agrees with independently calculated sums of squares and removes subject intercepts',()=>{
  assert.ok(Math.abs(R.repeatedF(fixture)-13)<1e-12);
  assert.ok(Math.abs(R.repeatedF(fixture.map((r,i)=>r.map(x=>x+100*i)))-13)<1e-10);
  const rows=fixture.map(r=>r.slice(0,2));
  assert.ok(Math.abs(R.repeatedF(rows)-P.statistic([rows.map(r=>r[0]-r[1])],'one')**2)<1e-12);
});
test('two epochs use paired differences, preserve sign, and need no multiplicity correction',async()=>{
  const result=await R.run({subjects:subjects([[10,9],[20,18],[30,27]]),epochs:['A','B'],permutations:499,seed:4});
  assert.equal(result.omnibus,null);assert.equal(result.comparisons.length,1);
  const p=result.comparisons[0];assert.equal(p.meanDifference,2);assert.ok(Math.abs(p.statistic-Math.sqrt(12))<1e-12);
  assert.equal(p.pAdjusted,p.pUncorrected);assert.equal(p.df1,2);
  const reverse=await R.run({subjects:subjects([[9,10],[18,20],[27,30]]),epochs:['B','A'],permutations:499,seed:4});
  assert.equal(reverse.comparisons[0].statistic,-p.statistic);assert.equal(reverse.comparisons[0].pAdjusted,p.pAdjusted);
});
test('RM run is reproducible, computes all pairs, and applies joint max-T only to post-hoc family',async()=>{
  const options={subjects:subjects(fixture),epochs:['A','B','C'],permutations:199,seed:42};
  const progress=[];const result=await R.run({...options,onProgress:(done,total)=>progress.push([done,total])});
  assert.deepEqual(result,await R.run(options));assert.ok(Math.abs(result.omnibus.statistic-13)<1e-12);
  assert.equal(result.omnibus.df1,2);assert.equal(result.omnibus.df2,6);
  assert.equal(result.omnibus.pAdjusted,result.omnibus.pUncorrected);assert.equal(result.comparisons.length,3);
  const expected=await P.run({subjects:subjects(fixture.map(r=>[r[0]-r[1],r[0]-r[2],r[1]-r[2]])),times:[0,1,2],mode:'one',permutations:199,seed:42^0x5A17});
  assert.deepEqual(result.comparisons.map(p=>p.pAdjusted),expected.map(p=>p.pAdjusted));
  assert.deepEqual(progress.at(-1),[398,398]);assert.ok(progress.every(([d],i)=>i===0||d>=progress[i-1][0]));
  for(const p of [result.omnibus,...result.comparisons]){assert.ok(p.pAdjusted>=p.pUncorrected);assert.ok(p.pUncorrected>=1/200&&p.pAdjusted<=1);}
});
test('constant rows and zero paired differences yield p=1',async()=>{
  const r=await R.run({subjects:subjects([[1,1,1],[2,2,2],[3,3,3]]),epochs:['A','B','C'],permutations:99});
  assert.equal(r.omnibus.statistic,0);assert.equal(r.omnibus.pAdjusted,1);
  assert.ok(r.comparisons.every(p=>p.statistic===0&&p.pAdjusted===1));
});
test('complete cases stay aligned by subject when rows are reordered or missing',async()=>{
  const records=[{id:'a',subject:'a'},{id:'b',subject:'b'},{id:'c',subject:'c'}];
  const rows=[{subject:'b',epoch:'B',value:3},{subject:'a',epoch:'A',value:4},{subject:'c',epoch:'A',value:10},{subject:'b',epoch:'A',value:6},{subject:'a',epoch:'B',value:2}];
  const m=A.completeSummaryMatrix(records,['A','B'],rows);assert.deepEqual(m.excluded,['c']);
  const r=await R.run({subjects:m.subjects,epochs:['A','B'],permutations:99});assert.equal(r.comparisons[0].meanDifference,2.5);assert.equal(r.comparisons[0].n,2);
});
test('rejects missing values and invalid designs; cancellation works in omnibus and post-hoc',async()=>{
  const opts={subjects:subjects(fixture),epochs:['A','B','C'],permutations:99};
  await assert.rejects(R.run({...opts,isCancelled:()=>true}),/annullata/);
  let cancelled=false;await assert.rejects(R.run({...opts,onProgress:d=>{if(d>=99)cancelled=true;},isCancelled:()=>cancelled}),/annullata/);
  await assert.rejects(R.run({...opts,subjects:subjects([[1,null,3],[2,4,5]])}),/completi/);
  await assert.rejects(R.run({...opts,epochs:['A']}),/due epoche/);
  await assert.rejects(R.run({...opts,epochs:['A','A','C']}),/distinte/);
});

test('Monte Carlo omnibus and max-T agree with independent exact enumeration',async()=>{
  // Exact rational arithmetic over 6^4 within-subject label permutations:
  // F >= 13 occurs 24/1296 times. Over all 2^4 joint sign patterns, the
  // max-|T| exceedance proportions are 4/16, 2/16, and 6/16.
  const r=await R.run({subjects:subjects(fixture),epochs:['A','B','C'],permutations:9999,seed:174});
  assert.ok(Math.abs(r.omnibus.pUncorrected-24/1296)<.006);
  [.25,.125,.375].forEach((p,i)=>assert.ok(Math.abs(r.comparisons[i].pAdjusted-p)<.02));
});
