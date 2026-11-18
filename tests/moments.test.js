const {test}=require('node:test'),assert=require('node:assert/strict');
const {detect}=require('../js/moments');
test('global extrema honor values, deterministic ties and clip boundaries',()=>{
  const t=[0,1,2,3,4],v=[1,5,2,5,-1];
  const max=detect(t,v,{before:2,after:2,step:1})[0];assert.equal(max.peak,1);assert.equal(max.start,0);assert.equal(max.end,3);
  assert.equal(detect(t,v,{criterion:'min',step:1})[0].peak,4);
});
test('local peaks group plateaus, rank by height and enforce time separation',()=>{
  const t=[0,1,2,3,4,5,6,7,8],v=[0,2,2,0,4,0,3,0,0];
  assert.deepEqual(detect(t,v,{criterion:'peaks',step:1,distance:3}).map(x=>x.peak),[4,1]);
  assert.deepEqual(detect(t,v,{criterion:'troughs',step:1,distance:0}).map(x=>x.peak),[3,5]);
  assert.equal(detect(t,t.map(()=>2),{criterion:'peaks',step:1}).length,0);
});
test('missing samples and time gaps split search and clip context',()=>{
  const result=detect([0,1,2,4,5],[0,5,null,8,0],{step:1,before:10,after:10})[0];
  assert.equal(result.peak,4);assert.equal(result.start,4);assert.equal(result.end,5);
  assert.equal(detect([0,1,3],[0,5,0],{criterion:'peaks',step:1}).length,0);
  assert.equal(detect([0,1],[null,NaN],{step:1}).length,0);
});
test('60 Hz detection preserves sample precision and rejects invalid settings',()=>{
  const result=detect([1/60,2/60,3/60],[0,3,0],{criterion:'peaks',step:1/60})[0];assert.equal(result.peak,2/60);
  assert.throws(()=>detect([0],[1],{count:51}));assert.throws(()=>detect([0],[1],{before:-1}));
});

test('default peak clips cover exactly one temporal cell at 0.5 s and 60 Hz',()=>{
 for(const step of [.5,1/60]){
  const range=detect([0,step,2*step],[0,5,0],{step,criterion:'peaks'})[0];
  assert.ok(Math.abs(range.start-step/2)<1e-12);
  assert.ok(Math.abs(range.end-1.5*step)<1e-12);
  assert.ok(Math.abs(range.end-range.start-step)<1e-12);
 }
 assert.equal(detect([0,1],[5,0],{step:1})[0].start,0);
 assert.equal(detect([2],[5])[0].end,2);
});
