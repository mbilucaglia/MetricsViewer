const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(flagged = [], records = ['a','b','c','d'].map(id=>({id,subject:id}))){
  class Element{
    constructor(tag='div'){this.tagName=tag;this.children=[];this.dataset={};this.style={};this.value='';this.text='';this.classList={toggle(){}};this.handlers={};}
    append(...children){this.children.push(...children);for(const c of children)c.parentElement=this;}
    replaceChildren(...children){this.children=[];this.append(...children);}
    setAttribute(){} addEventListener(name,handler){this.handlers[name]=handler;} click(){this.onclick?.();} remove(){} focus(){}
    showModal(){this.open=true;} close(){this.open=false;this.handlers.close?.();}
    get textContent(){return this.text+this.children.map(c=>c.textContent).join(' ');}set textContent(v){this.text=String(v);}
    get selectedOptions(){return [{textContent:this.value}];}
    querySelectorAll(selector){return selector==='[data-dismiss]'?[this.dismiss??=new Element('button')]:[];}
    querySelector(selector){return selector==='[data-confirm]'?(this.confirm??=new Element('button')):(this.option??=new Element('option'));}
  }
  const nodes=new Map(),get=id=>{if(!nodes.has(id)){const e=new Element();e.parentElement=new Element();nodes.set(id,e);}return nodes.get(id);};
  const handlers={},plots=[],blobs=[],media=[];
  const document={getElementById:get,createElement:t=>new Element(t),addEventListener:(name,fn)=>handlers[name]=fn};
  for(const[id,value]of Object.entries({design:'one',nullValue:'0',permutations:'100',seed:'42',aggregation:'mean',normalization:'none',range:'intersection',interpolation:'linear',outlierSummary:'none',outlierSeries:'none'}))get(id).value=value;
  const analysis = { ...require('../js/analysis') };
  if (flagged.length) analysis.summaryFlags = () => new Map(flagged.map(id => [id, { status: 'flagged' }]));
  let session = null;
  const env={sessionStorage:{getItem:()=>session,setItem:(_,value)=>{session=value;}},MetricsSignificantMedia:{show:(results,meta)=>media.push({results,meta}),clear:()=>media.push(null)},document,MetricsCore:require('../js/core'),MetricsAnalysis:analysis,MetricsIsolation:require('../js/isolation'),MetricsRepeated:require('../js/repeated'),TimeSeriesPermutation:require('../js/permutation'),MetricsBusy:{start:()=>({step:async()=>{},update(){},end(){}}),run:async(_,fn)=>fn()},Blob,URL:{createObjectURL:b=>{blobs.push(b);return 'test';},revokeObjectURL(){}},setTimeout:()=>{}};
  const sandbox=vm.createContext(env);
  for (const script of ['settings-dialog','statistics-ui']) vm.runInContext(fs.readFileSync(require.resolve('../js/'+script),'utf8'),sandbox);
  const allRows=records.flatMap((r,i)=>['A','B','C'].map((epoch,j)=>({subject:r.subject,epoch,value:[i+1,2*i+3,3*i+2][j],n_samples:3})));
  function ready(epochs=['A','B','C'],mode='summary',rows=allRows,selection=records){
    const ctx={mode,dataset:{recordings:records},records:selection,metric:'AWI',epoch:'A',o:{norm:'none',from:0,to:1},analysisInput:mode==='summary'?{epochs,rows:rows.filter(r=>epochs.includes(r.epoch))}:{items:records.map(r=>({r})),alignment:{time:[0,1],values:records.map((r,i)=>[i+1,i+2])}},exportRows:[],prepared:()=>[],setVisualIsolation(){},plot:(traces,options)=>plots.push({traces,options})};
    handlers['metrics-invalidated']({detail:{mode}});handlers['metrics-ready']({detail:ctx});return ctx;
  }
  return {get,ready,plots,blobs,allRows,handlers,media,getSession:()=>session};
}
test('summary UI defaults to within-subject, displays omnibus/post-hoc and exports paired metadata',async()=>{
  const ui=setup();ui.ready();assert.equal(ui.get('design').value,'within');assert.equal(ui.get('groupEditor').hidden,true);assert.equal(ui.get('nullValue').disabled,true);
  await ui.get('runStats').onclick();assert.equal(ui.get('statsStatus').textContent,'');assert.match(ui.get('statsResults').textContent,/misure ripetute/);assert.match(ui.get('statsResults').textContent,/max-/);
  assert.equal(ui.get('significantOnly').checked, false);
  const rows = ui.get('statsResults').children[0].children[1].children;
  assert.deepEqual(rows.slice(1).map(row => row.children[0].textContent), ['A − B', 'A − C', 'B − C']);
  assert.equal(ui.plots[0].options.categories.length,3);assert.equal(ui.plots.length,1);assert.equal(ui.plots[0].options.target,'statsGroupPlot');
  await ui.get('exportStats').onclick();const csv=await ui.blobs[0].text();assert.match(csv,/mean_difference/);assert.match(csv,/epoch_a/);assert.match(csv,/F a misure ripetute/);assert.match(csv,/max-/);
  ui.get('significantOnly').checked=true;ui.get('significantOnly').onchange();
  ui.ready(['A','B']);await ui.get('runStats').onclick();assert.equal(ui.get('statsStatus').textContent,'');
  ui.ready(['A'],'series');assert.equal(ui.get('design').value,'one');await ui.get('runStats').onclick();assert.equal(ui.get('statsStatus').textContent,'');
  ui.ready(['A','B']);assert.equal(ui.get('design').value,'within');
});
test('UI reports complete-case exclusions and clears stale results on invalidation',async()=>{
  const ui=setup();ui.ready(['A','B','C'],'summary',ui.allRows.filter(r=>!(r.subject==='d'&&r.epoch==='C')));
  await ui.get('runStats').onclick();assert.equal(ui.get('statsStatus').textContent,'');assert.equal(ui.media.at(-1).results[0].n,3);assert.equal(ui.media.at(-1).meta.excluded_subjects,'d');
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

test('statistical exclusions persist across views and preserve the loaded sample', async () => {
  const ui = setup();
  const ctx = ui.ready();
  const checkbox = ui.get('statsSampleList').children[3].children[0];
  checkbox.checked = true;
  checkbox.onchange();
  await ui.get('runStats').onclick();
  assert.equal(ui.media.at(-1).results[0].n, 3);
  assert.equal(ui.media.at(-1).meta.manually_excluded_subjects, 'd');
  assert.equal(ctx.records.length, 4);

  ui.ready(['A', 'B']);
  assert.equal(ui.get('statsSampleList').children[3].children[0].checked, true);
  ui.get('includeAllStats').onclick();
  await ui.get('runStats').onclick();
  assert.equal(ui.media.at(-1).results[0].n, 4);
});

test('outliers are flagged separately from sample exclusions', () => {
  const ui = setup(['d']);
  const { records } = ui.ready();
  const flaggedRow = () => ui.get('statsSampleList').children[3];
  assert.match(flaggedRow().className, /outlier-flagged/);
  assert.equal(flaggedRow().children[0].checked, false);

  ui.ready(['A', 'B'], 'summary', ui.allRows, records.slice(0, 3));
  assert.match(flaggedRow().className, /outlier-flagged/);
  assert.equal(flaggedRow().children[0].checked, true);
  assert.equal(flaggedRow().children[0].disabled, true);
});

test('group choices made in sample rows feed the analysis and survive exclusions', async () => {
  const ui = setup();
  ui.ready(['A', 'B']);
  const rows = () => ui.get('statsSampleList').children;

  ui.get('design').value = 'multi';
  ui.get('design').onchange();
  for (const index of [1, 3]) {
    const group = rows()[index].children[1];
    group.value = 'g2';
    group.onchange();
  }

  const exclusion = rows()[3].children[0].children[0];
  exclusion.checked = true;
  exclusion.onchange();
  assert.equal(rows()[3].children[1].value, 'g2');
  ui.get('includeAllStats').onclick();
  await ui.get('runStats').onclick();
  assert.equal(ui.media.at(-1).meta.group_assignments, 'a:Gruppo 1; b:Gruppo 2; c:Gruppo 1; d:Gruppo 2');
});

test('sample search mixes inclusive ranges, single numbers and names', () => {
  const records = ['02','03','04','07','08','09','12','103','112'].map(number => ({
    id: 'demo_' + number, subject: 'DEMO_' + number
  }));
  records.push({id: 'demo_06', subject: 'Rossi'}, {id: 'extra', subject: 'Verdi'});
  const ui = setup([], records);
  ui.ready();
  const search = ui.get('statsSampleSearch');
  const list = ui.get('statsSampleList');
  function searchNames(value) {
    search.value = value;
    search.handlers.input();
    return list.children.map(label => label.children[1].textContent);
  }

  assert.deepEqual(searchNames('03-08, 12'), ['DEMO_03','DEMO_04','DEMO_07','DEMO_08','DEMO_12','Rossi']);
  assert.deepEqual(searchNames('08 – 07, verdi, 08'), ['DEMO_07','DEMO_08','Verdi']);
});

test('filtered group assignments and renames only take effect on confirmation', async () => {
  const ui = setup();
  ui.ready(['A','B']);
  await ui.get('runStats').onclick();
  const dialog = ui.get('statsSettingsDialog');
  const search = ui.get('statsSampleSearch');
  const refilter = text => { search.value = text; search.handlers.input(); };
  const edit = () => {
    ui.get('openStatsSettings').click();
    ui.get('design').value = 'multi';
    ui.get('design').onchange();
    const input = ui.get('groupNames').children[1].children[0].children[0];
    input.value = 'Controllo';
    input.onchange();
    const list = ui.get('statsSampleList');
    refilter(' , ');
    assert.equal(list.children.length, 4);
    assert.equal(ui.get('statsGroupQuickAssign').hidden, true);
    refilter('D, b, , D, sconosciuto');
    assert.deepEqual(list.children.map(row => row.children[0].children[1].textContent), ['b', 'd']);
    const buttons = ui.get('statsGroupQuickButtons');
    assert.equal(buttons.children[1].textContent, 'Controllo');
    buttons.children[1].click();
    assert.deepEqual(list.children.map(row => row.children[1].value), ['g2', 'g2']);
  };
  edit();
  assert.equal(ui.getSession(), null);
  assert.equal(ui.get('exportStats').disabled, false);
  dialog.dismiss.click();
  assert.equal(ui.get('design').value, 'within');
  assert.equal(ui.get('exportStats').disabled, false);
  edit();
  dialog.confirm.click();
  assert.equal(ui.get('exportStats').disabled, true);
  const saved = JSON.parse(ui.getSession());
  assert.equal(saved.groups[1].name, 'Controllo');
  assert.deepEqual(saved.assignments, [['b','g2'],['d','g2']]);
});
