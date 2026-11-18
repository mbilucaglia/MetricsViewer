const {test}=require('node:test'),assert=require('node:assert/strict');
const {compose,wrap}=require('../js/export-layout');
const previews=[13,11,8].map((time,index)=>({index,time,caption:time+' s · 0,148 (0,0847; 0,212)',source:{x:200+index*50,y:150,radius:11}}));
test('export layout preserves rank and aligns connected PiPs in temporal order',()=>{
 const model=compose(1000,420,previews);
 assert.deepEqual(model.cards.map(c=>c.index),[2,1,0]);
 assert.equal(new Set(model.cards.map(c=>c.y)).size,1);
 for(const card of model.cards){
  assert.equal(card.connector[0].x,card.source.x);
  assert.equal(card.connector[0].y,model.header+card.source.y+11);
  assert.equal(card.connector.at(-1).x,card.x+card.width/2);
  assert.ok(card.image.y+card.image.height<=model.height);
 }
 assert.deepEqual(previews.map(c=>c.index),[0,1,2]);
});
test('resizing recalculates card positions and connectors without changing the selected times',()=>{
 const wide=compose(1000,420,previews),narrow=compose(320,420,previews);
 assert.equal(new Set(narrow.cards.map(c=>c.x)).size,1);
 assert.equal(new Set(narrow.cards.map(c=>c.y)).size,3);
 assert.deepEqual(wide.cards.map(c=>c.time),narrow.cards.map(c=>c.time));
 assert.notDeepEqual(wide.cards[0].connector,narrow.cards[0].connector);
 for(const card of narrow.cards)assert.ok(card.x>=0&&card.x+card.width<=320);
});
test('export without open previews stays a complete chart with a finite size',()=>{
 const model=compose(900,420,[]);
 assert.equal(model.cards.length,0);assert.equal(model.height,458);
 assert.ok(Number.isFinite(model.width));
});
test('long group names wrap within the available caption width',()=>{
 const lines=wrap('GruppoMoltoLungoSenzaSpazi 0,148 (0,0847; 0,212)',80);
 assert.ok(lines.length>1);assert.ok(lines.every(line=>line.length*6.5<=80));
});
