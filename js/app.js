(function(){
  'use strict';
  const C=MetricsCore,$=id=>document.getElementById(id),palette=['#514691','#248d92','#c17b40','#b55488','#608a4a','#537bc3','#986240','#877fa4'];
  let dataset=null,selected=new Set(),mode='series',exportRows=[],generation=0;
  let viewExportRows=[],viewSummaries=[];
  let importedFiles = [];
  let summaryEpochs=new Set(),knownEpochs=new Set(),revealIndividualTraces=null,restoreIndividualTraces=null,forcedIndividuals=false;
  const node=(tag,text,cls)=>{const n=document.createElement(tag);if(tag==='button')n.type='button';if(tag==='th')n.setAttribute('scope','col');if(text!==undefined)n.textContent=text;if(cls)n.className=cls;return n;};
  const fmt=x=>C.finite(x)?Number(x.toPrecision(6)).toString():'—';
  const temporalIds = ['baseFrom','baseTo','madScale','from','to','range','step','interpolation','gap'];
  const readTemporal = () => Object.fromEntries(temporalIds.map(id => [id, $(id).value]));
  let temporal = readTemporal();
  function number(values,id,fallback){const v=values[id].trim();if(!v)return fallback;const n=Number(v);if(!Number.isFinite(n))throw new Error('Valore numerico non valido.');if(n<0)throw new Error('Tempi e intervalli devono essere non negativi.');return n;}
  const allEpochs=()=>[...new Set(dataset.recordings.flatMap(r=>r.epochs.map(e=>e.id)))];
  const allMetrics=()=>[...new Set(dataset.recordings.flatMap(r=>r.epochs.flatMap(e=>Object.keys(e.metrics))))];
  function options(id,values){const previous=$(id).value;$(id).replaceChildren(...values.map(v=>{const o=node('option',v);o.value=v;return o;}));if(values.includes(previous))$(id).value=previous;$(id).disabled=!values.length;}
  function refreshSummaryEpochs() {
    const epochs = dataset ? allEpochs() : [];
    const initial = !knownEpochs.size, hadSelection = summaryEpochs.size > 0;
    summaryEpochs = new Set(epochs.filter(epoch => summaryEpochs.has(epoch)));
    if ((initial || hadSelection && !summaryEpochs.size) && epochs.length) summaryEpochs.add(epochs.includes($('epoch').value) ? $('epoch').value : epochs[0]);
    knownEpochs = new Set(epochs);
    const select = $('summaryEpochs');
    select.replaceChildren(...epochs.map(epoch => {
      const option = node('option', epoch);
      option.value = epoch;
      option.selected = summaryEpochs.has(epoch);
      return option;
    }));
    select.disabled = !epochs.length;
  }
  function mergeSources(sources) {
    const inputs = sources.map(source => source.data).filter(data => data.recordings.length);
    const idsBySubject = new Map(dataset?.recordings.map(recording => [recording.subject, recording.id]));
    return inputs.length ? C.merge(inputs, {idsBySubject}) : null;
  }

  function updateSources(sources, next) {
    const existing = new Set(dataset?.recordings.map(recording => recording.id));
    selected = new Set((next?.recordings ?? [])
      .filter(recording => !existing.has(recording.id) || selected.has(recording.id))
      .map(recording => recording.id));
    document.dispatchEvent(new Event('metrics-sources-changed'));
    importedFiles = sources;
    dataset = next;
  }

  function removeSubject(recording) {
    const remaining = importedFiles.map(source => ({
      ...source,
      data: { ...source.data, recordings: source.data.recordings.filter(item => item.subject !== recording.subject) }
    }));
    updateSources(remaining, mergeSources(remaining));
    refresh();
  }

  const importedFilesDialog = $('importedFilesDialog');
  const confirmFileRemoval = importedFilesDialog.querySelector('[data-confirm]');
  const filesToRemove = new Set();
  function resetFileRemoval() {
    filesToRemove.clear();
    $('importedFilesList').replaceChildren();
  }
  connectMetricsSettings({
    trigger: $('openImportedFiles'), dialog: importedFilesDialog,
    begin: () => {
      confirmFileRemoval.disabled = true;
      $('importedFilesError').textContent = '';
      $('importedFilesList').replaceChildren(...importedFiles.map(source => {
        const label = node('label', undefined, 'check-option');
        const checkbox = node('input');
        checkbox.type = 'checkbox';
        checkbox.onchange = () => {
          if (checkbox.checked) filesToRemove.add(source);
          else filesToRemove.delete(source);
          confirmFileRemoval.disabled = !filesToRemove.size;
        };
        label.append(checkbox, node('span', source.name));
        return label;
      }));
    },
    accept: () => {
      if (!filesToRemove.size) return false;
      try {
        const remaining = importedFiles.filter(source => !filesToRemove.has(source));
        updateSources(remaining, mergeSources(remaining));
        generation++;
        $('errors').textContent = '';
      } catch (error) {
        $('importedFilesError').textContent = error.message;
        return false;
      }
    },
    discard: resetFileRemoval,
    applied: () => {
      resetFileRemoval();
      if (!importedFiles.length) chart.clearZoom();
      refresh();
      if (!importedFiles.length) $('files').focus();
    }
  });

  function refreshSubjectList(available) {
    const scroller = $('subjectList'), scrollTop = scroller.scrollTop;
    const sharedGroups=$('groupAverages').checked?window.MetricsGroups?.snapshot():null;
    const groupAssignments=new Map(sharedGroups?.assignments);
    $('subjectListHeading').hidden = mode !== 'summary' || !available.length;
    const rows = available.map(({record, epochs}) => {
      const row = node('div', undefined, 'subject-row'), label = node('label');
      row.dataset.recordingId = record.id;
      row.dataset.subject = record.subject;
      row.dataset.epochs = JSON.stringify(epochs);
      const check = node('input');
      check.type = 'checkbox';
      check.checked = selected.has(record.id);
      check.setAttribute('aria-label', 'Seleziona ' + record.subject);
      check.onchange = () => {
        if (check.checked) selected.add(record.id);
        else selected.delete(record.id);
        render();
      };
      const text = node('span', record.subject);
      const groupIndex=sharedGroups?.groups.findIndex(group=>group.id===(groupAssignments.get(record.id)||sharedGroups.groups[0].id));
      text.style.color = palette[(groupIndex>=0?groupIndex:dataset.recordings.indexOf(record)) % palette.length];
      label.append(check, text);
      const remove = node('button', '×');
      remove.title = 'Rimuovi ' + record.subject;
      remove.setAttribute('aria-label', remove.title);
      remove.onclick = () => removeSubject(record);
      row.append(label);
      if (mode === 'summary') {
        const stimuli = node('div', undefined, 'subject-epoch-chips');
        stimuli.setAttribute('role', 'group');
        stimuli.setAttribute('aria-label', 'Stimoli con dati per ' + record.subject);
        stimuli.append(...epochs.map(epoch => {
          const chip = node('span', epoch, 'subject-epoch-chip');
          chip.dataset.subjectEpoch = epoch;
          return chip;
        }));
        row.append(stimuli);
      }
      row.append(remove);
      return row;
    });
    $('subjects').replaceChildren(...rows);
    scroller.scrollTop = scrollTop;
    $('counts').textContent = available.filter(item => selected.has(item.record.id)).length +
      ' selezionati su ' + available.length + ' con dati';
  }

  function refresh(){
    options('metric',dataset?allMetrics():[]);options('epoch',dataset?allEpochs():[]);options('baseline',dataset?allEpochs():[]);
    refreshSummaryEpochs();
    const hasData = Boolean(dataset);
    $('saveProject').disabled = !hasData;
    $('workspace').hidden = !hasData;
    $('drop').classList.toggle('has-data', hasData);
    $('clear').hidden = !importedFiles.length;
    $('openVideoAssignments').hidden = !hasData;
    $('openImportedFiles').hidden = !importedFiles.length;
    $('openImportedFiles').textContent = 'File caricati (' + importedFiles.length + ')';
    $('fileLabel').textContent = hasData ? 'Aggiungi file' : 'Scegli file';
    $('status').textContent=dataset?`${dataset.recordings.length} soggetti · ${allMetrics().length} metriche · ${allEpochs().length} epoche. I nuovi file vengono aggiunti al dataset.`:'Nessun file caricato.';
    return render();
  }
  async function load(files){
    const list=[...files];if(!list.length)return;
    const media=list.filter(file=>window.MetricsStaticMedia?.kind(file));
    const dataFiles=list.filter(file=>!window.MetricsStaticMedia?.kind(file));
    if(!dataFiles.length){if(media.length)window.MetricsVideo.importFiles(media);return;}
    const ticket=++generation;$('errors').textContent='';
    const job=MetricsBusy.start('Lettura metriche in corso…');
    try{
      const inputs=[];
      for(const [index,file]of dataFiles.entries()){
        await job.step(`Lettura metriche in corso: ${file.name}`,{value:index,max:list.length});
        if(ticket!==generation)return;
        try {
          const extension = /\.(json|xlsx)$/i.exec(file.name)?.[1].toLowerCase();
          if (!extension) throw new Error('Scegli dati JSON/XLSX, video o immagini.');
          const contents = extension === 'xlsx' ? await file.arrayBuffer() : await file.text();
          await job.step(`Verifica delle metriche: ${file.name}`, {value:index,max:list.length});
          if (ticket !== generation) return;
          const input = extension === 'xlsx' ? MetricsLegacyXlsx.read(contents) : JSON.parse(contents);
          inputs.push({ name: file.name, data: C.validate(input) });
        } catch (error) {
          throw new Error(`${file.name}: ${error.message}`);
        }
      }
      await job.step('Preparazione dei soggetti e delle epoche…',{value:list.length,max:list.length});
      if(ticket!==generation)return;
      const sources = [...importedFiles, ...inputs];
      const merged = mergeSources(sources);
      await job.step('Preparazione dei grafici e degli outlier…');
      if(ticket!==generation)return;
      updateSources(sources, merged);
      await refresh();
      if(media.length){job.end();window.MetricsVideo.importFiles(media);}
    }catch(e){if(ticket===generation)$('errors').textContent=e.message;}
    finally{job.end();}
  }
  function config(values=temporal){
    const o={norm:$('normalization').value,baseline:$('baseline').value,baseFrom:number(values,'baseFrom',-Infinity),baseTo:number(values,'baseTo',Infinity),from:number(values,'from',-Infinity),to:number(values,'to',Infinity),maxGap:number(values,'gap',null),step:number(values,'step',null),scaled:values.madScale==='scaled'};
    if(o.from>o.to||o.baseFrom>o.baseTo)throw new Error('L’inizio dell’intervallo deve precedere la fine.');
    if(o.step!==null&&o.step<=0||o.maxGap!==null&&o.maxGap<=0)throw new Error('Passo griglia e lacuna massima devono essere positivi.');return o;
  }
  const normalizedDataset=C.createNormalizationCache();
  function prepared(records,epoch,metric,o,warnings){
    const normalized=normalizedDataset(dataset.recordings,metric,o);
    return records.flatMap(r=>{
      const recordingEpoch = r.epochs.find(item => item.id === epoch);
      if (!recordingEpoch) return [];
      const s = recordingEpoch.metrics[metric];
      if(!s?.time.length){warnings.push(`${r.subject} · ${epoch}: metrica assente o vuota.`);return [];}
      try{const result=normalized.get(r.id)?.get(epoch);if(result?.error)throw new Error(result.error);if(!result.series.values.some(C.finite))throw new Error('Nessun valore valido.');return [{r,...result}];}
      catch(e){warnings.push(`${r.subject} · ${epoch}: ${e.message}`);return [];}
    });
  }
  const chart = createMetricsChart({
    C, $, node, fmt, getMode: () => mode, onSummaryCsv: exportSummaryCsv, onZoom: () => setVisualIsolation(visualIsolationIds, visualIsolationPair)
  });
  const { plot, markMoments } = chart;
  let redrawSeriesDisplay = null;
  let visualIsolationIds=null, visualIsolationPair=null;
  function setVisualIsolation(ids, pair = null){
    visualIsolationIds=ids;
    visualIsolationPair=ids?.length ? pair : null;
    if(ids?.length && mode==='series' && !$('individuals').checked){forcedIndividuals=true;$('individuals').checked=true;revealIndividualTraces?.();}
    if(!ids?.length && forcedIndividuals){forcedIndividuals=false;$('individuals').checked=false;restoreIndividualTraces?.();}
    const isolated=ids?.length?new Set(ids):null;
    for(const trace of $('chart').querySelectorAll('[data-trace-subject]')){
      const pairOnly = mode === 'summary' && visualIsolationPair;
      const emphasized=isolated?.has(trace.dataset.traceSubject)||false;
      trace.classList.toggle('is-dimmed',Boolean(isolated && (pairOnly ? !trace.dataset.traceSubject : !emphasized)));
      trace.classList.toggle('is-isolated',emphasized && !pairOnly);
      trace.classList.toggle('has-selected-pair', Boolean(pairOnly && emphasized));
      for (const point of trace.querySelectorAll('[data-subject-id]')) {
        const selected = pairOnly && point.dataset.subjectId === visualIsolationPair.id && point.dataset.subjectEpoch === visualIsolationPair.epoch;
        point.classList.toggle('is-dimmed', Boolean(pairOnly && !selected));
      }
    }
  }
  function setAnalysisError(message) {
    $('analysisError').textContent = message;
    $('temporalSettingsError').textContent = message;
  }

  function render(){
    const normalization = $('normalization').value;
    const normalizing = normalization !== 'none' && Boolean(dataset);
    $('baselineEpochControl').hidden = $('baselineSettings').hidden = !normalizing;
    for (const id of ['baseline', 'baseFrom', 'baseTo']) $(id).disabled = !normalizing;
    $('madScale').disabled = normalization !== 'zmad';
    const metric=$('metric').value;
    const count=(dataset?.recordings||[]).reduce((sum,r)=>sum+r.epochs.reduce((n,e)=>n+(e.metrics[metric]?.values.length||0),0),0);
    if(count<20000 && (dataset?.recordings.length||0)<100)return renderNow();
    return MetricsBusy.run('Elaborazione delle metriche in corso…',async job=>{
      await job.step(mode==='series'?'Allineamento delle serie e preparazione dei grafici…':'Calcolo dei riepiloghi temporali e degli outlier…');
      renderNow();
    }).catch(error=>setAnalysisError(error.message));
  }
  function displayGroups(records){
    if(!$('groupAverages').checked||!window.MetricsGroups)return [{id:'all',name:'Media',color:'#312b79',members:records.map(record=>record.id)}];
    const state=window.MetricsGroups.snapshot(),assigned=new Map(state.assignments);
    return state.groups.map((group,index)=>({...group,color:palette[index%palette.length],
      members:records.filter(record=>(assigned.get(record.id)||state.groups[0].id)===group.id).map(record=>record.id)})).filter(group=>group.members.length);
  }
  document.addEventListener('metrics-view-groups-applied',()=>render());
  document.addEventListener('metrics-groups-changed',()=>{if($('groupAverages').checked)render();});
  $('groupAverages').onchange=render;
  function renderNow(){
    viewExportRows=[];viewSummaries=[];
    chart.reset();
    redrawSeriesDisplay = null;
    const epochDurations={};
    for(const recording of dataset?.recordings??[])for(const epoch of recording.epochs)for(const metric of Object.values(epoch.metrics))
      epochDurations[epoch.id]=Math.max(epochDurations[epoch.id]||0,metric.time.at(-1)||0);
    window.MetricsVideo?.setContext(dataset?allEpochs():[],$('epoch').value,mode,epochDurations);
    document.dispatchEvent(new CustomEvent('metrics-invalidated', { detail: { mode, dataset, selectedIds: [...selected] } }));
    if(forcedIndividuals)$('individuals').checked=false;
    let analysisInput=null;revealIndividualTraces=null;restoreIndividualTraces=null;forcedIndividuals=false;
    setAnalysisError('');$('chart').replaceChildren();$('warnings').replaceChildren();$('tooltip').hidden=true;exportRows=[];$('export').disabled=true;
    $('seriesOptions').hidden=mode!=='series';$('seriesTab').classList.toggle('is-active',mode==='series');$('summaryTab').classList.toggle('is-active',mode==='summary');$('seriesTab').setAttribute('aria-pressed',mode==='series');$('summaryTab').setAttribute('aria-pressed',mode==='summary');
    let records = [];
    if (!dataset) refreshSubjectList([]);
    $('chartTitle').textContent = mode === 'series' ? 'Serie temporali' : 'Riepilogo temporale';
    if (!dataset) { $('chart').append(node('p', 'Carica un dataset oppure prova l’esempio.', 'empty-state')); return; }
    const warnings=[];
    try{
      const o=config(),metric=$('metric').value,epoch=$('epoch').value,unit=o.norm==='percent'?' [%]':o.norm==='none'?'':` [${o.norm==='zscore'?'z-score':'z-MAD'}]`;
      const activeEpochs = mode === 'series' ? [epoch] : allEpochs().filter(id => summaryEpochs.has(id));
      const availableById = new Map();
      for (const id of activeEpochs) {
        for (const item of prepared(dataset.recordings, id, metric, o, [])) {
          const value = C.aggregate(item.series, mode === 'summary' ? $('aggregation').value : 'mean', o.from, o.to, C.gapLimit(item.series, o.maxGap)).value;
          if (!C.finite(value)) continue;
          if (!availableById.has(item.r.id)) availableById.set(item.r.id, {record: item.r, epochs: []});
          availableById.get(item.r.id).epochs.push(id);
        }
      }
      const available = dataset.recordings.flatMap(record => availableById.has(record.id) ? [availableById.get(record.id)] : []);
      refreshSubjectList(available);
      records = available.map(item => item.record).filter(record => selected.has(record.id));
      $('chartTitle').textContent=metric + unit + ' · ' + (mode === 'series' ? epoch : 'riepilogo temporale');
      if (!records.length) {
        const message = !activeEpochs.length ? 'Seleziona almeno uno stimolo.' : available.length ? 'Seleziona almeno un soggetto.' : 'Nessun soggetto con dati utilizzabili.';
        $('chart').append(node('p', message, 'empty-state'));
        return;
      }
      const groups=displayGroups(records);
      const color=r=>$('groupAverages').checked?groups.find(group=>group.members.includes(r.id))?.color:palette[dataset.recordings.indexOf(r)%palette.length];
      const provenance={metric,normalization:o.norm,baseline:o.norm==='none'?'':o.baseline,baseline_from:Number.isFinite(o.baseFrom)?o.baseFrom:'',baseline_to:Number.isFinite(o.baseTo)?o.baseTo:'',mad_scale:o.scaled?1.4826:1,analysis_from:Number.isFinite(o.from)?o.from:'',analysis_to:Number.isFinite(o.to)?o.to:''};
      if(mode==='series'){
        const items=prepared(records,epoch,metric,o,warnings);if(!items.length)throw new Error('Nessuna serie utilizzabile con queste impostazioni.');
        const alignmentOptions = {
          range: temporal.range, step: o.step, from: o.from, to: o.to,
          method: temporal.interpolation, maxGap: o.maxGap
        };
        const aligned = C.align(items.map(x => x.series), alignmentOptions);
        analysisInput = { items, alignment: aligned, alignmentOptions };
        const individual = items.map(({ r }, i) => ({
          name: r.subject, subjectId: r.id, epoch, x: aligned.time, y: aligned.values[i], color: color(r)
        }));
        const intervals = aligned.summary.map(sample => MetricsAnalysis.ci95FromSummary(sample.n, sample.sd));
        viewSummaries=MetricsViewSummary.series(aligned,items,groups);
        viewExportRows=MetricsViewSummary.csvRows(viewSummaries,'Tempo (s)');
        const averages=viewSummaries.map(group=>({
          name:group.id==='all'?'Media ± IC 95%':group.name+' · Media ± IC 95%',
          x:aligned.time,y:group.summary.map(sample=>sample.mean),band:group.summary.map(sample=>sample.ci),
          n:group.summary.map(sample=>sample.n),color:group.color,bold:true
        }));
        function visibleTraces() {
          const traces = $('individuals').checked ? [...individual] : [];
          if ($('average').checked) traces.push(...averages);
          return traces;
        }
        function hover(time) {
          const offset = Math.round((time - aligned.time[0]) / aligned.step);
          const index = Math.max(0, Math.min(aligned.time.length - 1, offset));
          const sample = aligned.summary[index];
          return 'Tempo: '+fmt(sample.time)+' s\n'+viewSummaries.map(group=>{
            const cell=group.summary[index];
            return group.name+': '+fmt(cell.mean)+' · IC 95%: '+fmt(cell.ci===null?null:cell.mean-cell.ci)+'–'+fmt(cell.ci===null?null:cell.mean+cell.ci);
          }).join('\n');
        }
        plot(visibleTraces(), { hover });
        redrawSeriesDisplay = () => {
          chart.redrawSeries(visibleTraces());
          setVisualIsolation(visualIsolationIds, visualIsolationPair);
        };
        restoreIndividualTraces = revealIndividualTraces = () => chart.redrawSeries(visibleTraces());
        exportRows=aligned.summary.map((s,i)=>({...provenance,epoch,time:s.time,mean:s.mean,sd:s.sd,ci95_lower:intervals[i] === null ? null : s.mean - intervals[i],ci95_upper:intervals[i] === null ? null : s.mean + intervals[i],n:s.n,grid_step:aligned.step,range:alignmentOptions.range,interpolation:alignmentOptions.method,max_gap:o.maxGap??'auto:3*native_median_step',downsample_filter:'boxcar',...Object.fromEntries(items.map((x,j)=>[`subject:${x.r.subject}`,aligned.values[j][i]]))}));
      }else{
        const epochs=allEpochs().filter(e=>summaryEpochs.has(e)),method=$('aggregation').value,rows=[],stats=[];
        if(!epochs.length)throw new Error('Seleziona almeno un’epoca da confrontare.');
        epochs.forEach(e=>{const items=prepared(records,e,metric,o,warnings);const values=[];for(const x of items){const a=C.aggregate(x.series,method,o.from,o.to,C.gapLimit(x.series,o.maxGap));if(a.value===null)warnings.push(`${x.r.subject} · ${e}: nessun riepilogo calcolabile nell’intervallo.`);else values.push(a.value);rows.push({...provenance,epoch:e,subject:x.r.subject,aggregation:method,value:a.value,n_samples:a.n,valid_duration_s:a.duration,baseline_n:x.stats?.n??'',baseline_center:x.stats?.center??'',baseline_scale:x.stats?.scale??'',max_gap:o.maxGap??'auto:3*native_median_step'});}stats.push({epoch:e,mean:C.mean(values),sd:C.sd(values),ci:MetricsAnalysis.ci95(values),n:values.length});});
        analysisInput={rows,epochs};
        viewSummaries=MetricsViewSummary.summary(epochs,rows,records,groups);
        viewExportRows=MetricsViewSummary.csvRows(viewSummaries,'Stimolo');
        const traces=records.map(r=>({
          name:r.subject,subjectId:r.id,swarm:true,isolationOnly:!$('individuals').checked,color:color(r),
          ...($('groupAverages').checked?{groupIndex:groups.findIndex(group=>group.members.includes(r.id)),groupCount:groups.length}:{}),
          x:epochs.map((_,i)=>i),y:epochs.map(e=>rows.find(x=>x.subject===r.subject&&x.epoch===e)?.value??null)
        }));
        if($('average').checked)traces.unshift(...viewSummaries.map(group=>({
          name:group.id==='all'?'Media tra soggetti ± IC 95%':group.name+' · Media ± IC 95%',
          bandLabel:'IC 95%',color:group.color,bold:true,x:epochs.map((_,i)=>i),
          y:group.summary.map(sample=>sample.mean),band:group.summary.map(sample=>sample.ci),n:group.summary.map(sample=>sample.n)
        })));
        plot(traces,{categories:epochs,xLabel:'Epoca / stimolo',bars:true});
        exportRows=[...rows.map(r=>({row_type:'subject',...r,group_mean:null,group_sd:null,group_ci95_lower:null,group_ci95_upper:null,group_n:null})),...stats.map(s=>({row_type:'group',...provenance,epoch:s.epoch,subject:'',aggregation:method,value:null,n_samples:null,valid_duration_s:null,baseline_n:'',baseline_center:'',baseline_scale:'',max_gap:o.maxGap??'auto:3*native_median_step',group_mean:s.mean,group_sd:s.sd,group_ci95_lower:C.finite(s.ci)?s.mean-s.ci:null,group_ci95_upper:C.finite(s.ci)?s.mean+s.ci:null,group_n:s.n}))];
      }
      $('export').disabled=!exportRows.length;
      document.dispatchEvent(new CustomEvent('metrics-ready',{detail:{mode,dataset,records,selectedRecords:dataset.recordings.filter(record=>selected.has(record.id)),metric,epoch,o,analysisInput,exportRows,viewSummaries,prepared,plot,render,markMoments,setVisualIsolation}}));
    }catch(e){refreshSubjectList([]);setAnalysisError(e.message);}
    for(const message of [...new Set(warnings)])$('warnings').append(node('p',message));
  }
  function demo(){
    try{
      const next=C.validate(globalThis.MetricsDemo.createDataset());
      const videos=Object.entries(next.demo_info.videos).map(([epoch,item])=>({epoch,name:item.file,url:new URL(item.file,document.baseURI).href,demoFile:item.file}));
      document.dispatchEvent(new Event('metrics-dataset-replaced'));
      chart.clearZoom();
      generation++;$('errors').textContent='';importedFiles=[{name:'Esempio integrato · metrics_demo_2_stimoli.json',data:next}];dataset=next;selected=new Set(next.recordings.map(r=>r.id));mode='series';
      summaryEpochs.clear();knownEpochs.clear();
      for(const id of ['from','to','baseFrom','baseTo','step','gap'])$(id).value='';
      $('normalization').value='none';$('range').value='intersection';$('interpolation').value='linear';
      temporal=readTemporal();
      $('individuals').checked=$('average').checked=true;
      options('metric',allMetrics());$('metric').value='AWI';
      options('epoch',allEpochs());$('epoch').value='stim_arancia_';
      options('baseline',allEpochs());$('baseline').value='baseline';
      window.MetricsVideo.replaceAssignments(videos);
      const rendered=refresh();$('viewTab').click();
      $('status').textContent='Esempio sintetico: 35 soggetti · 10 metriche (2 a 60 Hz) · 2 stimoli + baseline di 10 s · video già associati.';
      return rendered;
    }catch(error){$('errors').textContent=`Impossibile caricare l’esempio: ${error.message}`;}
  }
  const viewFields = ['metric','epoch','baseline','normalization','aggregation','momentsCriterion','momentsCount'];
  const layoutProperties = ['--sidebar-width','--workspace-height','--workspace-video-height'];
  function captureProject(media) {
    const style = document.querySelector('.metrics-layout').style;
    return {
      sources:importedFiles, ids:dataset.recordings.map(r => [r.subject,r.id]),
      selected:[...selected], epochs:[...summaryEpochs], mode, temporal,
      values:Object.fromEntries(viewFields.map(id => [id,$(id).value])),
      individuals:$('individuals').checked && !forcedIndividuals, average:$('average').checked, groupAverages:$('groupAverages').checked,
      stats:MetricsStatsProject.capture(), chart:chart.captureView(),
      layout:layoutProperties.map(key => style.getPropertyValue(key)),
      links:media.links, position:media.position
    };
  }
  function prepareProject(s) {
    const valid = MetricsProject.requireValid;
    valid(s && Array.isArray(s.sources) && s.sources.length && Array.isArray(s.ids));
    const inputs = [];
    for (const source of s.sources) {
      valid(typeof source.name === 'string' && Array.isArray(source.data.recordings));
      if (source.data.recordings.length) inputs.push(source.data);
      else valid(source.data.schema_version === 1 && source.data.time_unit === 's');
    }
    const next = C.merge(inputs,{idsBySubject:new Map(s.ids)});
    const records = new Set(next.recordings.map(r => r.id));
    const epochs = new Set(next.recordings.flatMap(r => r.epochs.map(e => e.id)));
    valid(Array.isArray(s.selected) && s.selected.every(id => records.has(id)) &&
      Array.isArray(s.epochs) && s.epochs.every(id => epochs.has(id)) && ['series','summary'].includes(s.mode));
    valid(viewFields.every(id => typeof s.values[id] === 'string') && temporalIds.every(id => typeof s.temporal[id] === 'string'));
    valid(epochs.has(s.values.epoch) && epochs.has(s.values.baseline) &&
      next.recordings.some(r => r.epochs.some(e => Object.hasOwn(e.metrics,s.values.metric))));
    config(s.temporal);
    valid(s.groupAverages===undefined||typeof s.groupAverages==='boolean');
    valid(typeof s.individuals === 'boolean' && typeof s.average === 'boolean' && Number.isFinite(s.position) && s.position >= 0);
    valid(Array.isArray(s.layout) && s.layout.length === layoutProperties.length && s.layout.every(v => v === '' || /^\d+px$/.test(v)));
    valid(Array.isArray(s.chart.offsets) && s.chart.offsets.every(([key,v]) => typeof key === 'string' && Number.isFinite(v)));
    valid(Array.isArray(s.chart.zoom) && s.chart.zoom.every(([key,z]) => typeof key === 'string' &&
      ['x','y','yDomain'].every(axis => z[axis] === null || Array.isArray(z[axis]) && z[axis].length === 2 &&
        z[axis].every(Number.isFinite) && z[axis][0] < z[axis][1])));
    MetricsStatsProject.validate(s.stats);
    valid(Array.isArray(s.links) && s.links.every(link => epochs.has(link.epoch)));
    return {next,analysis:MetricsStatsProject.readHistory(s.stats,s.mode,s.values.metric,s.values.epoch)};
  }
  $('saveProject').onclick = () => MetricsBusy.run('Salvataggio del progetto…', async () => {
    $('errors').textContent='';
    const media = await MetricsVideo.projectMedia();
    const url = URL.createObjectURL(MetricsProject.pack(captureProject(media),media.files));
    const a = node('a');
    a.href=url; a.download='progetto.mvproj'; a.click();
    setTimeout(() => URL.revokeObjectURL(url),60000);
  }).catch(error => { $('errors').textContent='Salvataggio non riuscito: '+error.message; });
  $('openProject').onclick = () => $('projectFile').click();
  $('projectFile').onchange = event => {
    const file = event.target.files[0];
    event.target.value='';
    if (!file) return;
    const ticket = ++generation;
    return MetricsBusy.run('Apertura del progetto…', async () => {
      const {state:s,files} = await MetricsProject.unpack(file);
      const {next,analysis} = prepareProject(s);
      if (ticket !== generation) return;
      const installMedia = MetricsVideo.prepareProjectMedia(files,s.links);
      document.dispatchEvent(new Event('metrics-dataset-replaced'));
      dataset=next; importedFiles=s.sources; mode=s.mode; selected=new Set(s.selected);
      summaryEpochs=new Set(s.epochs); knownEpochs=new Set(allEpochs());
      forcedIndividuals=false; visualIsolationIds=null; visualIsolationPair=null;
      chart.restoreView(s.chart);
      const style = document.querySelector('.metrics-layout').style;
      layoutProperties.forEach((key,index) => style.setProperty(key,s.layout[index]));
      options('metric',allMetrics()); options('epoch',allEpochs()); options('baseline',allEpochs());
      for (const id of viewFields) $(id).value=s.values[id];
      temporal=s.temporal;
      for (const id of temporalIds) $(id).value=temporal[id];
      $('individuals').checked=s.individuals; $('average').checked=s.average; $('groupAverages').checked=Boolean(s.groupAverages);
      MetricsStatsProject.restore(s.stats,mode);
      installMedia();
      await refresh();
      if (ticket !== generation) return;
      MetricsStatsProject.restoreFilters(s.stats);
      MetricsStatsProject.restoreHistory(analysis);
      MetricsVideo.seek(s.position);
      document.dispatchEvent(new Event('metrics-settings-restored'));
      $('errors').textContent='';
      $('status').textContent=file.name+' · '+$('status').textContent;
    }).catch(error => { if (ticket === generation) $('errors').textContent='Apertura non riuscita: '+error.message; });
  };
  function csvCell(v){let s=v===null||v===undefined?'':String(v);if(typeof v==='string'&&/^[=+@\-\t\r]/.test(s))s="'"+s;return '"'+s.replaceAll('"','""')+'"';}
  $('export').onclick=()=>{
    const axis=mode==='series'?'Tempo (s)':'Stimolo';
    const summaries=new Map(viewExportRows.map(row=>[row[axis],Object.fromEntries(Object.entries(row).filter(([key])=>key!==axis))]));
    const state=window.MetricsGroups?.snapshot(),assigned=new Map(state?.assignments);
    const groupForSubject=subject=>{
      const record=dataset?.recordings.find(item=>item.subject===subject);
      return state?.groups.find(group=>group.id===(assigned.get(record?.id)||state.groups[0].id))?.name??'';
    };
    const membership=Object.keys(exportRows[0]??{}).filter(key=>key.startsWith('subject:')).map(key=>key.slice(8)+': '+groupForSubject(key.slice(8))).join('; ');
    const rows=exportRows.map(row=>({...row,...summaries.get(mode==='series'?row.time:row.epoch),
      ...(row.subject?{group:groupForSubject(row.subject)}:{}),...(mode==='series'&&membership?{group_assignments:membership}:{})}));
    return downloadCsv(rows,'metrics-'+mode+'.csv','Preparazione CSV completo…');
  };
  function exportSummaryCsv(){
    return downloadCsv(viewExportRows,'metrics-'+mode+'-media-ic95.csv','Preparazione CSV media e IC 95%…');
  }
  function downloadCsv(rows,filename,message){
    if(!rows.length)return;
    return MetricsBusy.run(message,async()=>{
      const headers=[...new Set(rows.flatMap(Object.keys))],csv='\uFEFF'+[headers,...rows.map(row=>headers.map(key=>row[key]))].map(row=>row.map(csvCell).join(',')).join('\r\n');
      const url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),link=node('a');
      link.href=url;link.download=filename;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);
    }).catch(error=>{$('errors').textContent=error.message;});
  }

  $('files').onchange=e=>{load(e.target.files);e.target.value='';};$('demo').onclick=demo;$('clear').onclick=()=>{document.dispatchEvent(new Event('metrics-dataset-replaced'));chart.clearZoom();generation++;dataset=null;importedFiles=[];selected.clear();$('errors').textContent='';refresh();$('files').focus();};
  for(const event of ['dragover','dragenter'])$('drop').addEventListener(event,e=>{e.preventDefault();$('drop').classList.add('is-dragging');});$('drop').ondragleave=()=>$('drop').classList.remove('is-dragging');$('drop').ondrop=e=>{e.preventDefault();$('drop').classList.remove('is-dragging');load(e.dataTransfer.files);};
  $('all').onclick=()=>{selected=new Set((dataset?.recordings||[]).map(r=>r.id));refresh();};$('none').onclick=()=>{selected.clear();refresh();};$('seriesTab').onclick=()=>{mode='series';render();};$('summaryTab').onclick=()=>{mode='summary';render();};
  for(const id of ['metric' ,'epoch','normalization','baseline','individuals','average','aggregation'])$(id).onchange=render;
  for(const id of ['individuals','average'])$(id).onchange=()=>{if(mode==='series'&&redrawSeriesDisplay){forcedIndividuals=false;redrawSeriesDisplay();}else render();};
  let temporalChanged = false;
  connectMetricsSettings({
    trigger: $('openTemporalSettings'), dialog: $('temporalSettingsDialog'),
    begin: () => { $('temporalSettingsError').textContent = ''; },
    accept: () => {
      const next = readTemporal();
      try {
        for (const id of temporalIds) {
          if ($(id).validity?.badInput) { $(id).reportValidity(); return false; }
        }
        config(next);
      } catch (error) {
        $('temporalSettingsError').textContent = error.message;
        return false;
      }
      temporalChanged = temporalIds.some(id => next[id] !== temporal[id]);
      temporal = next;
    },
    discard: () => {
      for (const id of temporalIds) $(id).value = temporal[id];
      document.dispatchEvent(new Event('metrics-settings-restored'));
    },
    applied: () => { if (temporalChanged) render(); }
  });
  $('summaryEpochs').onchange = event => {
    summaryEpochs = new Set(Array.from(event.target.selectedOptions, option => option.value));
    return render();
  };
  refresh();
})();
