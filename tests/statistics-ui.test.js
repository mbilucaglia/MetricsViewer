const {test}=require('node:test');
const assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
function setup(flagged = [], records = ['a','b','c','d'].map(id=>({id,subject:id})), engine){
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
  const calls = [];
  const run = engine ?? (async options => {
    const { subjects, times, mode, epochs, groupNames, permutations } = options;
    const permutation = require('../js/permutation');
    const software = { webR: '0.6.1', R: 'R test', permuco: 'test' };
    const summaries = (mode === 'multi' ? groupNames.map((_, i) => subjects.filter(s => s.groupIndex === i)) : [subjects])
      .map(group => times.map((time, index) => {
        const values = group.map(subject => subject.values[index]);
        return { time, mean: require('../js/core').mean(values), margin: analysis.ci95(values) };
      }));
    if (mode === 'within') {
      const { omnibus, comparisons } = await require('../js/repeated').run(options);
      const points = omnibus ? [{ ...omnibus, resamples: permutations + 1 }, ...comparisons] : comparisons;
      return { points, paired: comparisons, groups: summaries, resamples: 16, software };
    }
    const points = (await permutation.run(options)).map(point => ({ ...point, resamples: permutations + 1 }));
    const posthoc = groupNames.length ? (await permutation.runPairwise(options)).map(row => ({
      ...row, resamples: 24
    })) : [];
    return { points, posthoc, groups: summaries, resamples: permutations + 1, software };
  });
  const env={AbortController,sessionStorage:{getItem:()=>session,setItem:(_,value)=>{session=value;}},MetricsSignificantMedia:{show:(results,meta)=>media.push({results,meta}),clear:()=>media.push(null)},document,MetricsCore:require('../js/core'),MetricsAnalysis:analysis,MetricsIsolation:require('../js/isolation'),MetricsWebR:{run:options=>{calls.push(options);return run(options);}},MetricsBusy:{start:()=>({step:async()=>{},update(){},end(){}}),run:async(_,fn)=>fn()},Blob,URL:{createObjectURL:b=>{blobs.push(b);return 'test';},revokeObjectURL(){}},setTimeout:()=>{}};
  const sandbox=vm.createContext(env);
  for (const script of ['settings-dialog','statistics-ui']) vm.runInContext(fs.readFileSync(require.resolve('../js/'+script),'utf8'),sandbox);
  const allRows=records.flatMap((r,i)=>['A','B','C'].map((epoch,j)=>({subject:r.subject,epoch,value:[i+1,2*i+3,3*i+2][j],n_samples:3})));
  function ready(epochs=['A','B','C'],mode='summary',rows=allRows,selection=records){
    const ctx={mode,dataset:{recordings:records},records:selection,metric:'AWI',epoch:'A',o:{norm:'none',from:0,to:1},analysisInput:mode==='summary'?{epochs,rows:rows.filter(r=>epochs.includes(r.epoch))}:{items:records.map(r=>({r})),alignment:{time:[0,1],values:records.map((r,i)=>[i+1,i+2])}},exportRows:[],prepared:()=>[],setVisualIsolation(){},plot:(traces,options)=>plots.push({traces,options})};
    handlers['metrics-invalidated']({detail:{mode}});handlers['metrics-ready']({detail:ctx});return ctx;
  }
  return {get,ready,plots,blobs,allRows,handlers,media,calls,getSession:()=>session};
}
test('summary UI defaults to within-subject, displays omnibus/post-hoc and exports paired metadata',async()=>{
  const ui=setup();ui.ready();assert.equal(ui.get('design').value,'within');assert.equal(ui.get('groupEditor').hidden,true);assert.equal(ui.get('nullValue').disabled,true);
  await ui.get('runStats').onclick();assert.equal(ui.get('statsStatus').textContent,'');assert.match(ui.get('statsResults').textContent,/misure ripetute/);assert.match(ui.get('statsResults').textContent,/max-/);
  assert.equal(ui.get('significantOnly').checked, false);
  const [omnibus, paired, descriptives] = ui.get('statsResults').children;
  assert.match(omnibus.children[1].textContent, /gdl 1.*gdl 2.*η² parziale/);
  assert.match(paired.children[1].textContent, /IC 95% di Δ.*Cohen d_z/);
  assert.match(descriptives.children[1].textContent, /Media.*DS/);
  assert.deepEqual(paired.children[2].children.map(row => row.children[0].textContent), ['A − B', 'A − C', 'B − C']);
  assert.equal(ui.plots[0].options.categories.length,3);assert.equal(ui.plots.length,1);assert.equal(ui.plots[0].options.target,'statsGroupPlot');
  await ui.get('exportStats').onclick();const csv=await ui.blobs[0].text();assert.match(csv,/mean_difference/);assert.match(csv,/epoch_a/);assert.match(csv,/F a misure ripetute/);assert.match(csv,/max-/);
  assert.match(csv,/"webR \/ permuco","101","nessuna \(un test omnibus\)"/);
  assert.match(csv,/"webR \/ permuco","16","max-\|T\|"/);
  assert.deepEqual(ui.calls[0].epochs, ['A', 'B', 'C']);
  assert.match(csv, /contrast_ci_low/);
  assert.match(csv, /descriptives_json/);
  await ui.get('exportStatsInput').onclick();
  const input = await ui.blobs[1].text();
  assert.match(input, /"subject_index","subject_id","subject","group_index","group","sample_index","epoch","break_before","value"/);
  assert.match(input, /"1","a","a","1","Campione statistico","2","B","false","3"/);
  assert.equal(input.trim().split('\r\n').length, 13);
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
  const first = ui.get('statsResults').children[0];
  assert.equal(first.tagName === 'table' ? first.children[2].children.length : 0, significant.length);
  ui.get('significantOnly').checked=false;ui.get('significantOnly').onchange();assert.equal(ui.get('statsResults').children[0].children[2].children.length,2);
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
  assert.equal(ui.calls.length, 1);
  assert.equal(ui.calls[0].groupNames.join(', '), 'Gruppo 1, Gruppo 2');
  await ui.get('exportStats').onclick();
  const csv = await ui.blobs[0].text();
  assert.match(csv, /"webR \/ permuco","24","max-\|T\| congiunto: coppie × epoche"/);
  assert.match(csv, /"t gruppi indipendenti/);
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

test('unavailable webR leaves export disabled and permits retry', async () => {
  const ui = setup([], undefined, async () => { throw new Error('Impossibile caricare webR e permuco.'); });
  ui.ready(['A', 'B']);
  await ui.get('runStats').onclick();
  assert.match(ui.get('statsStatus').textContent, /Impossibile caricare webR/);
  assert.equal(ui.get('exportStats').disabled, true);
  assert.equal(ui.get('runStats').disabled, false);
  assert.equal(ui.get('exportStatsInput').disabled, true);
});

test('p-value thresholds apply on OK, update the report without recalculation, and reject invalid order', async () => {
  const ui = setup();
  ui.ready(['A', 'B']);
  await ui.get('runStats').onclick();
  const dialog = ui.get('statsSettingsDialog');
  ui.get('openStatsSettings').click();
  assert.equal(ui.get('pThresholdSingle').value, '0.05');
  assert.match(ui.get('pThresholdNonSignificant').textContent, /> 0,05/);
  ui.get('pThresholdTriple').value = '0.02';
  dialog.confirm.click();
  assert.equal(dialog.open, true);
  assert.equal(ui.get('pThresholdError').hidden, false);
  assert.equal(ui.getSession(), null);

  ui.get('pThresholdSingle').value = '0.2';
  ui.get('pThresholdDouble').value = '0.04';
  dialog.confirm.click();
  assert.equal(dialog.open, false);
  assert.equal(ui.calls.length, 1);
  assert.deepEqual(JSON.parse(ui.getSession()).pThresholds, { single: .2, double: .04, triple: .02 });
  assert.equal(ui.plots.at(-1).options.pThresholds.single, .2);
  assert.equal(ui.media.at(-1).meta.p_threshold_triple, .02);
  assert.match(ui.get('significantOnlyLabel').textContent, /≤ 0,2/);
  await ui.get('exportStats').onclick();
  assert.match(await ui.blobs[0].text(), /"p_threshold_single","p_threshold_double","p_threshold_triple"/);

  ui.get('openStatsSettings').click();
  ui.get('pThresholdSingle').value = '0.5';
  dialog.dismiss.click();
  assert.equal(ui.get('pThresholdSingle').value, '0.2');
  assert.equal(ui.plots.at(-1).options.pThresholds.single, .2);
});
