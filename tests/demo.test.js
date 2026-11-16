const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const C=require('../js/core');
function demo(env={}){vm.runInNewContext(fs.readFileSync(require.resolve('../js/demo-data'),'utf8'),env);return env.MetricsDemo;}
test('offline demo matches the JSON and returns fresh datasets',()=>{
  const api=demo(),original=JSON.parse(fs.readFileSync(require.resolve('../metrics_demo_2_stimoli.json'),'utf8'));
  assert.deepEqual(JSON.parse(JSON.stringify(api.createDataset())),original);
  const d=C.validate(api.createDataset());assert.equal(d.recordings.length,35);
  d.recordings.pop();assert.equal(api.createDataset().recordings.length,35);
  for(const e of original.recordings[0].epochs){assert.equal(Object.keys(e.metrics).length,10);assert.ok(e.metrics.AWI.time.at(-1)<=original.demo_info.videos[e.id].duration_s);}
});
test('demo button loads real records, resets filters, binds local videos and can be reloaded',async()=>{
  class Element{
    constructor(tag='div'){this.tagName=tag;this.children=[];this.value='';this.dataset={};this.style={setProperty(){}};this.classList={toggle(){},add(){},remove(){}};this.checked=false;}
    append(...c){this.children.push(...c);}
    replaceChildren(...c){this.children=[];this.append(...c);}
    get textContent(){return (this.text||'')+this.children.map(c=>c.textContent||'').join('');}
    set textContent(value){this.text=String(value);}
    setAttribute(){}addEventListener(){}querySelectorAll(){return [];}
    querySelector(){return this.confirm??=new Element();}
    showModal(){this.open=true;}
    close(){this.open=false;}
    get options(){return this.children;}
    get selectedOptions(){return [{textContent:this.value}];}
    click(){this.onclick?.();}
  }
  const nodes=new Map(),get=id=>{if(!nodes.has(id))nodes.set(id,new Element());return nodes.get(id);};
  for(const [id,value]of Object.entries({normalization:'none',madScale:'scaled',range:'intersection',interpolation:'linear',aggregation:'mean'}))get(id).value=value;
  let ready=null,bindings=null,viewClicks=0,invalidations=0,anchors=[];get('viewTab').onclick=()=>viewClicks++;
  const env={MetricsCore:C,MetricsAnalysis:require('../js/analysis'),URL,document:{baseURI:'file:///C:/Metrics%20Viewer/index.html',getElementById:get,createElement:t=>new Element(t),createElementNS:(_,t)=>new Element(t),createTextNode:text=>({textContent:text}),dispatchEvent:e=>{if(e.type==='metrics-ready')ready=e.detail;if(e.type==='metrics-invalidated')invalidations++;if(e.type==='metrics-markers-rendered')anchors=e.detail.anchors;}},CustomEvent:class{constructor(type,options){this.type=type;this.detail=options.detail;}},MetricsBusy:{run:async(_,fn)=>fn({step:async()=>{}})},MetricsVideo:{replaceAssignments:items=>bindings=items,setContext(){},attach(){}}};
  env.window=env;
  env.Event = Event;
  demo(env);
  const sandbox=vm.createContext(env);
  for (const script of ['settings-dialog', 'chart', 'app']) {
    vm.runInContext(fs.readFileSync(require.resolve('../js/' + script), 'utf8'), sandbox);
  }
  assert.equal(get('workspace').hidden, true);
  assert.equal(get('clear').hidden, true);
  get('normalization').value='zscore';get('from').value='999';get('to').value='1000';get('gap').value='1';
  await get('demo').onclick();
  assert.equal(get('workspace').hidden, false);
  assert.equal(get('baselineEpochControl').hidden, true);
  assert.equal(get('fileLabel').textContent, 'Aggiungi file JSON');
  assert.equal(get('errors').textContent,'');assert.equal(ready.dataset.recordings.length,35);assert.equal(ready.records.length,35);assert.equal(ready.metric,'AWI');assert.equal(ready.epoch,'stim_arancia_');
  assert.equal(get('normalization').value,'none');assert.equal(get('from').value,'');assert.equal(get('gap').value,'');assert.equal(viewClicks,1);
  assert.equal(get('baseline').value,'baseline');assert.equal(bindings.find(v=>v.epoch==='baseline').url,'file:///C:/Metrics%20Viewer/video_demo_baseline.mp4');assert.equal(bindings.length,3);assert.equal(bindings[0].url,'file:///C:/Metrics%20Viewer/video_demo_stim_arancia.mp4');
  get('subjects').children[0].children[1].onclick();assert.equal(ready.dataset.recordings.length,34);
  await get('demo').onclick();assert.equal(ready.dataset.recordings.length,35);
  const originalContext=ready,originalInvalidations=invalidations,aligned=ready.analysisInput.alignment;
  ready.markMoments([{peak:aligned.time[0],value:aligned.summary[0].mean,label:'Maximum'}],{name:'Mean',x:aligned.time,y:aligned.summary.map(s=>s.mean),color:'#000'},()=>{});
  assert.equal(anchors.length,1);
  for(const [individuals,average] of [[false,true],[true,false],[false,false],[true,true]]){
    const previous=anchors[0];get('individuals').checked=individuals;get('average').checked=average;
    await get('individuals').onchange();await get('average').onchange();
    assert.equal(anchors.length,1);assert.notEqual(anchors[0],previous);assert.equal(ready,originalContext);assert.equal(invalidations,originalInvalidations);
  }
  get('normalization').value='zscore';await get('normalization').onchange();
  assert.equal(get('baselineEpochControl').hidden, false);
  assert.ok(invalidations>originalInvalidations);assert.equal(anchors.length,0);
  get('openTemporalSettings').onclick();
  get('from').value = '10';
  get('to').value = '4';
  const temporal = get('temporalSettingsDialog');
  temporal.confirm.click();
  assert.equal(temporal.open, true);
  assert.match(get('temporalSettingsError').textContent, /intervallo/);
  assert.equal(ready.o.from, -Infinity);
  get('to').value = '14';
  temporal.confirm.click();
  assert.equal(temporal.open, false);
  assert.equal(ready.o.from, 10);
  assert.equal(ready.o.to, 14);

  get('files').focus = () => {};
  get('clear').onclick();
  assert.equal(get('workspace').hidden, true);
  assert.equal(get('fileLabel').textContent, 'Scegli file JSON');

});


test('demo includes usable baseline and genuine 60 Hz grids for every subject and epoch',()=>{
  const data=demo().createDataset();
  for(const recording of data.recordings){
    const baseline=recording.epochs.find(e=>e.id==='baseline');assert.ok(baseline);
    for(const epoch of recording.epochs){
      const duration=data.demo_info.videos[epoch.id].duration_s;
      for(const [name,series] of Object.entries(epoch.metrics)){
        assert.equal(series.time.at(-1),duration);
        const rate=name.endsWith('_60Hz')?60:2;
        assert.equal(series.time.length,duration*rate);assert.equal(series.values.length,series.time.length);
        for(let i=1;i<series.time.length;i++)assert.ok(Math.abs(series.time[i]-series.time[i-1]-1/rate)<1e-8);
        for(const method of ['zscore','zmad','percent'])assert.ok(Number.isFinite(C.normalizationStats(baseline.metrics[name],method).scale));
      }
    }
  }
});
