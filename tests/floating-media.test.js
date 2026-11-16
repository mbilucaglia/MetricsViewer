const {test}=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../js/floating-media');
function setup(){
  class Element{
    constructor(){this.children=[];this.style={};this.attrs={};this.listeners={};this.classes=new Set();this.isConnected=true;this.offsetWidth=360;this.offsetHeight=320;this.rect={left:100,right:116,top:300,bottom:316};this.classList={add:c=>this.classes.add(c),remove:c=>this.classes.delete(c),toggle:(c,on)=>on?this.classes.add(c):this.classes.delete(c)};}
    append(...items){for(const item of items){item.remove();item.parent=this;item.isConnected=true;this.children.push(item);}}
    remove(){if(this.parent)this.parent.children=this.parent.children.filter(c=>c!==this);this.parent=null;this.isConnected=false;}
    setAttribute(k,v){this.attrs[k]=String(v);}
    addEventListener(k,fn){(this.listeners[k]??=new Set()).add(fn);}
    removeEventListener(k,fn){this.listeners[k]?.delete(fn);}
    emit(k,e={}){for(const fn of this.listeners[k]||[])fn({preventDefault(){},...e});}
    getBoundingClientRect(){return this.rect;}
    focus(){this.focused=true;}
    setPointerCapture(){}
  }
  const doc=new Element(),win=new Element(),body=new Element(),store=new Element();doc.body=body;doc.createElement=doc.createElementNS=()=>new Element();
  Object.assign(win,{innerWidth:1200,innerHeight:800,requestAnimationFrame:fn=>{win.pending=fn;return 1;},cancelAnimationFrame:()=>{win.pending=null;}});
  const closed=[],manager=create({document:doc,window:win,onClose:(index,row)=>{closed.push(index);store.append(row);}});
  return {Element,doc,win,body,store,closed,manager};
}
test('multiple PiPs retain independent positions, links and rows across chart redraws',()=>{
  const {Element,manager,closed}=setup(),a=new Element(),b=new Element(),rowA=new Element(),rowB=new Element();
  const first=manager.open(0,a,rowA,'First'),second=manager.open(1,b,rowB,'Second');
  assert.equal(manager.has(0),true);assert.equal(manager.has(1),true);
  assert.equal(manager.open(0,a,rowA,'First'),first);
  const oldX=first.x,oldY=first.y,secondX=second.x;
  first.handle.emit('pointerdown',{button:0,pointerId:2,clientX:100,clientY:100});
  first.handle.emit('pointermove',{pointerId:2,clientX:200,clientY:140});first.handle.emit('pointerup');
  assert.equal(first.x,oldX+100);assert.equal(first.y,oldY+40);assert.equal(second.x,secondX);
  const newA=new Element(),newB=new Element();newA.rect={left:200,right:216,top:250,bottom:266};a.isConnected=false;b.isConnected=false;
  manager.reanchor([newA,newB]);assert.equal(first.x,oldX+100);assert.equal(first.line.attrs.x1,'208');assert.equal(newA.attrs['aria-expanded'],'true');
  const toggle=first.box.children[0].children[1];toggle.onclick();assert.equal(first.line.classes.has('is-hidden'),true);assert.equal(toggle.attrs['aria-pressed'],'false');
  manager.close(0,true);assert.deepEqual(closed,[0]);assert.equal(newA.focused,true);assert.equal(manager.has(1),true);
  assert.equal(rowB.parent,second.box);manager.clear();assert.deepEqual(closed,[0,1]);
});
test('dragging is bounded, keyboard movement works, and Escape closes only the active PiP',()=>{
  const {Element,manager,doc,win,body}=setup();
  const first=manager.open(0,new Element(),new Element(),'First'),second=manager.open(1,new Element(),new Element(),'Second');
  first.handle.emit('pointerdown',{button:0,pointerId:1,clientX:0,clientY:0});first.handle.emit('pointermove',{pointerId:1,clientX:-5000,clientY:5000});first.handle.emit('pointerup');
  assert.equal(first.x,8);assert.equal(first.y,472);
  first.handle.emit('keydown',{key:'ArrowRight'});assert.equal(first.x,18);
  doc.emit('keydown',{key:'Escape'});assert.equal(manager.has(0),false);assert.equal(manager.has(1),true);
  second.anchor.rect={left:0,right:16,top:-40,bottom:-24};doc.emit('scroll');win.pending();assert.equal(second.line.classes.has('is-hidden'),true);assert.equal(manager.has(1),true);
  win.innerWidth=400;win.innerHeight=400;doc.documentElement={clientWidth:384};win.emit('resize');win.pending();assert.ok(second.x<=16);assert.ok(second.y<=72);
  manager.clear();assert.equal(body.children.length,0);assert.equal(doc.listeners.scroll.size,0);assert.equal(doc.listeners.keydown.size,0);assert.equal(win.listeners.resize.size,0);
});
