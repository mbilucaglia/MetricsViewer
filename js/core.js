/* Pure numerical pipeline. Shared by the browser and Node's test runner. */
(function (root) {
  'use strict';
  const finite = x => typeof x === 'number' && Number.isFinite(x);
  const mean = a => a.length ? a.reduce((s, x) => s + x, 0) / a.length : null;
  const median = a => { if (!a.length) return null; const b = [...a].sort((x,y)=>x-y), i = b.length >> 1; return b.length % 2 ? b[i] : (b[i-1]+b[i])/2; };
  const sd = a => { const m = mean(a); return a.length > 1 ? Math.sqrt(a.reduce((s,x)=>s+(x-m)**2,0)/(a.length-1)) : null; };
  const assert = (ok, message) => { if (!ok) throw new Error(message); };
  const object = x => x !== null && typeof x === 'object' && !Array.isArray(x);
  const label = x => typeof x === 'string' && x.trim().length > 0;
  function validate(data) {
    assert(object(data) && data.schema_version === 1, 'Formato non supportato: schema_version deve essere 1.');
    assert(data.time_unit === 's', 'time_unit deve essere "s" (secondi dall’inizio dell’epoca).');
    assert(Array.isArray(data.recordings) && data.recordings.length, 'recordings deve essere un array non vuoto.');
    const ids = new Set(), subjects = new Set();
    for (const r of data.recordings) {
      assert(object(r) && label(r.id) && label(r.subject), 'Ogni registrazione richiede id e subject testuali.');
      assert(!ids.has(r.id), `Registrazione duplicata: ${r.id}.`); ids.add(r.id);
      assert(!subjects.has(r.subject), `Soggetto duplicato: ${r.subject}. Caricare una registrazione per soggetto per evitare conteggi multipli.`); subjects.add(r.subject);
      assert(Array.isArray(r.epochs) && r.epochs.length, `${r.subject}: epochs deve essere un array non vuoto.`);
      const epochs = new Set();
      for (const e of r.epochs) {
        assert(object(e) && label(e.id) && !epochs.has(e.id), `${r.subject}: identificativo epoca assente o duplicato.`); epochs.add(e.id);
        assert(object(e.metrics) && Object.keys(e.metrics).length, `${r.subject}/${e.id}: metriche mancanti.`);
        for (const [name, s] of Object.entries(e.metrics)) {
          const at = `${r.subject}/${e.id}/${name}`;
          assert(label(name) && object(s) && Array.isArray(s.time) && Array.isArray(s.values), `${at}: time e values devono essere array.`);
          assert(s.time.length === s.values.length, `${at}: time e values hanno lunghezze diverse.`);
          assert(s.time.every((t,i)=>finite(t) && t >= 0 && (!i || t > s.time[i-1])), `${at}: tempi non negativi, finiti e strettamente crescenti richiesti.`);
          assert(s.values.every(v=>v === null || finite(v)), `${at}: values deve contenere numeri finiti o null.`);
        }
      }
    }
    return data;
  }
  function merge(datasets) { return validate({schema_version:1, time_unit:'s', recordings:datasets.flatMap(d=>validate(d).recordings)}); }
  function cadence(s) { return median(s.time.slice(1).map((t,i)=>t-s.time[i])); }
  function gapLimit(s, limit) { return finite(limit) && limit > 0 ? limit : (cadence(s) || 0) * 3; }
  function within(s, from=-Infinity, to=Infinity) { return s.values.filter((v,i)=>finite(v) && s.time[i]>=from && s.time[i]<=to); }
  function normalizationStats(baseline, method='none', from=-Infinity, to=Infinity, scaled=true) {
    if (method === 'none') return null;
    assert(baseline, 'Baseline assente per questa metrica.');
    const b = within(baseline,from,to);
    assert(b.length, 'Nessun campione valido nella baseline selezionata.');
    let center, scale;
    if (method === 'zscore') { center=mean(b); scale=sd(b); }
    else if (method === 'zmad') { center=median(b); scale=median(b.map(x=>Math.abs(x-center))) * (scaled ? 1.4826 : 1); }
    else if (method === 'percent') { center=mean(b); scale=center/100; }
    else throw new Error('Normalizzazione sconosciuta.');
    assert(finite(scale) && scale !== 0, 'Baseline non utilizzabile: denominatore nullo o campioni insufficienti.');
    return {n:b.length,center,scale};
  }
  function applyNormalization(series,stats){
    const values=stats?series.values.map(x=>finite(x)?(x-stats.center)/stats.scale:null):[...series.values];
    assert(values.every(v=>v===null || finite(v)), 'Normalizzazione fuori intervallo numerico.');
    return {series:{time:series.time,values},stats};
  }
  function normalize(series,baseline,method='none',from=-Infinity,to=Infinity,scaled=true){
    return applyNormalization(series,normalizationStats(baseline,method,from,to,scaled));
  }
  function normalizeAllEpochs(records,metric,{norm='none',baseline,baseFrom=-Infinity,baseTo=Infinity,scaled=true}={}){
    const normalized=new Map();
    for(const r of records){
      const epochs=new Map();normalized.set(r.id,epochs);
      let stats=null,baselineError=null;
      try{stats=normalizationStats(r.epochs.find(e=>e.id===baseline)?.metrics[metric],norm,baseFrom,baseTo,scaled);}
      catch(error){baselineError=error.message;}
      for(const e of r.epochs){
        const series=e.metrics[metric];if(!series)continue;
        if(baselineError){epochs.set(e.id,{error:baselineError});continue;}
        try{epochs.set(e.id,applyNormalization(series,stats));}
        catch(error){epochs.set(e.id,{error:error.message});}
      }
    }
    return normalized;
  }
  function createNormalizationCache(){
    let previousRecords=null,previousKey=null,previousResult=null;
    return (records,metric,options)=>{
      const key=JSON.stringify([metric,options.norm,options.baseline,options.baseFrom,options.baseTo,options.scaled]);
      if(records!==previousRecords||key!==previousKey){previousResult=normalizeAllEpochs(records,metric,options);previousRecords=records;previousKey=key;}
      return previousResult;
    };
  }
  function at(s,t,method='linear',gap=Infinity) {
    const ts=s.time, ys=s.values, n=ts.length;
    if (!n || t < ts[0]-1e-10 || t > ts[n-1]+1e-10) return null;
    let lo=0,hi=n-1;
    while(lo<hi){const mid=(lo+hi)>>1;if(ts[mid]<t)lo=mid+1;else hi=mid;}
    if (Math.abs(ts[lo]-t)<1e-10) return finite(ys[lo]) ? ys[lo] : null;
    const a=lo-1,b=lo;
    if(a<0 || !finite(ys[a]) || !finite(ys[b]) || ts[b]-ts[a]>gap) return null;
    if(method==='nearest')return t-ts[a]<=ts[b]-t ? ys[a] : ys[b];
    return ys[a]+(ys[b]-ys[a])*(t-ts[a])/(ts[b]-ts[a]);
  }
  // Integral of valid piecewise-linear segments, never spanning nulls or long gaps.
  function integral(s,from,to,gap=Infinity) {
    let area=0,duration=0;
    for(let i=1;i<s.time.length;i++){
      const a=s.time[i-1],b=s.time[i],y=s.values[i-1],z=s.values[i];
      if(!finite(y)||!finite(z)||b-a>gap)continue;
      const l=Math.max(a,from),r=Math.min(b,to);if(r<=l)continue;
      const yl=y+(z-y)*(l-a)/(b-a),yr=y+(z-y)*(r-a)/(b-a);
      area+=(yl+yr)/2*(r-l);duration+=r-l;
    }
    return {area,duration};
  }
  function aggregate(s,method='mean',from=-Infinity,to=Infinity,gap=Infinity) {
    const v=within(s,from,to); let value=null, duration=null;
    if(method==='weighted'){const a=integral(s,from,to,gap);duration=a.duration;value=duration ? a.area/duration : null;}
    else if(method==='mean')value=mean(v);
    else if(method==='median')value=median(v);
    else if(method==='sd')value=sd(v);
    else if(method==='min')value=v.length ? v.reduce((a,b)=>Math.min(a,b)) : null;
    else if(method==='max')value=v.length ? v.reduce((a,b)=>Math.max(a,b)) : null;
    else throw new Error('Aggregazione sconosciuta.');
    return {value,n:v.length,duration};
  }
  function resample(s,grid,{step,method='linear',maxGap=null,antialias=true}={}) {
    const gap=gapLimit(s,maxGap),dt=cadence(s);
    // Prefix integrals avoid rescanning the native series for each grid point.
    const area=[0],duration=[0];
    const filtering=antialias && dt && step>dt*(1+1e-8);
    const validSegment=i=>finite(s.values[i-1])&&finite(s.values[i])&&s.time[i]-s.time[i-1]<=gap;
    if(filtering)for(let i=1;i<s.time.length;i++){
      const d=s.time[i]-s.time[i-1],valid=validSegment(i);
      area[i]=area[i-1]+(valid?(s.values[i-1]+s.values[i])/2*d:0);
      duration[i]=duration[i-1]+(valid?d:0);
    }
    function cumulative(t){
      let lo=0,hi=s.time.length-1;
      while(lo<hi){const mid=Math.ceil((lo+hi)/2);if(s.time[mid]<=t)lo=mid;else hi=mid-1;}
      let a=area[lo],d=duration[lo];
      if(lo+1<s.time.length&&validSegment(lo+1)){
        const width=t-s.time[lo],y=s.values[lo],z=y+(s.values[lo+1]-y)*width/(s.time[lo+1]-s.time[lo]);
        a+=(y+z)/2*width;d+=width;
      }
      return {area:a,duration:d};
    }
    return grid.map(t=>{
      const value=at(s,t,method,gap);
      if(value===null || !filtering)return value;
      // Boxcar low-pass of width target step, integrated on native timestamps.
      const l=Math.max(s.time[0],t-step/2),r=Math.min(s.time.at(-1),t+step/2);
      const left=cumulative(l),right=cumulative(r),a={area:right.area-left.area,duration:right.duration-left.duration};
      return r>l && Math.abs(a.duration-(r-l))<1e-8*Math.max(1,r-l) ? a.area/a.duration : null;
    });
  }
  function align(series,{range='intersection',step=null,from=-Infinity,to=Infinity,...options}={}) {
    assert(series.length,'Nessuna serie da allineare.');
    assert(series.every(s=>s.time.length),'Una serie è vuota.');
    const starts=series.map(s=>s.time[0]),ends=series.map(s=>s.time.at(-1));
    const start=Math.max(from,range==='intersection'?Math.max(...starts):Math.min(...starts));
    const end=Math.min(to,range==='intersection'?Math.min(...ends):Math.max(...ends));
    const dts=series.map(cadence).filter(x=>x>0);
    const dt=step ?? (dts.length?Math.max(...dts):1);
    assert(finite(dt)&&dt>0,'Il passo temporale deve essere positivo.');
    assert(end>=start,'Nessun intervallo temporale comune.');
    // Grid anchored to epoch zero; never shift individual subjects' first sample to zero.
    const first=Math.ceil((start-1e-10)/dt),last=Math.floor((end+1e-10)/dt),count=last-first+1;
    assert(count>0,'Nessun istante sulla griglia: ridurre il passo temporale.');
    assert(count<=50000 && count*series.length<=2000000,'Griglia troppo grande: aumentare il passo temporale.');
    const time=Array.from({length:count},(_,i)=>(first+i)*dt);
    const values=series.map(s=>resample(s,time,{step:dt,...options}));
    const summary=time.map((t,i)=>{const v=values.map(a=>a[i]).filter(finite);return {time:t,mean:mean(v),sd:sd(v),n:v.length};});
    return {time,values,summary,step:dt};
  }
  const api={finite,mean,median,sd,validate,merge,cadence,gapLimit,within,normalize,normalizationStats,normalizeAllEpochs,createNormalizationCache,at,integral,aggregate,resample,align};
  if(typeof module!=='undefined' && module.exports)module.exports=api;else root.MetricsCore=api;
})(typeof globalThis!=='undefined'?globalThis:this);
