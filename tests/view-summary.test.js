const {test}=require('node:test'),assert=require('node:assert/strict');
const V=require('../js/view-summary'),A=require('../js/analysis');
const groups=[{id:'g1',name:'Controllo',members:['a','b']},{id:'g2',name:'Trattamento',members:['c','d']}];
const items=['a','b','c','d'].map(id=>({r:{id}}));
test('group series means and confidence intervals use the actual contributors at each time',()=>{
 const output=V.series({time:[0,1],values:[[1,null],[3,4],[11,12],[13,14]]},items,groups);
 assert.deepEqual(output[0].summary[0],{mean:2,ci:A.ci95([1,3]),n:2});
 assert.deepEqual(output[0].summary[1],{mean:4,ci:null,n:1});
 assert.equal(output[1].summary[0].mean,12);
 const rows=V.csvRows(output,'Tempo (s)');
 assert.equal(Object.keys(rows[0]).length,7);assert.equal(rows[0]['Tempo (s)'],0);
 assert.equal(rows[0]['Controllo · Media'],2);
 assert.equal(rows[1]['Controllo · IC 95% inferiore'],null);
 assert.equal(rows[0]['Trattamento · IC 95% superiore'],12+A.ci95([11,13]));
 assert.ok(Object.keys(rows[0]).every(key=>!key.includes('subject')&&!key.includes('normalization')));
});
test('temporal summary exports an epoch and separate group means with both CI bounds',()=>{
 const records=items.map(({r})=>({...r,subject:r.id}));
 const rows=[{subject:'a',epoch:'A',value:1},{subject:'b',epoch:'A',value:3},{subject:'c',epoch:'B',value:7},{subject:'d',epoch:'B',value:9}];
 const result=V.csvRows(V.summary(['A','B'],rows,records,groups),'Stimolo');
 assert.equal(result[0].Stimolo,'A');assert.equal(result[0]['Controllo · Media'],2);
 assert.equal(result[0]['Trattamento · Media'],null);assert.equal(result[1]['Trattamento · Media'],8);
 assert.equal(result[1]['Trattamento · IC 95% inferiore'],8-A.ci95([7,9]));
});

test('group symbols distinguish circles, squares and polygon shapes at the same anchor',()=>{
 assert.deepEqual(V.symbol('square',10,20,4),{tag:'rect',attrs:{x:6,y:16,width:8,height:8,rx:2}});
 assert.equal(V.symbol('circle',10,20).tag,'circle');
 for(const shape of ['triangle','diamond','hexagon'])assert.equal(V.symbol(shape,10,20).tag,'polygon');
});
