(function(){
  'use strict';
  const C=MetricsCore,A=MetricsAnalysis,$=id=>document.getElementById(id);
  const subviews={series:'view',summary:'view'};
  let currentMode='series',context=null,version=0,results=[],resultMeta=null;
  let groups=[{id:'g1',name:'Gruppo 1'},{id:'g2',name:'Gruppo 2'}],nextGroup=3;
  const isolation=MetricsIsolation.create();let isolationKey=null,isolationDataset=null,latestFlags=new Map();
  const assignments=new Map(),colors=['#514691','#248d92','#c17b40','#b55488','#608a4a'];
  const el=(tag,text,cls)=>{const e=document.createElement(tag);if(tag==='button')e.type='button';if(tag==='th')e.setAttribute('scope','col');if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
  const fmt=x=>C.finite(x)?Number(x.toPrecision(6)).toString():x===Infinity?'∞':x===-Infinity?'−∞':'—';
  const designs={series:'one',summary:'within'};let designMode='series';
  function syncDesign(){
    if(designMode!==currentMode){designs[designMode]=$('design').value;designMode=currentMode;$('design').value=designs[currentMode];}
    const within=$('design').querySelector('[value="within"]');within.hidden=currentMode!=='summary';within.disabled=currentMode!=='summary';
  }
  function methodDescription(){
    const within=$('design').value==='within',summary=currentMode==='summary';
    $('statsMethod').textContent=within?'Confronto entro soggetto sulle epoche selezionate: con 2 epoche, t appaiato a due code (prima meno seconda); con 3 o più, F a misure ripetute con permutazione delle epoche entro ciascun soggetto e post-hoc t appaiati su tutte le coppie, corretti max-|T| tramite cambi di segno congiunti per soggetto. Si usano gli stessi soggetti completi per omnibus e post-hoc. Gli IC delle barre descrivono le medie delle epoche, non le differenze appaiate.':summary?'Test per ciascuna epoca contro un valore nullo o tra gruppi indipendenti. Correzione max-|T| / max-F su tutte le epoche selezionate; soggetti con dati completi. Per confrontare le epoche tra loro scegli il disegno entro soggetto.':'Test di permutazione: t contro un valore nullo o F tra gruppi indipendenti. Correzione max-|T| / max-F su tutti gli istanti analizzati; stessi soggetti a ogni istante.';
  }
  function subview(){syncDesign();$('seriesModeControls').hidden=currentMode!=='series';$('summaryModeControls').hidden=currentMode!=='summary';const stats=subviews[currentMode]==='stats';$('visualPanel').hidden=stats;$('statsPanel').hidden=!stats;for(const [id,active]of [['viewTab',!stats],['statsTab',stats]]){$(id).classList.toggle('is-active',active);$(id).setAttribute('aria-pressed',String(active));}$('statsTitle').textContent=`Analisi statistiche · ${currentMode==='series'?'Time series':'Riepilogo temporale'}`;}
  function clearResults(message='Impostazioni aggiornate: esegui nuovamente l’analisi.'){
    version++;results=[];resultMeta=null;$('statsResults').replaceChildren();$('statsGroupPlot').replaceChildren();$('statsPPlot').replaceChildren();$('exportStats').disabled=true;$('cancelStats').disabled=true;$('runStats').disabled=!context;$('statsStatus').textContent=message;
  }
  function groupEditor(){
    methodDescription();
    $('groupEditor').hidden=$('design').value!=='multi';$('nullValue').disabled=$('design').value!=='one';$('groupNames').replaceChildren();$('assignments').replaceChildren();
    for(const g of groups){const row=el('div',undefined,'group-name'),input=el('input');input.value=g.name;input.setAttribute('aria-label',`Nomina ${g.name}`);input.onchange=()=>{g.name=input.value.trim()||g.id;clearResults();groupEditor();};row.append(input);if(groups.length>2){const remove=el('button','×');remove.setAttribute('aria-label',`Rimuovi gruppo ${g.name}`);remove.onclick=()=>{groups=groups.filter(x=>x.id!==g.id);for(const[id,v]of assignments)if(v===g.id)assignments.set(id,groups[0].id);clearResults();groupEditor();};row.append(remove);}$('groupNames').append(row);}
    for(const r of context?.records||[]){if(!assignments.has(r.id))assignments.set(r.id,groups[0].id);const label=el('label',r.subject,'group-assignment'),select=el('select');select.setAttribute('aria-label',`Gruppo di ${r.subject}`);for(const g of groups){const option=el('option',g.name);option.value=g.id;select.append(option);}select.value=assignments.get(r.id);select.onchange=()=>{assignments.set(r.id,select.value);clearResults();};label.append(select);$('assignments').append(label);}
  }
  function table(target,headers,rows){const t=el('table'),h=el('thead'),tr=el('tr');headers.forEach(x=>tr.append(el('th',x)));h.append(tr);t.append(h);const body=el('tbody');for(const row of rows.slice(0,1000)){const tr=el('tr');row.forEach(x=>tr.append(el('td',x)));body.append(tr);}t.append(body);$(target).append(t);if(rows.length>1000)$(target).append(el('p','Anteprima limitata a 1.000 righe; il CSV contiene tutti i risultati.','panel-note'));}
  function flagLabel(flag){return flag?.status==='flagged'?(flag.flaggedEpochs?`Sì (${flag.flaggedEpochs.length})`:'Sì'):flag?.status==='within'?'No':flag?.status==='disabled'?'Off':'N/D';}
  function flagDescription(flag,summary){
    if(flag?.flaggedEpochs && flag.status!=='disabled'){
      const evaluated=`${flag.evaluatedEpochs.length}/${flag.totalEpochs} epoche valutabili`,missing=flag.unavailableEpochs.length?` Non valutabili: ${flag.unavailableEpochs.join(', ')}.`:'';
      return (flag.status==='flagged'?`Outlier in: ${flag.flaggedEpochs.join(', ')}. `:flag.status==='within'?'Nessun outlier nelle epoche valutabili. ':'Nessuna epoca valutabile. ')+evaluated+missing+' Nessuna esclusione automatica.';
    }
    if(!flag||flag.status==='insufficient')return summary?'Servono almeno 5 riepiloghi validi per questa metrica ed epoca.':'Servono almeno 5 soggetti confrontabili e almeno 3 istanti valutabili (oppure 5 medie temporali valide).';
    if(flag.status==='disabled')return 'Rilevamento disattivato.';
    if(flag.tested!==undefined)return `${flag.deviating}/${flag.tested} istanti oltre soglia. Nessuna esclusione automatica.`;
    return `Valore: ${fmt(flag.value)}; limiti IQR: ${fmt(flag.lowerFence)} / ${fmt(flag.upperFence)}; z robusto: ${fmt(flag.robustZ)}. Nessuna esclusione automatica.`;
  }
  function updateIsolationControls(ctx){
    const drawable=ctx.records.filter(r=>ctx.mode==='series'?ctx.analysisInput.items.some((item,i)=>item.r.id===r.id&&ctx.analysisInput.alignment.values[i].some(C.finite)):ctx.analysisInput.rows.some(row=>row.subject===r.subject&&C.finite(row.value)));
    const ids=isolation.resolve(drawable,latestFlags),target=isolation.target;
    const count=drawable.filter(r=>latestFlags.get(r.id)?.status==='flagged').length;
    const button=$('isolateOutliers');button.disabled=count===0;button.textContent=`◎ ${target?.type==='outliers'?'Ripristina outlier':'Isola outlier'} (${count})`;button.setAttribute('aria-pressed',String(target?.type==='outliers'));
    $('restoreIsolation').hidden=!target;
    $('isolationStatus').textContent=target?`${ids.length} ${ids.length===1?'soggetto evidenziato':'soggetti evidenziati'}. Selezione, medie, CSV e test restano invariati.`:count?`${count} outlier tra i soggetti selezionati. ◎ evidenzia una singola traccia.`:'Nessun outlier tra i soggetti selezionati. ◎ evidenzia una singola traccia.';
    for(const row of $('subjects').children){
      let button=row.querySelector('.trace-isolate-button');
      if(!button){button=el('button','◎','trace-isolate-button');button.type='button';button.onclick=()=>{isolation.toggleSubject(row.dataset.recordingId);subviews[currentMode]='view';subview();updateIsolationControls(context);};row.insertBefore(button,row.lastElementChild);}
      const record=ctx.dataset.recordings.find(r=>r.id===row.dataset.recordingId),selected=drawable.some(r=>r.id===row.dataset.recordingId),active=target?.type==='subject'&&target.id===row.dataset.recordingId;
      button.disabled=!selected;button.setAttribute('aria-pressed',String(active));button.setAttribute('aria-label',`${active?'Ripristina':'Isola'} traccia ${record.subject}`);button.title=selected?`${active?'Ripristina':'Isola'} la traccia di ${record.subject}`:'Seleziona un soggetto con valori visualizzabili per isolare la traccia';
    }
    ctx.setVisualIsolation(ids);
  }
  function updateOutliers(ctx){
    const summary=ctx.mode==='summary',method=$(summary?'outlierSummary':'outlierSeries').value;
    $('outlierSeries').parentElement.hidden=summary;$('summaryOutlierControl').hidden=!summary;
    $('outlierContext').textContent=summary?`Flag per ${ctx.metric} · ${ctx.analysisInput.epochs.length} epoche selezionate · ${$('aggregation').selectedOptions[0].textContent}`:`Flag per ${ctx.metric} · ${ctx.epoch}`;
    $('outlierHelp').textContent=summary?'IQR o MAD sono applicati ai riepiloghi temporali individuali dopo normalizzazione e aggregazione. Ogni metrica × epoca ha soglie proprie; servono almeno 5 soggetti validi. Il badge laterale segnala un soggetto se è outlier in almeno una delle epoche selezionate e indica quante. No significa nessun flag nelle epoche valutabili; N/D significa nessuna epoca valutabile. Il tooltip elenca eventuali epoche non valutabili. IQR: 1,5 × intervallo interquartile. MAD: |z robusto| > 3,5.':'Come in TimeSeriesViewer: IQR 1,5 × o z robusto MAD > 3,5 a ogni istante, con almeno 5 soggetti. Il flag richiede almeno 3 istanti oltre soglia e almeno il 10% degli istanti valutabili. Media temporale IQR confronta le medie pesate nel tempo (almeno 5 soggetti). I confronti usano la griglia comune su tutta l’estensione disponibile, limitata all’intervallo di analisi.';
    let flags=new Map();const epochFlags=new Map();$('outlierResults').replaceChildren();
    try{
      if(summary){
        for(const epoch of ctx.analysisInput.epochs){
          const items=ctx.prepared(ctx.dataset.recordings,epoch,ctx.metric,ctx.o,[]);
          epochFlags.set(epoch,A.scalarFlags(items.map(x=>({id:x.r.id,value:C.aggregate(x.series,$('aggregation').value,ctx.o.from,ctx.o.to,C.gapLimit(x.series,ctx.o.maxGap)).value})),method));
        }
        flags=A.summaryFlags(ctx.dataset.recordings,ctx.analysisInput.epochs,epochFlags,method);
        $('outlierResults').append(el('h3','Riepiloghi individuali e outlier'));
        table('outlierResults',['Soggetto','Epoca','Valore','Campioni','Outlier'],ctx.analysisInput.rows.map(r=>[r.subject,r.epoch,fmt(r.value),r.n_samples,flagLabel(epochFlags.get(r.epoch)?.get(ctx.records.find(x=>x.subject===r.subject)?.id))]));
        for(const row of ctx.exportRows){if(row.row_type==='subject'){row.outlier_method=method;row.outlier_status=epochFlags.get(row.epoch)?.get(ctx.records.find(x=>x.subject===row.subject)?.id)?.status||'insufficient';}}
      }else{
        const items=ctx.prepared(ctx.dataset.recordings,ctx.epoch,ctx.metric,ctx.o,[]);
        flags=A.temporalFlags(items,{from:ctx.o.from,to:ctx.o.to,step:ctx.o.step,maxGap:ctx.o.maxGap,method:$('interpolation').value},method);
        const flagged=ctx.records.filter(r=>flags.get(r.id)?.status==='flagged').map(r=>r.subject).join('; ');
        for(const row of ctx.exportRows){row.outlier_method=method;row.flagged_subjects=flagged;}
      }
    }catch(e){$('outlierContext').textContent+=` · Non valutabile: ${e.message}`;}
    latestFlags=flags;
    for(const row of $('subjects').children){row.querySelector('.outlier-badge')?.remove();const flag=flags.get(row.dataset.recordingId),badge=el('span',flagLabel(flag),`outlier-badge outlier-${flag?.status||'insufficient'}`);badge.title=flagDescription(flag,summary);badge.setAttribute('aria-label',`Outlier: ${flagLabel(flag)}. ${badge.title}`);row.insertBefore(badge,row.lastElementChild);}
    updateIsolationControls(ctx);
  }
  document.addEventListener('metrics-invalidated',e=>{currentMode=e.detail?.mode||currentMode;context=null;$('isolateOutliers').disabled=true;$('restoreIsolation').hidden=true;$('isolationStatus').textContent='';for(const button of $('subjects').querySelectorAll('.trace-isolate-button'))button.disabled=true;clearResults('Seleziona dati utilizzabili nella visualizzazione.');$('statsTarget').textContent='Seleziona dati utilizzabili nella visualizzazione.';$('outlierResults').replaceChildren();for(const badge of $('subjects').querySelectorAll('.outlier-badge'))badge.remove();subview();});
  document.addEventListener('metrics-ready',e=>{
    context=e.detail;currentMode=context.mode;const key=JSON.stringify([context.mode,context.metric,context.mode==='series'?context.epoch:null,context.o,$('aggregation').value,context.dataset.recordings.map(r=>r.id),context.analysisInput.epochs,$('range').value,$('interpolation').value]);if(key!==isolationKey||isolationDataset!==context.dataset){isolation.reset();isolationKey=key;isolationDataset=context.dataset;}subview();groupEditor();updateOutliers(context);$('runStats').disabled=false;
    const targets=context.mode==='series'?context.epoch:context.analysisInput.epochs.join(', ');
    $('statsTarget').textContent=`${context.metric} · ${targets} · ${context.records.length} soggetti selezionati · ${$('normalization').selectedOptions[0].textContent}${context.mode==='summary'?' · '+$('aggregation').selectedOptions[0].textContent:''}`;
    methodDescription();
  });
  $('viewTab').onclick=()=>{subviews[currentMode]='view';subview();};$('statsTab').onclick=()=>{subviews[currentMode]='stats';subview();};
  $('isolateOutliers').onclick=()=>{if(!context)return;isolation.toggleOutliers();subviews[currentMode]='view';subview();updateIsolationControls(context);};
  document.addEventListener('metrics-isolate-subject',e=>{if(!context)return;isolation.toggleSubject(e.detail.id);updateIsolationControls(context);});
  $('restoreIsolation').onclick=()=>{isolation.reset();if(context)updateIsolationControls(context);};
  function refreshOutlierFeedback(){if(!context)return;const ctx=context;return MetricsBusy.run('Ricerca degli outlier in corso…',async()=>updateOutliers(ctx)).catch(error=>{$('outlierContext').textContent=error.message;});}
  $('outlierSeries').onchange=refreshOutlierFeedback;$('outlierSummary').onchange=refreshOutlierFeedback;
  $('design').onchange=()=>{clearResults();groupEditor();};for(const id of ['nullValue','permutations','seed'])$(id).onchange=()=>clearResults();
  $('addGroup').onclick=()=>{groups.push({id:`g${nextGroup}`,name:`Gruppo ${nextGroup++}`});clearResults();groupEditor();};
  $('cancelStats').onclick=()=>clearResults('Analisi annullata.');
  function displayResults(){
    $('statsResults').replaceChildren();const visible=$('significantOnly').checked?results.filter(r=>r.pAdjusted<=.05):results;
    table('statsResults',[currentMode==='series'?'Tempo [s]':'Epoca / confronto','Test','Statistica','Differenza media A − B','p non corretto','p finale','Correzione','N'],visible.map(r=>[r.label,r.test||($('design').value==='one'?'t':'F'),fmt(r.statistic),fmt(r.meanDifference),fmt(r.pUncorrected),fmt(r.pAdjusted),r.correction||resultMeta?.correction||'',r.n]));
    if(!visible.length)$('statsResults').append(el('p','Nessun risultato con il filtro selezionato.','panel-note'));
  }
  $('significantOnly').onchange=displayResults;
  $('runStats').onclick=async()=>{
    if(!context)return;const ctx=context;clearResults('Preparazione dei test…');const ticket=version,design=$('design').value,permutations=Number($('permutations').value),nullValue=Number($('nullValue').value),seed=Number($('seed').value);
    const job=MetricsBusy.start('Preparazione dell’analisi statistica…',{onCancel:()=>clearResults('Analisi annullata.')});
    try{
      await job.step('Preparazione dei dati per i test…');if(ticket!==version)return;
      if(!Number.isInteger(permutations)||permutations<100||permutations>50000||(design==='one'&&!Number.isFinite(nullValue))||!Number.isInteger(seed)||seed<0||seed>4294967295)throw new Error('Controlla valore nullo, seed e numero di permutazioni (100–50.000).');
      const matrix=ctx.mode==='series'?A.completeTimeMatrix(ctx.analysisInput.items,ctx.analysisInput.alignment):A.completeSummaryMatrix(ctx.records,ctx.analysisInput.epochs,ctx.analysisInput.rows);
      if(matrix.subjects.length<2)throw new Error('Servono almeno 2 soggetti con dati completi.');
      if(matrix.times.length*matrix.subjects.length*permutations>300000000)throw new Error('Analisi troppo estesa: riduci permutazioni, intervallo o risoluzione temporale.');
      const subjects=matrix.subjects.map(s=>({...s,groupIndex:groups.findIndex(g=>g.id===assignments.get(s.id))}));
      if(design==='multi'&&groups.some((_,i)=>subjects.filter(s=>s.groupIndex===i).length<2))throw new Error('Assegna almeno 2 soggetti utilizzabili a ciascun gruppo.');
      $('runStats').disabled=true;$('cancelStats').disabled=false;
      const within=design==='within';
      if(within&&ctx.mode!=='summary')throw new Error('Il confronto tra epoche è disponibile nel riepilogo temporale.');
      const progress=(done,total,phase='Permutazioni')=>{if(version===ticket){$('statsStatus').textContent=`${phase}: ${done.toLocaleString('it-IT')} / ${total.toLocaleString('it-IT')}…`;job.update(`${phase} in corso…`,{value:done,max:total});}};
      let repeated=null,points;
      if(within){
        repeated=await MetricsRepeated.run({subjects,epochs:ctx.analysisInput.epochs,permutations,seed,isCancelled:()=>version!==ticket,onProgress:progress});
        points=[...(repeated.omnibus?[repeated.omnibus]:[]),...repeated.comparisons];
      }else points=await TimeSeriesPermutation.run({subjects,times:matrix.times,mode:design,nullValue,permutations,seed,isCancelled:()=>version!==ticket,onProgress:progress});
      if(ticket!==version)return;
      await job.step('Preparazione dei risultati statistici…');if(ticket!==version)return;
      const labels=ctx.mode==='summary'?ctx.analysisInput.epochs:matrix.times.map(fmt);
      results=points.map((p,i)=>({...p,label:within?p.label:labels[i],n:subjects.length}));
      resultMeta={view:ctx.mode,metric:ctx.metric,epoch:ctx.mode==='series'?ctx.epoch:'',aggregation:ctx.mode==='summary'?$('aggregation').value:'',normalization:ctx.o.norm,baseline:ctx.o.norm==='none'?'':ctx.o.baseline,baseline_from:Number.isFinite(ctx.o.baseFrom)?ctx.o.baseFrom:'',baseline_to:Number.isFinite(ctx.o.baseTo)?ctx.o.baseTo:'',mad_scale:ctx.o.scaled?1.4826:1,analysis_from:Number.isFinite(ctx.o.from)?ctx.o.from:'',analysis_to:Number.isFinite(ctx.o.to)?ctx.o.to:'',design,null_value:within?'':nullValue,permutations,seed,correction:within?'max-|T| (post-hoc only)':design==='one'?'max-abs-T':'max-F',family:within?'all epoch pairs for selected metric':ctx.mode==='series'?'all tested times':'all tested epochs',included_subjects:subjects.map(s=>s.subject).join('; '),excluded_subjects:ctx.records.filter(r=>!subjects.some(s=>s.id===r.id)).map(r=>r.subject).join('; '),group_assignments:design==='multi'?subjects.map(s=>`${s.subject}:${groups[s.groupIndex].name}`).join('; '):'',grid_step:ctx.mode==='series'?ctx.analysisInput.alignment.step:'',max_gap:ctx.o.maxGap??'auto:3*native_median_step',interpolation:ctx.mode==='series'?$('interpolation').value:'',outlier_method:$(ctx.mode==='series'?'outlierSeries':'outlierSummary').value};
      const summaryGroups=design!=='multi'?[{name:'Soggetti selezionati',subjects}]:groups.map((g,i)=>({name:g.name,subjects:subjects.filter(s=>s.groupIndex===i)}));
      const traces=summaryGroups.map((g,i)=>{const columns=matrix.times.map((_,j)=>g.subjects.map(s=>s.values[j]));return {name:`${g.name} (N=${g.subjects.length}) · IC 95%`,color:colors[i%colors.length],bold:true,x:matrix.times,y:columns.map(C.mean),band:columns.map(A.ci95)};});
      const categories=ctx.mode==='summary'?labels:null;
      ctx.plot(traces,{target:'statsGroupPlot',title:'Medie dei gruppi e intervalli di confidenza al 95%',categories,bars:!!categories,xLabel:categories?'Epoca / stimolo':'Tempo [s]'});
      const pPoints=within?repeated.comparisons:points,pTimes=within?pPoints.map((_,i)=>i):matrix.times,pCategories=within?pPoints.map(p=>p.label):categories;
      ctx.plot([{name:within?(repeated.omnibus?'p post-hoc · max-|T|':'p appaiato'):'p corretto',color:'#312b79',bold:true,x:pTimes,y:pPoints.map(p=>p.pAdjusted)},{name:'Soglia 0,05',color:'#bd253b',x:pTimes,y:pTimes.map(()=>.05)}],{target:'statsPPlot',title:within?'Confronti appaiati tra epoche':'P-value corretti',categories:pCategories,xLabel:within?'Confronto A − B':categories?'Epoca / stimolo':'Tempo [s]'});
      displayResults();$('exportStats').disabled=false;
      const omitted=ctx.mode==='series'?`${matrix.dropped} istanti incompleti omessi.`:`Soggetti incompleti esclusi: ${matrix.excluded.join(', ')||'nessuno'}.`;
      $('statsStatus').textContent=`Completato: ${points.filter(p=>p.pAdjusted<=.05).length}/${points.length} risultati con p finale ≤ 0,05. N=${subjects.length}. ${omitted} ${within?(repeated.omnibus?'Il p omnibus non richiede correzione; i post-hoc sono corretti max-|T| su tutte le coppie, anche se l’omnibus non è significativo.':'Un solo confronto appaiato: nessuna correzione multipla necessaria.'):''} I flag outlier non escludono automaticamente soggetti.`;
    }catch(e){if(ticket===version)$('statsStatus').textContent=e.message;}
    finally{job.end();if(ticket===version){$('runStats').disabled=!context;$('cancelStats').disabled=true;}}
  };
  $('exportStats').onclick=()=>{
    if(!results.length)return;return MetricsBusy.run('Preparazione del CSV delle analisi…',async()=>{const rows=results.map(r=>({...resultMeta,target:r.label,test:r.test||(resultMeta.design==='one'?'t':'F'),epoch_a:r.epochA||'',epoch_b:r.epochB||'',mean_difference:r.meanDifference??'',df1:r.df1??'',df2:r.df2??'',statistic:r.statistic,p_uncorrected:r.pUncorrected,p_adjusted:r.pAdjusted,correction:r.correction||resultMeta.correction,n:r.n})),headers=Object.keys(rows[0]);
    const quote=x=>{let v=x===null||x===undefined?'':String(x);if(typeof x==='string'&&/^[=+@\-\t\r]/.test(v))v="'"+v;return '"'+v.replaceAll('"','""')+'"';};
    const csv='\uFEFF'+[headers,...rows.map(r=>headers.map(k=>r[k]))].map(r=>r.map(quote).join(',')).join('\r\n'),url=URL.createObjectURL(new Blob([csv],{type:'text/csv;charset=utf-8'})),a=el('a');a.href=url;a.download=`metrics-${currentMode}-permutation.csv`;a.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}).catch(error=>{$('statsStatus').textContent=error.message;});
  };
})();
