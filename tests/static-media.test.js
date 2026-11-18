const {test}=require('node:test');
const assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
function setup(){
  class Image extends EventTarget {
    constructor(){super();this.naturalWidth=640;this.naturalHeight=360;this.attributes={};}
    removeAttribute(name){delete this.attributes[name];}
  }
  let now=0,next=0;const frames=new Map(),window={};
  const env={window,document:{createElement:()=>new Image()},Event,performance:{now:()=>now},
    requestAnimationFrame:fn=>{frames.set(++next,fn);return next;},cancelAnimationFrame:id=>frames.delete(id)};
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/static-media'),'utf8'),env);
  const advance=ms=>{now+=ms;const callbacks=[...frames.values()];frames.clear();callbacks.forEach(fn=>fn(now));};
  return {...window.MetricsStaticMedia,frames,advance};
}
test('media classification supports MIME types and local filenames without matching data files',()=>{
 const {kind}=setup();
 for(const name of ['a.png','a.JPG','a.webp','a.svg'])assert.equal(kind({name}),'image');
 for(const name of ['a.mp4','a.MOV','a.webm'])assert.equal(kind({name}),'video');
 assert.equal(kind({name:'a',type:'image/png'}),'image');
 assert.equal(kind({name:'metrics.json',type:'application/json'}),null);
 assert.equal(kind({name:'metrics.xlsx'}),null);
});
test('static stimulus clock pauses, resumes and stops exactly at the configured duration',async()=>{
 const t=setup(),image=t.create(3),events=[];
 for(const name of ['play','pause','ended'])image.addEventListener(name,()=>events.push(name));
 await assert.rejects(image.play(),/non ancora/);
 image.dispatchEvent(new Event('load'));
 assert.equal(image.readyState,4);assert.equal(image.videoWidth,640);
 await image.play();t.advance(1200);assert.equal(image.currentTime,1.2);
 image.pause();t.advance(2000);assert.equal(image.currentTime,1.2);
 await image.play();t.advance(2000);
 assert.equal(image.currentTime,3);assert.equal(image.ended,true);assert.equal(image.paused,true);assert.equal(t.frames.size,0);
 assert.deepEqual(events,['play','pause','play','pause','ended']);
 await image.play();assert.equal(image.currentTime,0);
 image.dispose();assert.equal(t.frames.size,0);assert.equal(image.readyState,0);
});
test('static image seeking clamps to duration and separate previews keep independent clocks',async()=>{
 const t=setup(),main=t.create(10),preview=t.create(2);
 main.dispatchEvent(new Event('load'));preview.dispatchEvent(new Event('load'));
 main.currentTime=30;assert.equal(main.currentTime,10);
 main.currentTime=-1;assert.equal(main.currentTime,0);
 preview.currentTime=1;await preview.play();t.advance(500);
 assert.equal(preview.currentTime,1.5);assert.equal(main.currentTime,0);
 preview.setDuration(1);assert.equal(preview.currentTime,1);
 preview.pause();assert.equal(t.frames.size,0);
});
