const {test}=require('node:test'),assert=require('node:assert/strict');
const {create}=require('../js/category-layout');
test('automatic spacing keeps all stimuli visible and avoids stretching sparse bars',()=>{
  const layout=create(),categories=['A','B'];
  const domain=layout.domain(categories,800);
  assert.equal(800/(domain[1]-domain[0]),200);
  assert.ok(domain[0]<0&&domain[1]>1);
});
test('free stimulus positions stay independent and can be restored',()=>{
  const layout=create();
  layout.move('A',.3);
  assert.equal(layout.position('A',0),.3);
  assert.equal(layout.position('B',1),1);
  layout.restore('A');assert.equal(layout.position('A',0),0);
  layout.move('B',-.2);layout.reset();
  assert.equal(layout.position('B',1),1);
});
