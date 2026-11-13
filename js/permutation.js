(function (global) {
  function statistic(samples, mode, nullValue = 0) {
    const clean = samples.map(group => group.filter(Number.isFinite));
    if (clean.some(group => group.length === 0)) return NaN;
    if (mode === 'one') {
      const values = clean[0].map(value => value - nullValue);
      if (values.length < 2) return NaN;
      const mean = values.reduce((sum, value) => sum + value, 0) / values.length;
      const variance = values.reduce((sum, value) => sum + (value - mean) ** 2, 0) / (values.length - 1);
      const se = Math.sqrt(variance / values.length);
      return se > 0 ? mean / se : mean === 0 ? 0 : Math.sign(mean) * Infinity;
    }
    const counts = clean.map(group => group.length);
    const all = clean.flat();
    const total = all.length;
    const grandMean = all.reduce((sum, value) => sum + value, 0) / total;
    let between = 0;
    let within = 0;
    for (let index = 0; index < clean.length; index++) {
      const group = clean[index];
      const mean = group.reduce((sum, value) => sum + value, 0) / group.length;
      between += group.length * (mean - grandMean) ** 2;
      within += group.reduce((sum, value) => sum + (value - mean) ** 2, 0);
    }
    const dfBetween = clean.length - 1;
    const dfWithin = total - clean.length;
    if (dfBetween < 1 || dfWithin < 1) return NaN;
    const msWithin = within / dfWithin;
    return msWithin > 0 ? (between / dfBetween) / msWithin : between === 0 ? 0 : Infinity;
  }

  function shuffle(values, random) {
    for (let index = values.length - 1; index > 0; index--) {
      const other = Math.floor(random() * (index + 1));
      [values[index], values[other]] = [values[other], values[index]];
    }
    return values;
  }

  function createPermutationPlan(subjects, mode, random) {
    if (mode === 'one') return { signs: subjects.map(() => random() < 0.5 ? -1 : 1) };
    const groupCount = Math.max(...subjects.map(subject => subject.groupIndex)) + 1;
    const sizes = Array.from({ length: groupCount }, (_, index) => subjects.filter(subject => subject.groupIndex === index).length);
    const shuffledSubjects = shuffle(subjects.map((_, index) => index), random);
    const groupBySubjectIndex = new Int32Array(subjects.length);
    let offset = 0;
    sizes.forEach((size, groupIndex) => {
      for (let index = offset; index < offset + size; index++) groupBySubjectIndex[shuffledSubjects[index]] = groupIndex;
      offset += size;
    });
    return { groupBySubjectIndex, groupCount };
  }

  async function run({ subjects, times, mode, nullValue = 0, permutations = 5000, seed = 12345, onProgress = () => {}, isCancelled = () => false }) {
    if (!['one','multi'].includes(mode) || !Number.isFinite(nullValue) || !Number.isInteger(permutations) || permutations < 1 || !Number.isInteger(seed)) throw new Error('Parametri del test non validi.');
    if (subjects.length < 2 || !times.length || subjects.some(s => s.values.length !== times.length || s.values.some(x => !Number.isFinite(x)))) throw new Error('Il test richiede una matrice completa di valori finiti.');
    if (mode === 'multi') {
      const indexes = [...new Set(subjects.map(s => s.groupIndex))].sort((a,b)=>a-b);
      if (indexes.length < 2 || indexes.some((g,i)=>g !== i || subjects.filter(s=>s.groupIndex===g).length < 2)) throw new Error('Servono almeno 2 soggetti per ogni gruppo.');
    }
    let state = seed >>> 0;
    const random = () => { state += 0x6D2B79F5; let t=state; t=Math.imul(t^(t>>>15),t|1); t^=t+Math.imul(t^(t>>>7),t|61); return ((t^(t>>>14))>>>0)/4294967296; };
    const valuesAtTime = times.map((_, timeIndex) => subjects.map(subject => subject.values[timeIndex]));
    const observed = valuesAtTime.map(values => statistic(mode === 'one' ? [values] : subjects.reduce((groups, subject) => {
      const groupIndex = subject.groupIndex;
      (groups[groupIndex] ||= []).push(values[subjects.indexOf(subject)]);
      return groups;
    }, []), mode, nullValue));
    if (observed.some(Number.isNaN)) {
      throw new Error('Dati insufficienti: servono almeno 2 soggetti nel test a un gruppo e almeno 2 gruppi con varianza residua nel test multi-gruppo.');
    }

    const pointwiseExceed = new Uint32Array(times.length);
    const maxExceed = new Uint32Array(times.length);
    const thresholds = observed.map(value => Math.abs(value));
    const batchSize = Math.max(1, Math.min(100, Math.floor(20000 / (times.length * subjects.length))));
    for (let start = 0; start < permutations; start += batchSize) {
      if (isCancelled()) throw new Error('Analisi annullata: dati o impostazioni modificati.');
      const stop = Math.min(permutations, start + batchSize);
      for (let iteration = start; iteration < stop; iteration++) {
        let permutedMax = 0;
        const plan = createPermutationPlan(subjects, mode, random);
        for (let timeIndex = 0; timeIndex < times.length; timeIndex++) {
          let groups;
          if (mode === 'one') {
            const residuals = valuesAtTime[timeIndex].map(value => value - nullValue);
            groups = [residuals.map((value, index) => value * plan.signs[index])];
          } else {
            groups = Array.from({ length: plan.groupCount }, () => []);
            valuesAtTime[timeIndex].forEach((value, subjectIndex) => groups[plan.groupBySubjectIndex[subjectIndex]].push(value));
          }
          const value = statistic(groups, mode);
          const magnitude = Math.abs(value);
          if (magnitude >= Math.abs(observed[timeIndex])) pointwiseExceed[timeIndex]++;
          if (magnitude > permutedMax) permutedMax = magnitude;
        }
        for (let timeIndex = 0; timeIndex < times.length; timeIndex++) {
          if (permutedMax >= thresholds[timeIndex]) maxExceed[timeIndex]++;
        }
      }
      onProgress(stop, permutations);
      await new Promise(resolve => setTimeout(resolve, 0));
    }

    const denominator = permutations + 1;
    return times.map((time, index) => ({
      time,
      statistic: observed[index],
      pUncorrected: (pointwiseExceed[index] + 1) / denominator,
      pAdjusted: (maxExceed[index] + 1) / denominator
    }));
  }

  async function runPairwise({subjects,times,groupNames,permutations=5000,seed=12345,onProgress=()=>{},isCancelled=()=>false}){
    const count=groupNames.length,pairs=[];
    for(let a=0;a<count;a++)for(let b=a+1;b<count;b++)pairs.push([a,b]);
    if(!pairs.length)throw new Error('Servono almeno due gruppi.');
    if(subjects.length*times.length*permutations*pairs.length>300000000)throw new Error('Troppi confronti: riduci epoche o permutazioni.');
    const results=[];
    for(let i=0;i<pairs.length;i++){
      const [a,b]=pairs[i],subset=subjects.filter(s=>s.groupIndex===a||s.groupIndex===b).map(s=>({...s,groupIndex:s.groupIndex===a?0:1}));
      const points=await run({subjects:subset,times,mode:'multi',permutations,seed:(seed+i)>>>0,isCancelled,onProgress:done=>onProgress(i*permutations+done,pairs.length*permutations)});
      points.forEach((p,j)=>{
        const left=subset.filter(s=>s.groupIndex===0).map(s=>s.values[j]),right=subset.filter(s=>s.groupIndex===1).map(s=>s.values[j]);
        const diff=left.reduce((a,b)=>a+b,0)/left.length-right.reduce((a,b)=>a+b,0)/right.length;
        results.push({...p,statistic:Math.sign(diff)*Math.sqrt(p.statistic),meanDifference:diff,pAdjusted:Math.min(1,p.pAdjusted*pairs.length),correction:'max-|T| sulle epoche × Bonferroni sulle coppie',test:'t gruppi indipendenti (permutazioni)',groupA:groupNames[a],groupB:groupNames[b],groupIndexA:a,groupIndexB:b,epochIndex:j,n:subset.length,nA:left.length,nB:right.length,df1:subset.length-2,df2:null});
      });
    }
    return results;
  }

  const api = Object.freeze({ run, statistic, runPairwise });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else global.TimeSeriesPermutation = api;
})(globalThis);
