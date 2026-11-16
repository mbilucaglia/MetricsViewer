const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(){
  class Element{
    constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.style={};this.value='';this.text='';this.classList={toggle(){}};}
    append(...children){this.children.push(...children);for(const c of children)c.parentElement=this;}
    replaceChildren(...children){this.children=[];this.append(...children);}
    setAttribute(){} addEventListener(){} click(){} remove(){}
    get textContent(){return this.text+this.children.map(c=>c.textContent).join(' ');}set textContent(v){this.text=String(v);}
    get selectedOptions(){return [{textContent:this.value}];}
    querySelectorAll(){return [];}querySelector(){return this.option||(this.option=new Element('option'));}
  }
  const nodes=new Map(),get=id=>{if(!nodes.has(id)){const e=new Element();e.parentElement=new Element();nodes.set(id,e);}return nodes.get(id);};
  const handlers={},plots=[],blobs=[],media=[];
  const document={getElementById:get,createElement:t=>new Element(t),addEventListener:(name,fn)=>handlers[name]=fn};
  for(const[id,value]of Object.entries({design:'one',nullValue:'0',permutations:'100',seed:'42',aggregation:'mean',normalization:'none',range:'intersection',interpolation:'linear',outlierSummary:'none',outlierSeries:'none'}))get(id).value=value;
  const env={MetricsSignificantMedia:{show:(results,meta)=>media.push({results,meta}),clear:()=>media.push(null)},document,MetricsCore:require('../js/core'),MetricsAnalysis:require('../js/analysis'),MetricsIsolation:require('../js/isolation'),MetricsRepeated:require('../js/repeated'),TimeSeriesPermutation:require('../js/permutation'),MetricsBusy:{start:()=>({step:async()=>{},update(){},end(){}}),run:async(_,fn)=>fn()},Blob,URL:{createObjectURL:b=>{blobs.push(b);return 'test';},revokeObjectURL(){}},setTimeout:()=>{}};
  vm.runInNewContext(fs.readFileSync(require.resolve('../js/statistics-ui'),'utf8'),env);
  const records=['a','b','c','d'].map(id=>({id,subject:id}));
  const allRows=records.flatMap((r,i)=>['A','B','C'].map((epoch,j)=>({subject:r.subject,epoch,value:[i+1,2*i+3,3*i+2][j],n_samples:3})));
  function ready(epochs=['A','B','C'],mode='summary',rows=allRows){
    const ctx={mode,dataset:{recordings:records},records,metric:'AWI',epoch:'A',o:{norm:'none',from:0,to:1},analysisInput:mode==='summary'?{epochs,rows:rows.filter(r=>epochs.includes(r.epoch))}:{items:records.map(r=>({r})),alignment:{time:[0,1],values:records.map((r,i)=>[i+1,i+2])}},exportRows:[],prepared:()=>[],setVisualIsolation(){},plot:(traces,options)=>plots.push({traces,options})};
    handlers['metrics-invalidated']({detail:{mode}});handlers['metrics-ready']({detail:ctx});return ctx;
  }
  return {get,ready,plots,blobs,allRows,handlers,media};
}
test('summary UI defaults to within-subject, displays omnibus/post-hoc and exports paired metadata',async()=>{
  const ui=setup();ui.ready();assert.equal(ui.get('design').value,'within');assert.equal(ui.get('groupEditor').hidden,true);assert.equal(ui.get('nullValue').disabled,true);
  await ui.get('runStats').onclick();assert.match(ui.get('statsStatus').textContent,/Completato/);assert.match(ui.get('statsResults').textContent,/misure ripetute/);assert.match(ui.get('statsResults').textContent,/max-/);
  assert.equal(ui.plots[0].options.categories.length,3);assert.equal(ui.plots.length,1);assert.equal(ui.plots[0].options.target,'statsGroupPlot');
  await ui.get('exportStats').onclick();const csv=await ui.blobs[0].text();assert.match(csv,/mean_difference/);assert.match(csv,/epoch_a/);assert.match(csv,/F a misure ripetute/);assert.match(csv,/max-/);
  ui.get('significantOnly').checked=true;ui.get('significantOnly').onchange();
  ui.ready(['A','B']);await ui.get('runStats').onclick();assert.match(ui.get('statsStatus').textContent,/Un solo confronto appaiato/);
  ui.ready(['A'],'series');assert.equal(ui.get('design').value,'one');await ui.get('runStats').onclick();assert.match(ui.get('statsStatus').textContent,/Completato/);
  ui.ready(['A','B']);assert.equal(ui.get('design').value,'within');
});
test('UI reports complete-case exclusions and clears stale results on invalidation',async()=>{
  const ui=setup();ui.ready(['A','B','C'],'summary',ui.allRows.filter(r=>!(r.subject==='d'&&r.epoch==='C')));
  await ui.get('runStats').onclick();assert.match(ui.get('statsStatus').textContent,/N=3/);assert.match(ui.get('statsStatus').textContent,/esclusi: d/);
  ui.handlers['metrics-invalidated']({detail:{mode:'summary'}});assert.equal(ui.get('exportStats').disabled,true);assert.equal(ui.get('statsResults').textContent,'');
  ui.ready(['A']);await ui.get('runStats').onclick();assert.match(ui.get('statsStatus').textContent,/due epoche/);
});

test('significant filter omits nonsignificant rows while media receives corrected full time grid',async()=>{
  const ui=setup();ui.get('significantOnly').checked=true;ui.ready(['A'],'series');await ui.get('runStats').onclick();
  const result=ui.media.at(-1);assert.equal(result.meta.view,'series');assert.equal(result.results.length,2);
  const significant=result.results.filter(r=>Number.isFinite(r.pAdjusted)&&r.pAdjusted<=.05);
  assert.deepEqual(ui.plots.at(-1).options.significancePoints.map(p=>p.time),result.results.map(p=>p.time));
  assert.deepEqual(ui.plots.at(-1).options.significancePoints.map(p=>p.pAdjusted),result.results.map(p=>p.pAdjusted));
  assert.equal(ui.get('statsResults').children[0].children[1].children.length,significant.length);
  ui.get('significantOnly').checked=false;ui.get('significantOnly').onchange();assert.equal(ui.get('statsResults').children[0].children[1].children.length,2);
  ui.handlers['metrics-invalidated']({detail:{mode:'series'}});assert.equal(ui.media.at(-1),null);
});
