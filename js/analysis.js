(function(root){
  'use strict';
  const C=typeof module!=='undefined'?require('./core'):root.MetricsCore;
  const O=typeof module!=='undefined'?require('./outliers'):root.MetricsOutliers;
  function scalarFlags(items,method='iqr'){
    const flags=new Map(items.map(x=>[x.id,{status:method==='none'?'disabled':'insufficient'}]));
    const valid=items.filter(x=>C.finite(x.value));if(method==='none'||valid.length<5)return flags;
    const v=valid.map(x=>x.value),q1=O.percentile(v,.25),q3=O.percentile(v,.75),iqr=q3-q1,median=C.median(v),mad=C.median(v.map(x=>Math.abs(x-median))),tol=Number.EPSILON*Math.max(1,Math.abs(median))*16;
    for(const x of valid){const deviation=Math.abs(x.value-median),z=mad>tol?.6745*deviation/mad:deviation>tol?Infinity:0;
      const flagged=method==='mad'?z>3.5:x.value<q1-1.5*iqr||x.value>q3+1.5*iqr;
      flags.set(x.id,{status:flagged?'flagged':'within',value:x.value,lowerFence:q1-1.5*iqr,upperFence:q3+1.5*iqr,robustZ:z});
    }return flags;
  }
  function summaryFlags(records,epochs,epochFlags,method='iqr'){
    return new Map(records.map(r=>{
      const flaggedEpochs=epochs.filter(epoch=>epochFlags.get(epoch)?.get(r.id)?.status==='flagged');
      const evaluated=epochs.filter(epoch=>['flagged','within'].includes(epochFlags.get(epoch)?.get(r.id)?.status));
      const unavailableEpochs=epochs.filter(epoch=>!evaluated.includes(epoch));
      const manualEpochs=epochs.filter(epoch=>epochFlags.get(epoch)?.get(r.id)?.manual);
      return [r.id,{status:method==='none'&&!manualEpochs.length?'disabled':flaggedEpochs.length?'flagged':evaluated.length?'within':'insufficient',flaggedEpochs,evaluatedEpochs:evaluated,unavailableEpochs,manualEpochs,totalEpochs:epochs.length}];
    }));
  }
  function temporalFlags(items,options,method='iqr'){
    if(method==='mean-iqr'){
      return scalarFlags(items.map(x=>({id:x.r.id,value:C.aggregate(x.series,'weighted',options.from,options.to,C.gapLimit(x.series,options.maxGap)).value})),'iqr');
    }
    if(method==='none')return new Map(items.map(x=>[x.r.id,{status:'disabled'}]));
    if(!items.length)return new Map();
    const a=C.align(items.map(x=>x.series),{...options,range:'union'});
    const subjects=items.map((x,j)=>({id:x.r.id,dataByMetric:{metric:{epoch:a.time.map((time,i)=>({time,value:a.values[j][i]}))}}}));
    return O.getOutlierFlags(subjects,'metric','epoch',method);
  }
  function ci95(values){
    return ci95FromSummary(values.length, C.sd(values));
  }
  function ci95FromSummary(n, sd){
    if(n<2)return null;
    const t=[12.706,4.303,3.182,2.776,2.571,2.447,2.365,2.306,2.262,2.228,2.201,2.179,2.16,2.145,2.131,2.12,2.11,2.101,2.093,2.086,2.08,2.074,2.069,2.064,2.06,2.056,2.052,2.048,2.045,2.042];
    const df=n-1,critical=df<=30?t[df-1]:df<=40?2.021:df<=60?2:df<=120?1.98:1.96;
    return critical*sd/Math.sqrt(n);
  }
  // Preserve the same subjects at every test in a max-statistic family.
  function completeTimeMatrix(items,alignment){
    const indices=alignment.time.map((_,i)=>i).filter(i=>alignment.values.every(v=>C.finite(v[i])));
    if(!indices.length)throw new Error('Nessun istante con dati validi per tutti i soggetti utilizzabili.');
    return {times:indices.map(i=>alignment.time[i]),subjects:items.map((x,j)=>({id:x.r.id,subject:x.r.subject,values:indices.map(i=>alignment.values[j][i])})),dropped:alignment.time.length-indices.length};
  }
  function completeSummaryMatrix(records,epochs,rows){
    const subjects=records.map(r=>({id:r.id,subject:r.subject,values:epochs.map(e=>rows.find(x=>x.subject===r.subject&&x.epoch===e)?.value??null)}));
    return {times:epochs.map((_,i)=>i),subjects:subjects.filter(s=>s.values.every(C.finite)),excluded:subjects.filter(s=>!s.values.every(C.finite)).map(s=>s.subject)};
  }
  function independentStimuliMatrix(records, epochs, rows) {
    if (epochs.length < 2) throw new Error('Seleziona almeno due stimoli da confrontare.');
    const subjects = [];
    for (const record of records) {
      const available = epochs.flatMap((epoch, groupIndex) => {
        const value = rows.find(row => row.subject === record.subject && row.epoch === epoch)?.value;
        return C.finite(value) ? [{epoch, groupIndex, value}] : [];
      });
      if (available.length > 1) throw new Error('Il confronto fra stimoli di soggetti diversi richiede un solo stimolo per soggetto. Per misure ripetute scegli il confronto entro soggetto.');
      if (!available.length) continue;
      const {epoch, groupIndex, value} = available[0];
      subjects.push({id: record.id, subject: record.subject, values: [value], groupIndex, sourceEpoch: epoch});
    }
    if (epochs.some((_, groupIndex) => subjects.filter(subject => subject.groupIndex === groupIndex).length < 2)) {
      throw new Error('Servono almeno due soggetti con dati per ciascuno stimolo selezionato.');
    }
    return {subjects, times: [0], epochs: ['Confronto tra stimoli'], stimuli: epochs};
  }
  const api={independentStimuliMatrix,scalarFlags,summaryFlags,temporalFlags,ci95,ci95FromSummary,completeTimeMatrix,completeSummaryMatrix};
  if(typeof module!=='undefined')module.exports=api;else root.MetricsAnalysis=api;
})(globalThis);
