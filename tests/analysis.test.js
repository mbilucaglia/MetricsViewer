const {test}=require('node:test');
const assert=require('node:assert/strict');
const A=require('../js/analysis'),P=require('../js/permutation');
test('summary IQR and MAD flag scalar outliers without temporal point thresholds',()=>{
  const items=[1,1,1,1,1,10].map((value,id)=>({id,value}));
  for(const method of ['iqr','mad']){const f=A.scalarFlags(items,method);assert.equal(f.get(5).status,'flagged');assert.equal(f.get(0).status,'within');}
  assert.equal(A.scalarFlags(items.slice(0,4)).get(0).status,'insufficient');
  assert.equal(A.scalarFlags(items,'none').get(5).status,'disabled');
});
test('time-series flags preserve minimum three deviating points and ten percent',()=>{
  const items=Array.from({length:6},(_,id)=>({r:{id},series:{time:Array.from({length:40},(_,i)=>i),values:Array.from({length:40},(_,i)=>id===5&&i<3?10:1)}}));
  const o={from:0,to:39,step:1,maxGap:3};
  assert.equal(A.temporalFlags(items,o,'iqr').get(5).status,'within');
  items[5].series.values[3]=10;
  assert.equal(A.temporalFlags(items,o,'iqr').get(5).status,'flagged');
});
test('summary flags are specific to the actual aggregated values',()=>{
  const means=[1,1,1,1,1,20].map((value,id)=>({id,value}));
  const medians=[1,1,1,1,1,1].map((value,id)=>({id,value}));
  assert.equal(A.scalarFlags(means).get(5).status,'flagged');
  assert.equal(A.scalarFlags(medians).get(5).status,'within');
});
test('complete-case time matrix removes incomplete times without treating null as zero',()=>{
  const result=A.completeTimeMatrix([{r:{id:'a',subject:'a'}},{r:{id:'b',subject:'b'}}],{time:[0,1,2],values:[[1,null,3],[2,4,6]]});
  assert.deepEqual(result.times,[0,2]);assert.equal(result.dropped,1);assert.deepEqual(result.subjects[0].values,[1,3]);
});
test('summary matrix uses only requested epochs and reports incomplete subjects',()=>{
  const records=[{id:'a',subject:'a'},{id:'b',subject:'b'}];
  const rows=[{subject:'a',epoch:'task',value:2},{subject:'b',epoch:'task',value:3}];
  assert.equal(A.completeSummaryMatrix(records,['task'],rows).subjects.length,2);
  assert.deepEqual(A.completeSummaryMatrix(records,['task','missing'],rows).excluded,['a','b']);
});
test('known t and F statistics',()=>{
  assert.ok(Math.abs(P.statistic([[1,2,3]],'one')-Math.sqrt(12))<1e-10);
  assert.equal(P.statistic([[1,2],[3,4]],'multi'),8);
});
test('seeded permutations are reproducible, preserve joint transformations, and correct p values',async()=>{
  const subjects=[1,2,3,4,5,6].map(v=>({values:[v,v,-v]}));
  const opts={subjects,times:[0,1,2],mode:'one',permutations:199,seed:42};
  const a=await P.run(opts),b=await P.run(opts);assert.deepEqual(a,b);
  for(const p of a){assert.equal(p.pAdjusted,p.pUncorrected);assert.ok(p.pAdjusted>=1/200&&p.pAdjusted<=1);}
  assert.equal(a[0].pAdjusted,a[2].pAdjusted);
});
test('multi-group permutation controls max statistic and validates group sizes',async()=>{
  const subjects=[1,2,3,4,8,9].map((v,i)=>({values:[v,i%3],groupIndex:i<3?0:1}));
  const r=await P.run({subjects,times:[0,1],mode:'multi',permutations:99,seed:2});
  for(const p of r)assert.ok(p.pAdjusted>=p.pUncorrected);
  await assert.rejects(P.run({subjects:[{values:[1],groupIndex:0},{values:[2],groupIndex:1}],times:[0],mode:'multi',permutations:99}));
});
test('permutation cancellation and missing-value validation',async()=>{
  const opts={subjects:[{values:[1]},{values:[2]}],times:[0],mode:'one',permutations:100};
  await assert.rejects(P.run({...opts,isCancelled:()=>true}),/annullata/);
  await assert.rejects(P.run({...opts,subjects:[{values:[1]},{values:[null]}]}),/finiti/);
});

const Isolation=require('../js/isolation');
test('visual isolation preserves selections and restores without mutating subjects',()=>{
  const selected=[{id:'a'},{id:'b'},{id:'c'}],original=structuredClone(selected),flags=new Map([['a',{status:'flagged'}],['b',{status:'within'}],['c',{status:'flagged'}]]),i=Isolation.create();
  i.toggleOutliers();assert.deepEqual(i.resolve(selected,flags),['a','c']);assert.deepEqual(selected,original);
  i.toggleSubject('b');assert.deepEqual(i.resolve(selected,flags),['b']);
  i.toggleSubject('b');assert.equal(i.resolve(selected,flags),null);assert.deepEqual(selected,original);
});
test('isolation handles no flags and removal or deselection of isolated subjects',()=>{
  const i=Isolation.create();i.toggleOutliers();assert.equal(i.resolve([{id:'a'}],new Map()),null);assert.equal(i.target,null);
  i.toggleSubject('a');assert.equal(i.resolve([{id:'b'}],new Map()),null);assert.equal(i.target,null);
  i.toggleOutliers();assert.deepEqual(i.resolve([{id:'a'}],new Map([['a',{status:'flagged'}],['b',{status:'flagged'}]])),['a']);
  i.reset();assert.equal(i.resolve([{id:'a'}],new Map()),null);
});

test('summary badge aggregates only checked epochs and reports partial evaluation',()=>{
  const records=[{id:'a'},{id:'b'},{id:'c'}],flags=new Map([['task1',new Map([['a',{status:'within'}],['b',{status:'flagged'}]])],['task2',new Map([['a',{status:'flagged'}],['b',{status:'insufficient'}]])]]);
  const one=A.summaryFlags(records,['task1'],flags);assert.equal(one.get('a').status,'within');
  const both=A.summaryFlags(records,['task1','task2'],flags);assert.deepEqual(both.get('a').flaggedEpochs,['task2']);assert.equal(both.get('b').status,'flagged');assert.deepEqual(both.get('b').unavailableEpochs,['task2']);assert.equal(both.get('c').status,'insufficient');
  assert.equal(A.summaryFlags(records,['task1'],flags,'none').get('c').status,'disabled');
});

test('independent post-hoc preserve pair sizes, direction, max correction and reproducibility',async()=>{
  const subjects=[1,2,4,6,10,13].map((v,i)=>({values:[v,2*v],groupIndex:Math.floor(i/2)}));
  const opts={subjects,times:[0,1],groupNames:['A','B','C'],permutations:199,seed:51};
  const result=await P.runPairwise(opts);assert.deepEqual(result,await P.runPairwise(opts));assert.equal(result.length,6);
  for(let pair=0;pair<3;pair++){
    const row=result[pair*2],a=row.groupIndexA,b=row.groupIndexB;
    const subset=subjects.filter(s=>s.groupIndex===a||s.groupIndex===b).map(s=>({...s,groupIndex:s.groupIndex===a?0:1}));
    const ref=await P.run({subjects:subset,times:[0,1],mode:'multi',permutations:199,seed:51+pair});
    assert.ok(row.pAdjusted>=row.pUncorrected);assert.equal(row.pAdjusted,result[pair*2+1].pAdjusted);
    assert.ok(row.statistic<0);assert.equal(row.nA,2);assert.equal(row.nB,2);assert.equal(row.n,4);
    assert.ok(Math.abs(row.statistic**2-ref[0].statistic)<1e-10);
  }
  await assert.rejects(P.runPairwise({...opts,isCancelled:()=>true}),/annullata/);
});
test('two independent groups need only the epoch family correction',async()=>{
 const subjects=[1,2,3,5,6].map((v,i)=>({values:[v],groupIndex:i<2?0:1}));
 const opts={subjects,times:[0],groupNames:['A','B'],permutations:99,seed:3};
 const r=await P.runPairwise(opts);assert.equal(r[0].nA,2);assert.equal(r[0].nB,3);assert.equal(r[0].pUncorrected,r[0].pAdjusted);
});

// Independent reference: all 90 assignments of six subjects to three groups of two.
test('joint group max-T agrees with exhaustive label assignments across pairs and epochs',async()=>{
  const values=[[1,8],[2,3],[4,7],[6,2],[10,4],[13,1]], pairs=[[0,1],[0,2],[1,2]];
  const t=(a,b)=>Math.abs((a[0]+a[1]-b[0]-b[1])/2)/Math.sqrt(((a[0]-a[1])**2+(b[0]-b[1])**2)/4);
  const stats=groups=>pairs.flatMap(([a,b])=>[0,1].map(j=>t(groups[a].map(i=>values[i][j]),groups[b].map(i=>values[i][j]))));
  const observed=stats([[0,1],[2,3],[4,5]]), raw=observed.map(()=>0), adjusted=observed.map(()=>0);
  let total=0;
  for(let a=0;a<6;a++)for(let b=a+1;b<6;b++){
    const rest=[0,1,2,3,4,5].filter(i=>i!==a&&i!==b);
    for(let c=0;c<4;c++)for(let d=c+1;d<4;d++){
      const perm=stats([[a,b],[rest[c],rest[d]],rest.filter((_,i)=>i!==c&&i!==d)]),max=Math.max(...perm);total++;
      observed.forEach((v,i)=>{if(perm[i]>=v-1e-12)raw[i]++;if(max>=v-1e-12)adjusted[i]++;});
    }
  }
  assert.equal(total,90);
  const result=await P.runPairwise({subjects:values.map((v,i)=>({values:v,groupIndex:Math.floor(i/2)})),times:[0,1],groupNames:['A','B','C'],permutations:9999,seed:127});
  result.forEach((r,i)=>{assert.ok(Math.abs(r.pUncorrected-raw[i]/total)<.025);assert.ok(Math.abs(r.pAdjusted-adjusted[i]/total)<.025);});
});


test('independent stimulus matrix uses the observed stimulus and preserves zero values', () => {
  const records = ['CN1', 'CN2', 'JN1', 'JN2', 'missing'].map(id => ({id, subject:id}));
  const epochs = ['Charlotte', 'Jhonatan'];
  const rows = records.slice(0, 4).map((record, i) => ({
    subject:record.subject, epoch:epochs[i < 2 ? 0 : 1], value:i
  }));
  const matrix = A.independentStimuliMatrix(records, epochs, rows);
  assert.equal(matrix.subjects.length, 4);
  assert.deepEqual(matrix.subjects.map(subject => subject.values), [[0],[1],[2],[3]]);
  assert.deepEqual(matrix.subjects.map(subject => subject.groupIndex), [0,0,1,1]);
  assert.deepEqual(matrix.subjects.map(subject => subject.sourceEpoch), ['Charlotte','Charlotte','Jhonatan','Jhonatan']);
  assert.throws(() => A.independentStimuliMatrix(records, epochs, [...rows, {subject:'CN1',epoch:'Jhonatan',value:2}]), /un solo stimolo per soggetto/);
  assert.throws(() => A.independentStimuliMatrix(records, epochs, rows.slice(0,3)), /almeno due soggetti/);
});
