const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(){
  class Element{
    constructor(){this.children=[];this.handlers={};this.attrs={};this.currentTime=0;this.duration=20;this.readyState=1;this.paused=true;this.isConnected=true;}
    append(...items){this.children.push(...items);}
    replaceChildren(){this.children=[];}
    setAttribute(k,v){this.attrs[k]=String(v);}
    getAttribute(k){return this.attrs[k];}
    removeAttribute(k){delete this.attrs[k];}
    addEventListener(k,fn){this.handlers[k]=fn;}
    querySelectorAll(){return [this.dismiss??=new Element()];}
    querySelector(){return this.confirm??=new Element();}
    showModal(){this.open=true;}
    close(){this.open=false;this.handlers.close?.();}
    pause(){this.paused=true;this.handlers.pause?.();}
    load(){this.currentTime=0;}
    getScreenCTM(){return {inverse:()=>({})};}
    createSVGPoint(){return {matrixTransform(){return {x:this.x,y:this.y};}};}
    focus(){}
  }
  const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);},revoked=[],frames=new Map();let n=0;
  const handlers = {};
  const window={addEventListener(){},removeEventListener(){}},env={window,document:{getElementById:get,createElement:()=>new Element(),createTextNode:text=>({textContent:text}),createElementNS:()=>new Element(),addEventListener:(name,handler)=>{handlers[name]=handler;},removeEventListener:name=>{delete handlers[name];}},URL:{createObjectURL:()=>`blob:${++n}`,revokeObjectURL:url=>revoked.push(url)},requestAnimationFrame:fn=>{frames.set(++n,fn);return n;},cancelAnimationFrame:id=>frames.delete(id)};
  const sandbox=vm.createContext(env);
  for (const script of ['settings-dialog','video']) vm.runInContext(fs.readFileSync(require.resolve('../js/'+script),'utf8'),sandbox);
  const api=window.MetricsVideo,video=get('stimulusVideo');
  const dialog=get('videoAssignmentDialog');
  const open=()=>get('openVideoAssignments').onclick();
  const confirm=()=>dialog.confirm.onclick();
  const cancel=()=>dialog.dismiss.onclick();
  function choose(index,name){const input=get('videoAssignments').children[index].children[0].children[0];input.files=[{name}];input.handlers.change();}
  function assign(index,name){open();choose(index,name);confirm();}
  function chart(options){const svg=new Element();api.attach(svg,{min:5,max:15,left:50,top:20,width:100,height:100,...options});return svg;}
  return {api,get,video,assign,choose,open,confirm,cancel,chart,revoked,frames,handlers};
}
test('per-epoch video switching, replacement, removal and dataset cleanup',()=>{
  const t=setup();t.api.setContext(['A','B'],'A','series');t.assign(0,'a.mp4');const a=t.video.src;
  t.video.currentTime=8;t.video.handlers.timeupdate();t.api.setContext(['A','B'],'A','series');assert.equal(t.video.currentTime,8);
  t.assign(1,'b.webm');assert.equal(t.video.src,a);
  t.api.setContext(['A','B'],'B','series');assert.notEqual(t.video.src,a);assert.equal(t.video.currentTime,0);
  const b=t.video.src;t.assign(1,'b2.mp4');assert.ok(t.revoked.includes(b));
  const b2=t.video.src;t.open();const selected=t.get('videoAssignments').children[1].children[2].children[0];selected.checked=true;selected.onchange();t.confirm();assert.ok(t.revoked.includes(b2));assert.equal(t.video.hidden,true);
  t.api.setContext([],'','series');assert.ok(t.revoked.includes(a));assert.equal(t.get('videoAssignments').children.length,0);
});
test('playback updates all cursors and only the time axis seeks the video',()=>{
  const t=setup();t.api.setContext(['A'],'A','series');t.assign(0,'a.mp4');const a=t.chart(),b=t.chart();
  assert.equal(a.children[0].attrs.visibility, 'visible');
  assert.equal(a.children[0].attrs.x1, '50');
  assert.equal(a.children[2].children[1].textContent, '0.00 s');
  t.video.currentTime=10;t.video.handlers.timeupdate();
  for(const svg of [a,b])assert.equal(svg.children[0].attrs.x1,'100');
  assert.equal(a.handlers.click, undefined);
  assert.equal(a.children[0].attrs.y2, '155');
  const axis = a.children[1];
  axis.handlers.keydown({key:'ArrowRight',preventDefault(){}});assert.equal(t.video.currentTime,11);
  axis.handlers.pointerdown({pointerId:1,isPrimary:true,button:0,clientX:75,preventDefault(){}});
  t.handlers.pointermove({pointerId:1,clientX:125});assert.equal(t.video.currentTime,12.5);
  assert.equal(a.children[2].children[1].textContent,'12.50 s');
  t.handlers.pointerup({pointerId:1,type:'pointerup',clientX:125});
  assert.equal(t.handlers.pointermove, undefined);
  t.video.duration=9;axis.handlers.keydown({key:'End',preventDefault(){}});assert.equal(t.video.currentTime,9);
  t.video.currentTime=19;t.video.handlers.seeked();assert.equal(a.children[0].attrs.visibility,'hidden');
  t.video.paused=false;t.video.handlers.play();assert.equal(t.frames.size,1);
  t.api.setContext(['A'],'A','summary');assert.equal(t.video.paused,true);assert.equal(t.frames.size,0);assert.equal(t.get('videoCard').hidden,true);
  t.api.setContext(['A'],'A','series');t.video.handlers.error();assert.match(t.get('videoError').textContent,/non riproducibile/);
});
test('the overview marks the video time and following runs during playback only',()=>{
  const t=setup();
  t.api.setContext(['A'],'A','series');
  t.assign(0,'a.mp4');
  const followed=[];
  const svg=t.chart({
    overview:{min:5,max:20,x:50,y:180,width:150,height:40},
    followPlayback:(time,now)=>followed.push([time,now])
  });
  const overview=svg.children[3];
  assert.equal(overview.attrs.visibility,'hidden');
  t.video.currentTime=10;
  t.video.handlers.timeupdate();
  assert.equal(overview.attrs.x1,'100');
  assert.deepEqual(followed,[]);
  t.video.paused=false;
  t.video.handlers.play();
  t.video.currentTime=16;
  const [id,tick]=t.frames.entries().next().value;
  t.frames.delete(id);
  tick(125);
  assert.equal(svg.children[0].attrs.visibility,'hidden');
  assert.equal(overview.attrs.x1,'160');
  assert.deepEqual(followed,[[16,125]]);
  t.video.pause();
  t.video.currentTime=3;
  t.video.handlers.seeked();
  assert.equal(overview.attrs.visibility,'hidden');
  assert.deepEqual(followed,[[16,125]]);
});

test('bundled videos replace uploads, switch by epoch and never revoke file URLs',()=>{
  const t=setup();t.api.setContext(['A','B'],'A','series');t.assign(0,'upload.mp4');const uploaded=t.video.src;
  const items=[{epoch:'A',url:'file:///a.mp4',name:'a.mp4'},{epoch:'B',url:'file:///b.mp4',name:'b.mp4'}];
  t.api.replaceAssignments(items);assert.ok(t.revoked.includes(uploaded));assert.equal(t.video.src,items[0].url);
  t.api.setContext(['A','B'],'B','series');assert.equal(t.video.src,items[1].url);
  t.video.currentTime=8;t.api.replaceAssignments(items);assert.equal(t.video.currentTime,0);
  t.assign(1,'replacement.mp4');const replacement=t.video.src;t.api.setContext([],'','series');
  assert.ok(t.revoked.includes(replacement));assert.ok(t.revoked.every(url=>url.startsWith('blob:')));
});

test('cancel leaves the original video assigned and its URL in use',()=>{
  const t=setup();t.api.setContext(['A'],'A','series');t.assign(0,'original.mp4');
  const original=t.video.src;
  t.open();t.choose(0,'draft.mp4');
  assert.equal(t.video.src,original);
  assert.equal(t.api.source('A').name,'original.mp4');
  t.cancel();
  assert.equal(t.get('videoAssignments').children[0].children[1].textContent,'original.mp4');
  assert.equal(t.revoked.length,0);
});
