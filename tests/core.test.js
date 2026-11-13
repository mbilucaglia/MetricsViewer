const {test}=require('node:test');
const assert=require('node:assert/strict');
const C=require('../js/core');
const s=(time,values)=>({time,values});
const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
test('z-score uses native baseline, sample SD, and preserves missing values',()=>{
  const r=C.normalize(s([0,1,2],[3,null,5]),s([0,.1,7],[1,2,3]),'zscore');
  assert.deepEqual(r.series.values,[1,null,3]);assert.equal(r.stats.n,3);
});
test('baseline window is applied before statistics',()=>{
  const r=C.normalize(s([0],[4]),s([0,1,2],[100,2,4]),'percent',1,2);near(r.series.values[0],100/3);
});
test('MAD supports raw and normal-consistent scale',()=>{
  const b=s([0,1,2,3,4],[1,2,3,4,100]);
  near(C.normalize(s([0],[4]),b,'zmad',-Infinity,Infinity,false).series.values[0],1);
  near(C.normalize(s([0],[4]),b,'zmad').series.values[0],1/1.4826);
});
test('invalid baselines never silently become zeros',()=>{
  assert.throws(()=>C.normalize(s([0],[2]),s([0,1],[1,1]),'zscore'));
  assert.throws(()=>C.normalize(s([0],[2]),undefined,'percent'));
  assert.throws(()=>C.normalize(s([0],[2]),s([0,1],[-1,1]),'percent'));
});
test('union uses null tails and actual contributors',()=>{
  const r=C.align([s([0,1,2],[1,2,3]),s([0,.5,1],[2,3,4])],{range:'union',step:.5});
  assert.deepEqual(r.summary.map(x=>x.n),[2,2,2,1,1]);assert.equal(r.values[1][4],null);
});
test('intersection respects differing starts and anchors grid at epoch zero',()=>{
  const r=C.align([s([.2,.7,1.2],[1,2,3]),s([0,.5,1],[1,2,3])],{step:.5});
  assert.deepEqual(r.time,[.5,1]);
});
test('does not interpolate through nulls or large gaps',()=>{
  assert.deepEqual(C.resample(s([0,1,2,10],[1,null,3,4]),[.5,1.5,5],{step:.5,maxGap:2}),[null,null,null]);
});
test('boxcar suppresses high-frequency alternating samples when downsampling',()=>{
  const input=s(Array.from({length:101},(_,i)=>i*.1),Array.from({length:101},(_,i)=>i%2?1:-1));
  const out=C.resample(input,[2,4,6,8],{step:2});out.forEach(x=>near(x,0));
});
test('weighted mean integrates native irregular times and clips windows',()=>{
  const input=s([0,1,4],[0,4,4]);near(C.aggregate(input,'mean').value,8/3);
  near(C.aggregate(input,'weighted').value,3.5);near(C.aggregate(input,'weighted',.5,2).value,11/3);
});
test('weighted mean excludes gap duration',()=>{
  const a=C.aggregate(s([0,1,10,11],[2,2,8,8]),'weighted',-Infinity,Infinity,2);near(a.value,5);near(a.duration,2);
});
test('no overlap and excessively large grids fail clearly',()=>{
  assert.throws(()=>C.align([s([0,1],[1,2]),s([2,3],[1,2])]));
  assert.throws(()=>C.align([s([0,100],[1,2])],{step:.00001}));
});
test('schema rejects mismatched, duplicate or nonnumeric data',()=>{
  const d={schema_version:1,time_unit:'s',recordings:[{id:'a',subject:'a',epochs:[{id:'task',metrics:{AWI:s([0,1],[2,null])}}]}]};
  assert.equal(C.validate(d),d);assert.throws(()=>C.merge([d,d]));
  const bad=structuredClone(d);bad.recordings[0].epochs[0].metrics.AWI.time=[0,0];assert.throws(()=>C.validate(bad));
  const bad2=structuredClone(d);bad2.recordings[0].epochs[0].metrics.AWI.values=[2,'3'];assert.throws(()=>C.validate(bad2));
});

test('all epochs share subject-specific baseline statistics and preserve native timestamps',()=>{
  const record={id:'a',epochs:[{id:'baseline',metrics:{AWI:s([0,1,2],[1,2,3])}},{id:'task1',metrics:{AWI:s([0,2],[3,5])}},{id:'task2',metrics:{AWI:s([.5,1],[4,null])}}]};
  const normalized=C.normalizeAllEpochs([record],'AWI',{norm:'zscore',baseline:'baseline'}).get('a');
  assert.deepEqual(normalized.get('task1').series.values,[1,3]);
  assert.deepEqual(normalized.get('task2').series.values,[2,null]);
  assert.equal(normalized.get('task1').stats,normalized.get('task2').stats);
  assert.deepEqual(normalized.get('task1').series.time,[0,2]);
  assert.deepEqual(record.epochs[1].metrics.AWI.values,[3,5]);
});
test('normalization cache reuses all epochs across view changes and invalidates baseline changes',()=>{
  const records=[{id:'a',epochs:[{id:'baseline',metrics:{AWI:s([0,1,2],[1,2,3])}},{id:'task',metrics:{AWI:s([0],[5])}}]}];
  const cache=C.createNormalizationCache(),o={norm:'zscore',baseline:'baseline',baseFrom:-Infinity,baseTo:Infinity,scaled:true};
  const first=cache(records,'AWI',o);
  assert.equal(cache(records,'AWI',{...o,from:1,to:2,step:.5}),first);
  const changed=cache(records,'AWI',{...o,norm:'percent'});
  assert.notEqual(changed,first);assert.equal(changed.get('a').get('task').series.values[0],150);
  assert.notEqual(cache([...records],'AWI',{...o,norm:'percent'}),changed);
  assert.match(cache(records,'AWI',{...o,baseline:'missing'}).get('a').get('task').error,/Baseline assente/);
});
