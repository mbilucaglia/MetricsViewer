(function(){
  'use strict';
  const C=MetricsCore,$=id=>document.getElementById(id),palette=['#514691','#248d92','#c17b40','#b55488','#608a4a','#537bc3','#986240','#877fa4'];
  let dataset=null,selected=new Set(),mode='series',exportRows=[],generation=0;
  let summaryEpochs=new Set(),knownEpochs=new Set(),revealIndividualTraces=null,restoreIndividualTraces=null,forcedIndividuals=false;
  const node=(tag,text,cls)=>{const n=document.createElement(tag);if(tag==='button')n.type='button';if(tag==='th')n.setAttribute('scope','col');if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const fmt=x=>C.finite(x)?Number(x.toPrecision(6)).toString():'—';
  function number(id,fallback){const v=$(id).value.trim();if(!v)return fallback;const n=Number(v);if(!Number.isFinite(n))throw new Error('Valore numerico non valido.');if(n<0)throw new Error('Tempi e intervalli devono essere non negativi.');return n;}
  const allEpochs=()=>[...new Set(dataset.recordings.flatMap(r=>r.epochs.map(e=>e.id)))];
  const allMetrics=()=>[...new Set(dataset.recordings.flatMap(r=>r.epochs.flatMap(e=>Object.keys(e.metrics))))];
  function options(id,values){const previous=$(id).value;$(id).replaceChildren(...values.map(v=>{const o=node('option',v);o.value=v;return o;}));if(values.includes(previous))$(id).value=previous;$(id).disabled=!values.length;}
  function filterEpochs(){
    for(const [search,select]of [['epochSearch','epoch'],['baselineSearch','baseline']]){
      const query=$(search).value.toLocaleLowerCase();for(const option of $(select).options)option.hidden=!option.textContent.toLocaleLowerCase().includes(query);
    }
    const query=$('summaryEpochSearch').value.toLocaleLowerCase();for(const row of $('epochChecks').children)row.hidden=!row.textContent.toLocaleLowerCase().includes(query);
    $('epochSelectionCount').textContent=`${summaryEpochs.size} epoche selezionate`;
  }
  function epochCheckboxes(){
    const epochs=dataset?allEpochs():[];summaryEpochs=new Set(epochs.filter(e=>summaryEpochs.has(e)||!knownEpochs.has(e)));knownEpochs=new Set(epochs);
    $('epochChecks').replaceChildren();for(const epoch of epochs){const label=node('label',undefined,'check-option'),check=node('input');check.type='checkbox';check.checked=summaryEpochs.has(epoch);check.setAttribute('aria-label',`Confronta epoca ${epoch}`);check.onchange=()=>{check.checked?summaryEpochs.add(epoch):summaryEpochs.delete(epoch);filterEpochs();render();};label.append(check,document.createTextNode(epoch));$('epochChecks').append(label);}filterEpochs();
  }
  function refresh(){
    options('metric',dataset?allMetrics():[]);options('epoch',dataset?allEpochs():[]);options('baseline',dataset?allEpochs():[]);
    epochCheckboxes();
    $('subjects').replaceChildren();
    for(const [i,r] of (dataset?.recordings||[]).entries()){
      const row=node('div',undefined,'subject-row'),label=node('label');row.dataset.recordingId=r.id;label.style.display='contents';const check=node('input');check.type='checkbox';check.checked=selected.has(r.id);check.setAttribute('aria-label',`Seleziona ${r.subject}`);
      check.onchange=()=>{check.checked?selected.add(r.id):selected.delete(r.id);render();};
      const text=node('span',r.subject);text.style.color=palette[i%palette.length];label.append(check,text);const remove=node('button','×');remove.title=`Rimuovi ${r.subject}`;remove.setAttribute('aria-label',remove.title);remove.onclick=()=>{dataset.recordings=dataset.recordings.filter(x=>x.id!==r.id);selected.delete(r.id);if(!dataset.recordings.length)dataset=null;refresh();};row.append(label,remove);$('subjects').append(row);
    }
    $('status').textContent=dataset?`${dataset.recordings.length} soggetti · ${allMetrics().length} metriche · ${allEpochs().length} epoche. I nuovi file vengono aggiunti al dataset.`:'Nessun file caricato.';
    return render();
  }
  async function load(files){
    const list=[...files];if(!list.length)return;
    const ticket=++generation;$('errors').textContent='';
    const job=MetricsBusy.start('Lettura metriche in corso…');
    try{
      const inputs=[];
      for(const [index,file]of list.entries()){
        await job.step(`Lettura metriche in corso: ${file.name}`,{value:index,max:list.length});
        if(ticket!==generation)return;
        if(!file.name.toLowerCase().endsWith('.json'))throw new Error(`${file.name}: scegliere un file JSON.`);
        const text=await file.text();
        await job.step(`Verifica delle metriche: ${file.name}`,{value:index,max:list.length});
        if(ticket!==generation)return;
        try{inputs.push(C.validate(JSON.parse(text)));}catch(e){throw new Error(`${file.name}: ${e.message}`);}
      }
      await job.step('Preparazione dei soggetti e delle epoche…',{value:list.length,max:list.length});
      if(ticket!==generation)return;
      const merged=C.merge(dataset?[dataset,...inputs]:inputs);
      await job.step('Preparazione dei grafici e degli outlier…');
      if(ticket!==generation)return;
      for(const d of inputs)for(const r of d.recordings)selected.add(r.id);dataset=merged;await refresh();
    }catch(e){if(ticket===generation)$('errors').textContent=e.message;}
    finally{job.end();}
  }
  function config(){
    const o={norm:$('normalization').value,baseline:$('baseline').value,baseFrom:number('baseFrom',-Infinity),baseTo:number('baseTo',Infinity),from:number('from',-Infinity),to:number('to',Infinity),maxGap:number('gap',null),step:number('step',null),scaled:$('madScale').value==='scaled'};
    if(o.from>o.to||o.baseFrom>o.baseTo)throw new Error('L’inizio dell’intervallo deve precedere la fine.');
    if(o.step!==null&&o.step<=0||o.maxGap!==null&&o.maxGap<=0)throw new Error('Passo griglia e lacuna massima devono essere positivi.');return o;
  }
  const normalizedDataset=C.createNormalizationCache();
  function prepared(records,epoch,metric,o,warnings){
    const normalized=normalizedDataset(dataset.recordings,metric,o);
    return records.flatMap(r=>{
      const s=r.epochs.find(e=>e.id===epoch)?.metrics[metric];
      if(!s?.time.length){warnings.push(`${r.subject} · ${epoch}: metrica assente o vuota.`);return [];}
      try{const result=normalized.get(r.id)?.get(epoch);if(result?.error)throw new Error(result.error);if(!result.series.values.some(C.finite))throw new Error('Nessun valore valido.');return [{r,...result}];}
      catch(e){warnings.push(`${r.subject} · ${epoch}: ${e.message}`);return [];}
    });
  }
  const svgNS='http://www.w3.org/2000/svg';
  function svgEl(tag,attrs={},text){const e=document.createElementNS(svgNS,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;return e;}
  const barPlots=new Map();
  function plot(traces,{categories=null,xLabel='Tempo dall’inizio dell’epoca [s]',hover=null,target='chart',title=null,bars=false}={}){
    const chart=$(target);
    if(bars&&categories)barPlots.set(target,{traces,options:{categories,xLabel,hover,target,title,bars}});
    const w=900,h=410,p={l:65,r:25,t:25,b:70};
    let xmin=Infinity,xmax=-Infinity,ymin=Infinity,ymax=-Infinity;
    for(const tr of traces)for(let i=0;i<tr.x.length;i++){if(!C.finite(tr.y[i]))continue;const d=tr.band?.[i]||0;xmin=Math.min(xmin,tr.x[i]);xmax=Math.max(xmax,tr.x[i]);ymin=Math.min(ymin,tr.y[i]-d);ymax=Math.max(ymax,tr.y[i]+d);}
    if(!Number.isFinite(ymin)){chart.append(node('p','Nessun valore disponibile nell’intervallo selezionato.','empty-state'));return;}
    if(categories){xmin=-0.5;xmax=categories.length-0.5;}else if(xmin===xmax){xmin-=.5;xmax+=.5;}
    if(bars){ymin=Math.min(0,ymin);ymax=Math.max(0,ymax);}
    const pad=(ymax-ymin)*.12||Math.max(Math.abs(ymax)*.1,1);ymin-=pad;ymax+=pad;
    if(bars&&categories&&$('summaryYScale').value==='custom'){
      const low=$('summaryYMin').value.trim(),high=$('summaryYMax').value.trim();
      if(!low||!high||!Number.isFinite(Number(low))||!Number.isFinite(Number(high))||Number(low)>=Number(high)){
        chart.append(node('p','Imposta minimo e massimo finiti, con minimo < massimo.','empty-state'));return;
      }
      ymin=Number(low);ymax=Number(high);
    }
    const X=x=>p.l+(x-xmin)/(xmax-xmin)*(w-p.l-p.r),Y=y=>h-p.b-(y-ymin)/(ymax-ymin)*(h-p.t-p.b);
    const svg=svgEl('svg',{viewBox:`0 0 ${w} ${h}`,role:traces.some(t=>t.swarm)?'group':'img','aria-label':title||$('chartTitle').textContent});
    for(let i=0;i<=5;i++){const y=ymin+(ymax-ymin)*i/5;svg.append(svgEl('line',{x1:p.l,x2:w-p.r,y1:Y(y),y2:Y(y),class:'grid-line'}),svgEl('text',{x:p.l-10,y:Y(y)+4,'text-anchor':'end'},fmt(y)));}
    const ticks=categories?categories.map((c,i)=>[i,c]):Array.from({length:6},(_,i)=>{const x=xmin+(xmax-xmin)*i/5;return[x,fmt(x)];});
    for(const[x,label]of ticks){const t=svgEl('text',{x:X(x),y:h-p.b+24,'text-anchor':'middle'},label.length>22?label.slice(0,20)+'…':label);t.append(svgEl('title',{},label));svg.append(t);}
    svg.append(svgEl('text',{x:w/2,y:h-12,'text-anchor':'middle'},xLabel));
    const clipId=`${target}-plot-clip`;const defs=svgEl('defs'),clip=svgEl('clipPath',{id:clipId});clip.append(svgEl('rect',{x:p.l,y:p.t,width:w-p.l-p.r,height:h-p.t-p.b}));defs.append(clip);svg.append(defs);
    const barTraces=traces.filter(tr=>!tr.subjectId),individualBars=traces.filter(tr=>tr.isolationOnly);
    if(bars&&ymin<=0&&ymax>=0)svg.append(svgEl('line',{x1:p.l,x2:w-p.r,y1:Y(0),y2:Y(0),stroke:'#8e87a8','stroke-width':1}));
    const swarmPositions=new Map();
    if(categories){
      for(let i=0;i<categories.length;i++){
        const points=traces.filter(t=>t.swarm&&C.finite(t.y[i])).map(t=>({t,y:Y(t.y[i])})).sort((a,b)=>a.y-b.y||a.t.name.localeCompare(b.t.name));
        const placed=[];
        for(const point of points){
          const candidates=[0];
          for(const q of placed){const dy=point.y-q.y;if(Math.abs(dy)<9){const dx=Math.sqrt(81-dy*dy);candidates.push(q.dx-dx,q.dx+dx);}}
          candidates.sort((a,b)=>Math.abs(a)-Math.abs(b)||a-b);
          point.dx=candidates.find(dx=>placed.every(q=>(dx-q.dx)**2+(point.y-q.y)**2>=81-1e-7))??0;placed.push(point);
        }
        const extent=Math.max(4,...placed.map(q=>Math.abs(q.dx)+4)),scale=Math.min(1,(X(1)-X(0))*.32/extent);
        for(const q of placed){if(!swarmPositions.has(q.t))swarmPositions.set(q.t,[]);swarmPositions.get(q.t)[i]={dx:q.dx*scale,r:4*scale};}
      }
    }
    for(const tr of traces){
      const traceLayer=svgEl('g',{'data-trace-subject':tr.subjectId||''});
      if(bars)traceLayer.setAttribute('clip-path',`url(#${clipId})`);
      if(tr.isolationOnly){traceLayer.dataset.isolationOnly='true';traceLayer.style.display='none';}
      svg.append(traceLayer);
      if(tr.swarm&&categories){
        for(let i=0;i<tr.x.length;i++){
          if(!C.finite(tr.y[i]))continue;
          const point=swarmPositions.get(tr)[i],label=`${tr.name} · ${categories[i]}: ${fmt(tr.y[i])}`;
          const circle=svgEl('circle',{cx:X(tr.x[i])+point.dx,cy:Y(tr.y[i]),r:point.r,fill:tr.color,stroke:'white','stroke-width':.6,tabindex:0,role:'button','aria-label':`Evidenzia ${label}`});
          circle.append(svgEl('title',{},label));circle.style.cursor='pointer';
          const select=()=>document.dispatchEvent(new CustomEvent('metrics-isolate-subject',{detail:{id:tr.subjectId}}));
          circle.addEventListener('click',select);circle.addEventListener('keydown',e=>{if(e.key==='Enter'||e.key===' '){e.preventDefault();select();}});traceLayer.append(circle);
        }
        continue;
      }
      if(bars&&categories){
        const peers=tr.isolationOnly?individualBars:barTraces,slot=peers.indexOf(tr),step=X(1)-X(0),width=Math.min(88,step*.7/Math.max(1,peers.length));
        for(let i=0;i<tr.x.length;i++){
          if(!C.finite(tr.y[i]))continue;
          const x=X(tr.x[i])+(slot-(peers.length-1)/2)*width,y=Y(tr.y[i]),half=tr.band?.[i],n=tr.n?.[i];
          const label=`${tr.name} · ${categories[i]}: ${fmt(tr.y[i])}${tr.band?(C.finite(half)?` · ${tr.bandLabel||'IC 95%'} [${fmt(tr.y[i]-half)}, ${fmt(tr.y[i]+half)}]`:` · ${tr.bandLabel||'IC 95%'} non disponibile (N < 2)`):''}${n!==undefined?` · N=${n}`:''}`;
          const bar=svgEl('rect',{x:x-width*.43,y:Math.min(Y(0),y),width:width*.86,height:Math.max(.8,Math.abs(y-Y(0))),fill:tr.color,opacity:tr.isolationOnly?.9:.78,rx:2});
          bar.append(svgEl('title',{},label));traceLayer.append(bar);
          if(C.finite(half)){
            const low=Y(tr.y[i]-half),high=Y(tr.y[i]+half),cap=Math.min(9,width*.3);
            const error=svgEl('path',{d:`M${x},${low}V${high} M${x-cap},${low}H${x+cap} M${x-cap},${high}H${x+cap}`,fill:'none',stroke:tr.color,'stroke-width':2});
            error.append(svgEl('title',{},label));traceLayer.append(error);
          }
        }
        continue;
      }
      if(tr.band && !categories){let run=[];const flush=()=>{if(run.length>1){const pts=run.map(i=>`${X(tr.x[i])},${Y(tr.y[i]+tr.band[i])}`).concat([...run].reverse().map(i=>`${X(tr.x[i])},${Y(tr.y[i]-tr.band[i])}`)).join(' ');traceLayer.append(svgEl('polygon',{points:pts,fill:tr.color,opacity:'.12'}));}run=[];};for(let i=0;i<tr.x.length;i++){if(C.finite(tr.y[i])&&C.finite(tr.band[i]))run.push(i);else flush();}flush();}
      if(!categories){let path='',open=false;for(let i=0;i<tr.x.length;i++){if(!C.finite(tr.y[i])){open=false;continue;}path+=`${open?'L':'M'}${X(tr.x[i])},${Y(tr.y[i])} `;open=true;}traceLayer.append(svgEl('path',{d:path,fill:'none',stroke:tr.color,'stroke-width':tr.bold?2.8:1.4,opacity:tr.bold?1:.7}));}
      if(categories||tr.x.length===1)for(let i=0;i<tr.x.length;i++){if(!C.finite(tr.y[i]))continue;const x=X(tr.x[i]),y=Y(tr.y[i]);if(tr.band&&C.finite(tr.band[i]))traceLayer.append(svgEl('line',{x1:x,x2:x,y1:Y(tr.y[i]-tr.band[i]),y2:Y(tr.y[i]+tr.band[i]),stroke:tr.color,'stroke-width':2}));const circle=svgEl('circle',{cx:x,cy:y,r:tr.bold?6:4,fill:tr.color,opacity:tr.bold?1:.65});circle.append(svgEl('title',{},`${tr.name}: ${fmt(tr.y[i])}`));traceLayer.append(circle);}
    }
    if(hover){svg.addEventListener('pointermove',event=>{const rect=svg.getBoundingClientRect(),x=xmin+((event.clientX-rect.left)/rect.width*w-p.l)/(w-p.l-p.r)*(xmax-xmin);$('tooltip').textContent=hover(x);$('tooltip').hidden=false;$('tooltip').style.left=Math.max(5,Math.min(event.clientX+12,window.innerWidth-320))+'px';$('tooltip').style.top=Math.max(5,Math.min(event.clientY+12,window.innerHeight-110))+'px';});svg.addEventListener('pointerleave',()=>{$('tooltip').hidden=true;});}
    chart.append(svg);const legend=node('div',undefined,'legend');for(const tr of traces){const span=node('span'),dot=node('i');span.dataset.traceSubject=tr.subjectId||'';if(tr.isolationOnly){span.dataset.isolationOnly='true';span.style.display='none';}dot.style.background=tr.color;span.append(dot,document.createTextNode(tr.name));legend.append(span);}chart.append(legend);
  }
  function table(headers,rows){const t=node('table'),head=node('thead'),tr=node('tr');headers.forEach(h=>tr.append(node('th',h)));head.append(tr);t.append(head);const body=node('tbody');rows.slice(0,500).forEach(row=>{const tr=node('tr');row.forEach(v=>tr.append(node('td',v)));body.append(tr);});t.append(body);$('results').append(t);if(rows.length>500)$('results').append(node('p','Anteprima: prime 500 righe. Il CSV contiene tutti i risultati.','panel-note'));}
  let visualIsolationIds=null;
  function setVisualIsolation(ids){
    visualIsolationIds=ids;
    if(ids?.length && mode==='series' && !$('individuals').checked){forcedIndividuals=true;$('individuals').checked=true;revealIndividualTraces?.();}
    if(!ids?.length && forcedIndividuals){forcedIndividuals=false;$('individuals').checked=false;restoreIndividualTraces?.();}
    const isolated=ids?.length?new Set(ids):null;
    for(const trace of $('chart').querySelectorAll('[data-trace-subject]')){
      const emphasized=isolated?.has(trace.dataset.traceSubject)||false;
      if(trace.dataset.isolationOnly)trace.style.display=emphasized?'':'none';
      trace.style.opacity=isolated?(emphasized?'1':'0.10'):'';
      trace.classList.toggle('is-isolated',emphasized);
    }
  }
  function render(){
    const metric=$('metric').value;
    const count=(dataset?.recordings||[]).reduce((sum,r)=>sum+r.epochs.reduce((n,e)=>n+(e.metrics[metric]?.values.length||0),0),0);
    if(count<20000 && (dataset?.recordings.length||0)<100)return renderNow();
    return MetricsBusy.run('Elaborazione delle metriche in corso…',async job=>{
      await job.step('Preparazione e normalizzazione di tutte le epoche…');
      normalizedDataset(dataset.recordings,metric,config());
      await job.step(mode==='series'?'Allineamento delle serie e preparazione dei grafici…':'Calcolo dei riepiloghi temporali e degli outlier…');
      renderNow();
    }).catch(error=>{$('errors').textContent=error.message;});
  }
  function renderNow(){
    document.dispatchEvent(new CustomEvent('metrics-invalidated',{detail:{mode}}));
    if(forcedIndividuals)$('individuals').checked=false;
    let analysisInput=null;revealIndividualTraces=null;restoreIndividualTraces=null;forcedIndividuals=false;
    $('errors').textContent='';$('chart').replaceChildren();$('results').replaceChildren();$('warnings').replaceChildren();$('chartNote').textContent='';$('tooltip').hidden=true;exportRows=[];$('export').disabled=true;
    const normalizing=$('normalization').value!=='none';for(const id of ['baseline','baseFrom','baseTo'])$(id).disabled=!normalizing||!dataset;$('madScale').disabled=$('normalization').value!=='zmad';
    $('seriesOptions').hidden=mode!=='series';$('summaryOptions').hidden=mode!=='summary';$('seriesTab').classList.toggle('is-active',mode==='series');$('summaryTab').classList.toggle('is-active',mode==='summary');$('seriesTab').setAttribute('aria-pressed',mode==='series');$('summaryTab').setAttribute('aria-pressed',mode==='summary');
    const records=(dataset?.recordings||[]).filter(r=>selected.has(r.id));$('counts').textContent=`${records.length} selezionati su ${dataset?.recordings.length||0}`;
    if(!records.length){$('chart').append(node('p',dataset?'Seleziona almeno un soggetto.':'Carica un dataset oppure prova l’esempio.','empty-state'));return;}
    const warnings=[];
    try{
      const o=config(),metric=$('metric').value,epoch=$('epoch').value,unit=o.norm==='percent'?' [%]':o.norm==='none'?'':` [${o.norm==='zscore'?'z-score':'z-MAD'}]`;
      $('chartTitle').textContent=`${metric}${unit} · ${mode==='series'?epoch:'riepilogo temporale'}`;
      const color=r=>palette[dataset.recordings.indexOf(r)%palette.length];
      const provenance={metric,normalization:o.norm,baseline:o.norm==='none'?'':o.baseline,baseline_from:Number.isFinite(o.baseFrom)?o.baseFrom:'',baseline_to:Number.isFinite(o.baseTo)?o.baseTo:'',mad_scale:o.scaled?1.4826:1,analysis_from:Number.isFinite(o.from)?o.from:'',analysis_to:Number.isFinite(o.to)?o.to:''};
      if(mode==='series'){
        const items=prepared(records,epoch,metric,o,warnings);if(!items.length)throw new Error('Nessuna serie utilizzabile con queste impostazioni.');
        const aligned=C.align(items.map(x=>x.series),{range:$('range').value,step:o.step,from:o.from,to:o.to,method:$('interpolation').value,maxGap:o.maxGap});
        analysisInput={items,alignment:aligned};
        const traces=[];if($('individuals').checked)items.forEach((x,i)=>traces.push({name:x.r.subject,subjectId:x.r.id,x:aligned.time,y:aligned.values[i],color:color(x.r)}));
        if($('average').checked)traces.push({name:'Media ± DS',x:aligned.time,y:aligned.summary.map(x=>x.mean),band:aligned.summary.map(x=>x.sd),color:'#312b79',bold:true});
        plot(traces,{hover:x=>{const i=Math.max(0,Math.min(aligned.time.length-1,Math.round((x-aligned.time[0])/aligned.step))),s=aligned.summary[i];return `Tempo: ${fmt(s.time)} s\nMedia: ${fmt(s.mean)} · DS: ${fmt(s.sd)}\nSoggetti disponibili: ${s.n}`;}});
        restoreIndividualTraces=()=>{$('chart').replaceChildren();plot(traces);};
        revealIndividualTraces=()=>{const individual=items.map((x,i)=>({name:x.r.subject,subjectId:x.r.id,x:aligned.time,y:aligned.values[i],color:color(x.r)}));const full=[...individual,...traces.filter(t=>!t.subjectId)];$('chart').replaceChildren();plot(full);};
        $('chartNote').textContent=`Passo: ${fmt(aligned.step)} s · ${aligned.time.length} istanti · ${items.length} soggetti utilizzabili. La banda indica ±1 DS. Modifica l’intervallo di analisi per ingrandire una porzione temporale.`;
        table(['Tempo [s]','Media','DS','N soggetti'],aligned.summary.map(s=>[fmt(s.time),fmt(s.mean),fmt(s.sd),s.n]));
        exportRows=aligned.summary.map((s,i)=>({...provenance,epoch,time:s.time,mean:s.mean,sd:s.sd,n:s.n,grid_step:aligned.step,range:$('range').value,interpolation:$('interpolation').value,max_gap:o.maxGap??'auto:3*native_median_step',downsample_filter:'boxcar',...Object.fromEntries(items.map((x,j)=>[`subject:${x.r.subject}`,aligned.values[j][i]]))}));
      }else{
        const epochs=allEpochs().filter(e=>summaryEpochs.has(e)),method=$('aggregation').value,rows=[],stats=[];
        if(!epochs.length)throw new Error('Seleziona almeno un’epoca da confrontare.');
        epochs.forEach(e=>{const items=prepared(records,e,metric,o,warnings);const values=[];for(const x of items){const a=C.aggregate(x.series,method,o.from,o.to,C.gapLimit(x.series,o.maxGap));if(a.value===null)warnings.push(`${x.r.subject} · ${e}: nessun riepilogo calcolabile nell’intervallo.`);else values.push(a.value);rows.push({...provenance,epoch:e,subject:x.r.subject,aggregation:method,value:a.value,n_samples:a.n,valid_duration_s:a.duration,baseline_n:x.stats?.n??'',baseline_center:x.stats?.center??'',baseline_scale:x.stats?.scale??'',max_gap:o.maxGap??'auto:3*native_median_step'});}stats.push({epoch:e,mean:C.mean(values),sd:C.sd(values),ci:MetricsAnalysis.ci95(values),n:values.length});});
        analysisInput={rows,epochs};
        const traces=records.map(r=>({name:r.subject,subjectId:r.id,swarm:true,isolationOnly:!$('individuals').checked,color:color(r),x:epochs.map((_,i)=>i),y:epochs.map(e=>rows.find(x=>x.subject===r.subject&&x.epoch===e)?.value??null)}));if($('average').checked)traces.unshift({name:'Media tra soggetti ± DS',bandLabel:'± DS',color:'#514691',bold:true,x:epochs.map((_,i)=>i),y:stats.map(s=>s.mean),band:stats.map(s=>s.sd),n:stats.map(s=>s.n)});
        plot(traces,{categories:epochs,xLabel:'Epoca / stimolo',bars:true});table(['Epoca','Media tra soggetti','DS tra soggetti','IC 95% inferiore','IC 95% superiore','N soggetti'],stats.map(s=>[s.epoch,fmt(s.mean),fmt(s.sd),fmt(C.finite(s.ci)?s.mean-s.ci:null),fmt(C.finite(s.ci)?s.mean+s.ci:null),s.n]));
        $('chartNote').textContent=`${$('aggregation').selectedOptions[0].textContent} sui campioni normalizzati. Barre: media ± DS tra soggetti; DS disponibile con almeno 2 soggetti. Valori individuali e di gruppo nel CSV.`;
        exportRows=[...rows.map(r=>({row_type:'subject',...r,group_mean:null,group_sd:null,group_ci95_lower:null,group_ci95_upper:null,group_n:null})),...stats.map(s=>({row_type:'group',...provenance,epoch:s.epoch,subject:'',aggregation:method,value:null,n_samples:null,valid_duration_s:null,baseline_n:'',baseline_center:'',baseline_scale:'',max_gap:o.maxGap??'auto:3*native_median_step',group_mean:s.mean,group_sd:s.sd,group_ci95_lower:C.finite(s.ci)?s.mean-s.ci:null,group_ci95_upper:C.finite(s.ci)?s.mean+s.ci:null,group_n:s.n}))];
      }
      $('export').disabled=!exportRows.length;
      document.dispatchEvent(new CustomEvent('metrics-ready',{detail:{mode,dataset,records,metric,epoch,o,analysisInput,exportRows,prepared,plot,render,setVisualIsolation}}));
    }catch(e){$('errors').textContent=e.message;}
    for(const message of [...new Set(warnings)])$('warnings').append(node('p',message));
  }
  function demo(){
    generation++;const recordings=Array.from({length:6},(_,i)=>({id:`demo-${i+1}`,subject:`SBJ_${String(i+1).padStart(2,'0')}`,epochs:['bslaperti','task1','task2'].map((id,e)=>{const dt=[.25,.5,.4][i%3],length=(e?24+i*4:16);const time=Array.from({length:Math.floor(length/dt)+1},(_,j)=>Number((j*dt).toFixed(6)));return {id,metrics:Object.fromEntries(['AWI','FMT','WL'].map((m,k)=>[m,{time,values:time.map(t=>2+k+i*.15+Math.sin(t*.7+i)*.45+(e?e*.7+Math.sin(t*.2)*.3:0))}]))};})}));
    dataset=C.validate({schema_version:1,time_unit:'s',recordings});selected=new Set(recordings.map(r=>r.id));refresh();$('epoch').value='task1';$('baseline').value='bslaperti';render();
  }
  function csvCell(v){let s=v===null||v===undefined?'':String(v);if(typeof v==='string'&&/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
  $('export').onclick=()=>{if(!exportRows.length)return;return MetricsBusy.run('Preparazione del file CSV…',async()=>{const headers=[...new Set(exportRows.flatMap(Object.keys))],csv='\uFEFF'+[headers,...exportRows.map(r=>headers.map(k=>r[k]))].map(r=>r.map(csvCell).join(',')).join('\r\n');const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=node('a');a.href=url;a.download=`metrics-${mode}.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}).catch(error=>{$('errors').textContent=error.message;});};
  $('files').onchange=e=>{load(e.target.files);e.target.value='';};$('demo').onclick=demo;$('clear').onclick=()=>{generation++;dataset=null;selected.clear();refresh();};
  for(const event of ['dragover','dragenter'])$('drop').addEventListener(event,e=>{e.preventDefault();$('drop').classList.add('is-dragging');});$('drop').ondragleave=()=>$('drop').classList.remove('is-dragging');$('drop').ondrop=e=>{e.preventDefault();$('drop').classList.remove('is-dragging');load(e.dataTransfer.files);};
  $('all').onclick=()=>{selected=new Set((dataset?.recordings||[]).map(r=>r.id));refresh();};$('none').onclick=()=>{selected.clear();refresh();};$('seriesTab').onclick=()=>{mode='series';render();};$('summaryTab').onclick=()=>{mode='summary';render();};
  function updateSummaryScale(){
    const custom=$('summaryYScale').value==='custom';
    $('summaryYMin').disabled=$('summaryYMax').disabled=!custom;
    const low=$('summaryYMin').value.trim(),high=$('summaryYMax').value.trim();
    const valid=!custom||(low!==''&&high!==''&&Number.isFinite(Number(low))&&Number.isFinite(Number(high))&&Number(low)<Number(high));
    $('summaryYError').textContent=valid?(custom?'Intervallo applicato ai grafici a barre. Valori e IC fuori scala sono ritagliati; i dati non cambiano.':''):'Inserisci minimo e massimo finiti, con minimo < massimo.';
    for(const id of ['summaryYMin','summaryYMax'])$(id).setAttribute('aria-invalid',String(!valid));
    if(!valid)return;
    for(const [target,saved]of barPlots){if(!$(target).children.length||(target==='chart'&&mode!=='summary'))continue;$(target).replaceChildren();plot(saved.traces,saved.options);}
    if(mode==='summary')setVisualIsolation(visualIsolationIds);

  }
  for(const id of ['summaryYScale','summaryYMin','summaryYMax'])$(id).onchange=updateSummaryScale;
  for(const id of ['metric' ,'epoch','normalization','baseline','baseFrom','baseTo','madScale','from','to','range','step','interpolation','gap','individuals','average','aggregation'])$(id).onchange=render;
  for(const id of ['epochSearch','baselineSearch','summaryEpochSearch'])$(id).oninput=filterEpochs;
  $('epochsAll').onclick=()=>{summaryEpochs=new Set(dataset?allEpochs():[]);epochCheckboxes();render();};
  $('epochsNone').onclick=()=>{summaryEpochs.clear();epochCheckboxes();render();};
  refresh();
})();
