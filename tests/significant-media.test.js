const {test}=require('node:test'),assert=require('node:assert/strict');
const {intervals}=require('../js/significant-media');
test('significant runs split at non-significant samples and missing grid times',()=>{
  const p=(time,pAdjusted)=>({time,pAdjusted});
  const actual=intervals([p(0,.04),p(.5,.01),p(1,.2),p(1.5,.03),p(2.5,.02),p(3,.05)],.5);
  assert.deepEqual(actual,[{start:0,end:.5,count:2,minP:.01,peak:.5},{start:1.5,end:1.5,count:1,minP:.03,peak:1.5},{start:2.5,end:3,count:2,minP:.02,peak:2.5}]);
});
test('invalid p values are excluded, boundary .05 included, no input mutation',()=>{
  const input=[{time:3,pAdjusted:.05},{time:2,pAdjusted:null},{time:1,pAdjusted:NaN},{time:0,pAdjusted:1}];
  assert.deepEqual(intervals(input,1),[{start:3,end:3,count:1,minP:.05,peak:3}]);assert.equal(input[0].time,3);
  assert.deepEqual(intervals([],1),[]);
});
test('roundoff does not split adjacent times; unknown step never bridges samples',()=>{
  const points=[{time:.1,pAdjusted:.01},{time:.2,pAdjusted:.02},{time:.30000000000000004,pAdjusted:.01}];
  assert.equal(intervals(points,.1).length,1);assert.equal(intervals(points,NaN).length,3);
});
