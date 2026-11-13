(function(root){
  'use strict';
  const P=typeof module!=='undefined'?require('./permutation'):root.TimeSeriesPermutation;
  const mean=v=>v.reduce((a,b)=>a+b,0)/v.length;
  function repeatedF(rows){
    const n=rows.length,k=rows[0].length;
    // Remove subject intercepts before computing condition and residual sums of squares.
    const centered=rows.map(row=>{const m=mean(row);return row.map(x=>x-m);});
    const columns=Array.from({length:k},(_,j)=>mean(centered.map(row=>row[j])));
    const grand=mean(columns);
    const effect=n*columns.reduce((s,x)=>s+(x-grand)**2,0);
    const residual=centered.reduce((s,row)=>s+row.reduce((t,x,j)=>t+(x-columns[j])**2,0),0);
    return residual>0?(effect/(k-1))/(residual/((n-1)*(k-1))):effect===0?0:Infinity;
  }
  function rng(seed){let state=seed>>>0;return()=>{state+=0x6D2B79F5;let t=state;t=Math.imul(t^(t>>>15),t|1);t^=t+Math.imul(t^(t>>>7),t|61);return((t^(t>>>14))>>>0)/4294967296;};}
  function shuffled(row,random){const out=row.slice();for(let i=out.length-1;i>0;i--){const j=Math.floor(random()*(i+1));[out[i],out[j]]=[out[j],out[i]];}return out;}
  async function run({subjects,epochs,permutations=5000,seed=12345,onProgress=()=>{},isCancelled=()=>false}){
    const n=subjects.length,k=epochs.length;
    if(k<2||new Set(epochs).size!==k)throw new Error('Seleziona almeno due epoche distinte per il confronto entro soggetto.');
    if(n<2||subjects.some(s=>s.values.length!==k||s.values.some(x=>!Number.isFinite(x))))throw new Error('Servono almeno due soggetti con dati completi nelle epoche selezionate.');
    if(!Number.isInteger(permutations)||permutations<1||!Number.isInteger(seed)||seed<0||seed>4294967295)throw new Error('Parametri delle permutazioni non validi.');
    const pairCount=k*(k-1)/2;
    if(n*(pairCount+k)*permutations>300000000)throw new Error('Analisi troppo estesa: riduci epoche o permutazioni.');
    const rows=subjects.map(s=>s.values),pairs=[];
    for(let a=0;a<k;a++)for(let b=a+1;b<k;b++)pairs.push({a,b});
    const total=permutations*(k>2?2:1);let omnibus=null;
    if(k>2){
      const observed=repeatedF(rows),random=rng(seed),batch=Math.max(1,Math.min(100,Math.floor(20000/(n*k))));let exceed=0;
      for(let start=0;start<permutations;start+=batch){
        if(isCancelled())throw new Error('Analisi annullata: dati o impostazioni modificati.');
        const stop=Math.min(permutations,start+batch);
        for(let i=start;i<stop;i++){const f=repeatedF(rows.map(row=>shuffled(row,random)));if(f>=observed || (Number.isFinite(f)&&Number.isFinite(observed)&&Math.abs(f-observed)<=1e-12*Math.max(1,Math.abs(observed))))exceed++;}
        onProgress(stop,total,'Test omnibus a misure ripetute');await new Promise(resolve=>setTimeout(resolve,0));
      }
      const p=(exceed+1)/(permutations+1);
      omnibus={label:'Omnibus · tutte le epoche',test:'F a misure ripetute',statistic:observed,pUncorrected:p,pAdjusted:p,correction:'nessuna (un test omnibus)',df1:k-1,df2:(n-1)*(k-1),meanDifference:null,epochA:'',epochB:'',n};
    }
    const differences=subjects.map(s=>({values:pairs.map(({a,b})=>s.values[a]-s.values[b])}));
    // Flip all paired contrasts jointly per subject. The max-|T| distribution
    // preserves their dependence and corrects the whole pairwise family.
    const tested=await P.run({subjects:differences,times:pairs.map((_,i)=>i),mode:'one',permutations,seed:seed^0x5A17,isCancelled,onProgress:(done)=>onProgress((k>2?permutations:0)+done,total,k>2?'Post-hoc appaiati':'Confronto appaiato')});
    const comparisons=tested.map((p,i)=>({...p,label:`${epochs[pairs[i].a]} − ${epochs[pairs[i].b]}`,test:'t appaiato (due code)',pAdjusted:p.pAdjusted,correction:k>2?'max-|T|':'nessuna (una coppia)',df1:n-1,df2:null,meanDifference:mean(differences.map(s=>s.values[i])),epochA:epochs[pairs[i].a],epochB:epochs[pairs[i].b],n}));
    return {omnibus,comparisons};
  }
  const api={run,repeatedF};if(typeof module!=='undefined')module.exports=api;else root.MetricsRepeated=api;
})(globalThis);
