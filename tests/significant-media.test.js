const {test}=require('node:test'),assert=require('node:assert/strict');
const {intervals,bands}=require('../js/significant-media');
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


test('chart navigation selects the matching clip and seeks before or after metadata loads',()=>{
  const vm=require('node:vm'),fs=require('node:fs');
  const nodes=new Map(),frames=new Map();let nextFrame=0;
  class Element {
    constructor(tag){this.tagName=tag;this.children=[];this.dataset={};this.events={};this.readyState=0;this.duration=10;this.currentTime=0;this.classes=new Set();this.classList={toggle:(name,on)=>on?this.classes.add(name):this.classes.delete(name)};}
    append(...items){this.children.push(...items);}
    replaceChildren(){this.children=[];}
    setPointerCapture(){}
    setAttribute(){} removeAttribute(){} load(){} pause(){this.paused=true;}
    addEventListener(name,fn){this.events[name]=fn;}
    scrollIntoView(){this.scrolled=true;}
    focus(){this.focused=true;}
  }
  const get=id=>{if(!nodes.has(id))nodes.set(id,new Element('div'));return nodes.get(id);};
  const env={document:{getElementById:get,createElement:tag=>new Element(tag),createTextNode:text=>({textContent:text}),addEventListener(){}},MetricsVideo:{source:()=>({url:'demo.mp4'}),pause(){}},requestAnimationFrame:fn=>{frames.set(++nextFrame,fn);return nextFrame;},cancelAnimationFrame:id=>frames.delete(id),performance:{now:()=>0}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/significant-media'),'utf8'),env);
  const api=env.MetricsSignificantMedia;
  api.show([{time:1,pAdjusted:.01},{time:2,pAdjusted:.02},{time:3,pAdjusted:.5},{time:4,pAdjusted:.01}],{view:'series',epoch:'A',grid_step:1});
  const rows=get('significantIntervals').children,video=rows[0].children[1].children[0];
  api.focusTime(2);assert.equal(rows[0].focused,true);assert.equal(rows[0].classes.has('is-selected'),true);
  video.readyState=1;video.events.loadedmetadata();assert.equal(video.currentTime,2);assert.equal(rows[0].children[1].children[1].children[2].textContent,'2,00 s');
  api.focusTime(1);assert.equal(video.currentTime,1);assert.equal(video.paused,true);
  const controls=rows[0].children[1].children[1],slider=controls.children[1],clock=controls.children[2];
  slider.events.pointerdown({pointerId:1});
  slider.value='1.234567';slider.oninput();slider.value='1.765432';slider.oninput();
  assert.equal(frames.size,1);assert.equal(video.currentTime,1);assert.equal(clock.textContent,'1,77 s');
  const [id,callback]=frames.entries().next().value;frames.delete(id);callback();
  assert.equal(video.currentTime,1.765432);
  slider.events.pointerup();assert.equal(video.paused,true);assert.equal(clock.textContent,'1,77 s');
  api.focusTime(4);assert.equal(rows[0].classes.has('is-selected'),false);assert.equal(rows[1].classes.has('is-selected'),true);
  api.focusTime(3);assert.equal(rows[1].classes.has('is-selected'),true);
  api.clear();api.focusTime(1);assert.equal(get('significantIntervals').children.length,0);
});


test('green bands fill temporal cells and share the clip grouping without bridging gaps',()=>{
  const points=[{time:.5,pAdjusted:.01},{time:1,pAdjusted:.02},{time:1.5,pAdjusted:.05},{time:2,pAdjusted:.3},{time:2.5,pAdjusted:.01},{time:3.5,pAdjusted:.01}];
  const result=bands(points,.5);
  assert.deepEqual(result.map(r=>[r.left,r.right]),[[.25,1.75],[2.25,2.75],[3.25,3.75]]);
  assert.deepEqual(result.map(({left,right,...range})=>range),intervals(points,.5));
  assert.equal(result[0].right-result[0].left,3*.5);
  assert.deepEqual(bands([{time:1,pAdjusted:.01},{time:3,pAdjusted:.02}],2).map(r=>[r.left,r.right]),[[0,4]]);
  assert.deepEqual(bands(points,NaN).map(r=>[r.left,r.right]),[[.5,.5],[1,1],[1.5,1.5],[2.5,2.5],[3.5,3.5]]);
});
