(function(root){
  'use strict';
  function detect(time,values,{criterion='max',count=5,distance=1,before,after,step}={}){
    if(!['max','min','peaks','troughs'].includes(criterion))throw new Error('Criterio non valido.');
    if(!Number.isInteger(count)||count<1||count>50||![distance,before??0,after??0].every(x=>Number.isFinite(x)&&x>=0))throw new Error('Usa 1–50 risultati e durate finite non negative.');
    const valid=i=>Number.isFinite(time[i])&&Number.isFinite(values[i]);
    const adjacent=(a,b)=>valid(a)&&valid(b)&&(!Number.isFinite(step)||Math.abs(time[b]-time[a]-step)<=Math.max(1e-8,step*1e-5));
    const low=criterion==='min'||criterion==='troughs',local=criterion==='peaks'||criterion==='troughs';
    const candidates=[];
    for(let i=0;i<time.length;i++){
      if(!valid(i))continue;
      let end=i;
      while(end+1<time.length&&adjacent(end,end+1)&&values[end+1]===values[i])end++;
      const index=Math.floor((i+end)/2),value=values[i];
      if(!local||(i>0&&end+1<time.length&&adjacent(i-1,i)&&adjacent(end,end+1)&&(low?value<values[i-1]&&value<values[end+1]:value>values[i-1]&&value>values[end+1])))candidates.push({index,time:time[index],value});
      i=end;
    }
    candidates.sort((a,b)=>(low?a.value-b.value:b.value-a.value)||a.time-b.time);
    const selected=[];
    for(const c of candidates){
      if(selected.some(p=>Math.abs(p.time-c.time)<distance))continue;
      let first=c.index,last=c.index;
      while(first>0&&adjacent(first-1,first))first--;
      while(last+1<time.length&&adjacent(last,last+1))last++;
      const previous=c.index>0?c.time-time[c.index-1]:NaN;
      const next=c.index+1<time.length?time[c.index+1]-c.time:NaN;
      const width=Number.isFinite(step)&&step>0?step:Math.min(...[previous,next].filter(value=>Number.isFinite(value)&&value>0));
      const half=Number.isFinite(width)?width/2:0;
      selected.push({...c,peak:c.time,
        start:before===undefined?Math.max(0,c.time-half):Math.max(time[first],c.time-before),
        end:after===undefined?c.time+half:Math.min(time[last],c.time+after)});
      if(selected.length===(local?count:1))break;
    }
    return selected;
  }
  if(typeof module==='object'&&module.exports){module.exports={detect};return;}
  const $=id=>document.getElementById(id);
  const media=root.MetricsSignificantMedia.createViewer({significantMedia:'momentsMedia',significantIntervals:'momentsIntervals',mediaStatus:'momentsMediaStatus',cancelMedia:'momentsCancel'},{floatingOnly:true,dock:$('momentsDock'),anchorEvent:'metrics-markers-rendered',openAllButton:$('openAllMoments')});
  root.MetricsMoments = {getExportPreviews:media.getExportPreviews};
  let context=null;
  function clear(){context=null;media.clear();$('extractMoments').disabled=true;$('momentsStatus').textContent='';}
  document.addEventListener('metrics-invalidated',clear);
  document.addEventListener('metrics-ready',event=>{
    clear();context=event.detail;$('momentsPanel').hidden=context.mode!=='series';if(context.mode!=='series')return;
    $('extractMoments').disabled=false;
  });
  for(const id of ['momentsCriterion','momentsCount'])$(id).addEventListener('change',()=>{media.clear();context?.markMoments([],null,null);$('momentsStatus').textContent='';});
  $('statsTab').addEventListener('click', () => {
    media.clear();
    context?.markMoments([], null, null);
  });
  $('extractMoments').onclick=()=>{
    if(!context||context.mode!=='series')return;
    $('momentsStatus').textContent='';
    media.clear();context.markMoments([],null,null);
    try{
      const {alignment}=context.analysisInput,source='mean',count=Number($('momentsCount').value);
      const choice=$('momentsCriterion').value;
      const criterion=count===1?(choice==='peaks'?'max':'min'):choice;
      const values=alignment.summary.map(s=>s.mean);
      const ranges=detect(alignment.time,values,{criterion,count,distance:1,step:alignment.step});
      const sourceName='Media dei soggetti selezionati',criterionName=$('momentsCriterion').selectedOptions[0].textContent;
      for (const range of ranges) {
        const sample = alignment.summary[range.index];
        range.summary = {
          time: range.peak,
          estimates: [{ mean: sample.mean, halfWidth: root.MetricsAnalysis.ci95FromSummary(sample.n, sample.sd) }]
        };
      }
      for(const r of ranges)r.label=`${criterionName} · ${r.peak.toFixed(2)} s · valore ${Number(r.value.toPrecision(5))} · clip ${r.start.toFixed(2)}–${r.end.toFixed(2)} s`;
      media.showRanges(ranges,{view:'series',epoch:context.epoch,metric:context.metric,criterion});
      context.markMoments(ranges,{name:sourceName,subjectId:source==='mean'?null:source,x:alignment.time,y:values,color:'#312b79',bold:true},(index,anchor)=>media.openFloating(index,anchor));
    }catch(error){$('momentsStatus').textContent=error.message;}
  };
})(globalThis);
