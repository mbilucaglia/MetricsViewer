(function(root){
  'use strict';
  function intervals(points,step,alpha=.05){
    const out=[];let run=null,previous=null;
    for(const p of [...points].sort((a,b)=>a.time-b.time)){
      const significant=Number.isFinite(p.time)&&Number.isFinite(p.pAdjusted)&&p.pAdjusted<=alpha;
      if(!significant){run=null;previous=null;continue;}
      const adjacent=run&&Number.isFinite(step)&&step>0&&Math.abs(p.time-previous-step)<=Math.max(1e-8,step*1e-5);
      if(!adjacent){run={start:p.time,end:p.time,count:0,minP:p.pAdjusted,peak:p.time};out.push(run);}
      run.end=p.time;run.count++;if(p.pAdjusted<run.minP){run.minP=p.pAdjusted;run.peak=p.time;}
      if(Number.isFinite(p.magnitude) && (run.magnitude === undefined || p.magnitude > run.magnitude)){
        run.magnitude=p.magnitude;run.effectPeak=p.time;
      }
      previous=p.time;
    }
    return out;
  }
  // Plot bands and PiP playback share the same temporal sample-cell boundaries.
  function bands(points,step,alpha){
    const half=Number.isFinite(step)&&step>0?step/2:0;
    return intervals(points,step,alpha).map(range=>({...range,left:range.start-half,right:range.end+half}));
  }
  function rankIntervals(ranges){
    return ranges.slice().sort((a,b)=>(b.magnitude ?? -1)-(a.magnitude ?? -1)||a.start-b.start)
      .map(range=>({...range,peak:range.effectPeak ?? range.peak}));
  }
  function playbackRange(range,step,point=false){
    const half=!point&&Number.isFinite(step)&&step>0?step/2:0;
    return {...range,start:Math.max(0,Number.isFinite(range.left)?range.left:range.start-half),
      end:Number.isFinite(range.right)?range.right:range.end+half};
  }
  function previewColor(index) {
    const palette = ['#4935a6', '#b45309', '#087f8c', '#b72b62', '#2563b8',
      '#637b18', '#9c3dad', '#9b452b', '#306e69', '#64618d'];
    return palette[index] ?? 'hsl(' + ((index * 137.508 + 265) % 360).toFixed(2) + ' 68% 30%)';
  }
  if(typeof module==='object'&&module.exports){module.exports={intervals,bands,rankIntervals,previewColor,playbackRange};return;}
  const formatEstimate = new Intl.NumberFormat('it-IT', { maximumSignificantDigits: 3, useGrouping: false }).format;
  const formatPreviewTime = new Intl.NumberFormat('it-IT', { maximumFractionDigits: 2, useGrouping: false }).format;

  function renderPreviewSummary(target, summary) {
    const time = document.createElement('p');
    time.className = 'preview-summary__time';
    time.textContent = formatPreviewTime(summary.time) + ' s';
    const pLabel = summary.cluster ? 'p del cluster' : summary.omnibus ? 'p globale corretto' : 'p corretto';
    const pDescription = Number.isFinite(summary.pAdjusted) ? ' · ' + pLabel + ' ' + formatEstimate(summary.pAdjusted) : '';
    const descriptions = [];
    const estimates = summary.estimates.map(({ label = 'Media', mean, halfWidth }) => {
      const line = document.createElement('p');
      const interval = Number.isFinite(halfWidth)
        ? '(' + formatEstimate(mean - halfWidth) + '; ' + formatEstimate(mean + halfWidth) + ')'
        : '(IC n.d.)';
      const conciseLabel = label === 'Media' ? '' : label.replace(/\s*·\s*Media$/, '') + ' ';
      line.textContent = conciseLabel + formatEstimate(mean) + ' ' + interval;
      descriptions.push(label + ' ' + formatEstimate(mean) + ' · IC 95% ' + interval);
      return line;
    });
    target.replaceChildren(time, ...estimates);
    target.title = [time.textContent + pDescription, ...descriptions].join(' · ');
  }
  function createViewer(ids={}, {floatingOnly=false,dock=null,anchorEvent=null,openAllButton=null}={}){
  const $=id=>document.getElementById(ids[id]||id);
  let context=null,ranges=[],cancel=null,activeRange=null,floating=null;
  let summaryAt = null;
  const rows=new Map();
  let anchors = [];
  function allPreviewsOpen() {
    return ranges.length > 0 && floating?.size === ranges.length;
  }
  function updateOpenAllButton() {
    if (!openAllButton) return;
    const allOpen = allPreviewsOpen();
    openAllButton.disabled = !ranges.length;
    openAllButton.textContent = allOpen ? 'Nascondi tutti' : 'Disegna tutti';
    openAllButton.title = allOpen ? 'Chiudi tutte le anteprime' : 'Apri tutte le anteprime';
  }
  function closeFloating(){floating?.clear();}
  function openFloating(index,anchor,reveal=true){
    const range=ranges[index],entry=rows.get(index);if(!range||!entry)return;
    if(!floating)floating=root.MetricsFloatingMedia.create({dock,onClose:(closedIndex,row)=>{
      const closedRange=ranges[closedIndex];
      if(activeRange===closedRange)cancel?.();
      for(const player of players)if(player.range===closedRange)player.media.pause();
      $('significantIntervals').append(row);
      updateOpenAllButton();
    }});
    const alreadyOpen=floating.has(index);
    floating.open(index,anchor,entry.row,range.label||'Frammento estratto',previewColor(index),reveal);
    if (!alreadyOpen) {
      entry.time = range.peak;
      const data = entry.summary && summaryAt?.(range.peak);
      if (data) renderPreviewSummary(entry.summary, data);
      for (const player of players) if (player.range === range) player.seekTo(range.peak);
    }
    updateOpenAllButton();
    $('tooltip').hidden=true;
  }
  if (anchorEvent) document.addEventListener(anchorEvent, event => {
    anchors = event.detail.anchors;
    floating?.reanchor(anchors);
  });
  if (openAllButton) openAllButton.onclick = () => {
    if (allPreviewsOpen()) closeFloating();
    else for (const index of ranges.keys()) openFloating(index, anchors[index] ?? null, false);
  };
  const players=new Set();
  function disposePlayers(){for(const p of players)p.dispose();players.clear();}
  function clear(){closeFloating();cancel?.();disposePlayers();context=null;ranges=[];summaryAt=null;rows.clear();updateOpenAllButton();$('significantMedia').hidden=true;$('significantIntervals').replaceChildren();$('mediaStatus').textContent='';}
  function show(points,meta,describePoint){
    clear();
    if (meta.view !== 'series') return;
    context = meta;
    const step = Number(meta.grid_step);
    const alpha = meta.alpha ?? .05;
    ranges = rankIntervals(intervals(points, step, alpha)).map(range=>playbackRange(range,step));
    if (describePoint) {
      const tolerance = step > 0 ? Math.min(step / 4, Math.max(1e-8, step * 1e-5)) : 0;
      // Statistical results are on the analysis grid. Keep their indices for matching the plotted estimates.
      const indices = new Map();
      for (const [index, point] of points.entries()) {
        if (Number.isFinite(point.pAdjusted) && point.pAdjusted <= alpha) indices.set(point.time, index);
      }
      summaryAt = time => {
        let index = indices.get(time);
        if (index === undefined && tolerance > 0) {
          const near = points.find(point => Math.abs(point.time - time) <= tolerance);
          index = indices.get(near?.time);
        }
        return index === undefined ? null : describePoint(index);
      };
    }
    render();
  }
  function showRanges(items,meta){clear();context=meta;ranges=items.map(range=>playbackRange(range,Number(meta.grid_step),!!meta.criterion));render();}
  const format=n=>Number(n.toFixed(6)).toString();
  function render(){
    if(!context)return;
    closeFloating();disposePlayers();rows.clear();$('significantMedia').hidden=floatingOnly;$('significantIntervals').replaceChildren();
    updateOpenAllButton();
    const available=!!root.MetricsVideo?.source(context.epoch);
    const alpha = String(context.alpha ?? .05).replace('.', ',');
    const emptyMessage = context.criterion ? 'Nessun istante trovato con questi criteri.'
      : context.correction === 'cluster-mass' ? 'Nessun cluster significativo (p ≤ ' + alpha + ').'
      : 'Nessun istante significativo (p finale ≤ ' + alpha + ').';
    $('mediaStatus').textContent = !ranges.length ? emptyMessage
      : !available ? 'Associa un video o un’immagine a questa epoca per estrarre frame e clip.' : '';
    for(const [index,r] of ranges.entries()){
      const row=document.createElement('div');row.className='significant-interval';row.tabIndex=-1;row.dataset.index=index;row.dataset.start=r.start;row.dataset.end=r.end;if(r.groupName)row.dataset.previewGroup=r.groupName;if(r.rank)row.dataset.previewRank=r.rank;if(r.shape)row.dataset.previewShape=r.shape;if(r.groupColor)row.dataset.previewGroupColor=r.groupColor;if(Number.isFinite(r.groupSize))row.dataset.previewGroupSize=r.groupSize;
      const data = r.summary ?? summaryAt?.(r.peak);
      let summary = null;
      if (data) {
        summary = document.createElement('div');
        summary.className = 'preview-summary';
        summary.tabIndex = 0;
        summary.setAttribute('role', 'group');
        summary.setAttribute('aria-label', 'Statistiche dell’istante');
        renderPreviewSummary(summary, data);
        row.append(summary);
      }
      const label=document.createElement('span');label.textContent=r.label||`${format(r.start)}–${format(r.end)} s · ${r.count} istanti · p min ${r.minP.toPrecision(3)}`;row.append(label);
      if(available)row.append(miniPlayer(r,root.MetricsVideo.source(context.epoch).url));
      const exportButtons=[];
      for(const [text,kind]of [['Vai allo stimolo','seek'],['Frame PNG (p minimo)','frame'],['Clip video','clip']]){
        const button=document.createElement('button');button.type='button';button.textContent=kind==='frame'?(context.criterion?'Frame PNG (istante selezionato)':Number.isFinite(r.magnitude)?'Frame PNG (differenza massima)':text):text;button.disabled=!available||(kind==='clip'&&r.start===r.end);
        button.onclick=()=>kind==='seek'?root.MetricsVideo.seek(r.peak):extract(r,kind);row.append(button);if(kind!=='seek')exportButtons.push(button);
      }
      const status=floatingOnly?document.createElement('p'):$('mediaStatus');
      const cancelButton=floatingOnly?document.createElement('button'):$('cancelMedia');
      if(floatingOnly){
        status.className='panel-note';status.setAttribute('role','status');
        if(!available)status.textContent='Associa un video o un’immagine a questa epoca per estrarre frame e clip.';
        cancelButton.type='button';cancelButton.className='segment-cancel';cancelButton.textContent='Annulla estrazione';cancelButton.hidden=true;row.append(status,cancelButton);
      }
      rows.set(index,{row,status,cancelButton,exportButtons,summary,time:r.peak});
      $('significantIntervals').append(row);
    }
  }
  function miniPlayer(range,url){
    let playEnd=range.end;
    const wrapper=document.createElement('div');wrapper.className='segment-player';
    const source=root.MetricsVideo.source(context.epoch);
    const media=source?.kind==='image'?root.MetricsStaticMedia.create(source.duration):document.createElement('video');media.src=url;media.preload='metadata';media.playsInline=true;media.setAttribute('aria-label',`Segmento da ${format(range.start)} a ${format(playEnd)} secondi`);
    const controls=document.createElement('div');controls.className='segment-controls';
    const play=document.createElement('button');play.type='button';play.textContent='▶ Riproduci';play.disabled=true;
    const seek=document.createElement('input');seek.type='range';seek.min=range.start;seek.max=playEnd;seek.step='any';seek.value=range.start;seek.disabled=true;seek.setAttribute('aria-label','Posizione nel segmento');
    const volume=document.createElement('input');volume.type='range';volume.min=0;volume.max=1;volume.step='.05';volume.value=1;volume.setAttribute('aria-label','Volume del segmento');volume.className='segment-volume';
    const time=document.createElement('output');const displayTime=value=>`${value.toFixed(2).replace('.',',')} s`;time.textContent=displayTime(range.start);
    const note=document.createElement('p');note.className='panel-note';note.textContent=range.start===playEnd?'Istante isolato · fotogramma':'Audio originale · riproduzione limitata al segmento';
    let restart=true,animation=null,seekAnimation=null,pendingTime=range.start,dragging=false,resumeAfterDrag=false,lastTimePaint=-Infinity;
    const stop=()=>{if(animation!==null)cancelAnimationFrame(animation);animation=null;};
    const paint=(value,force=false)=>{
      const clamped=Math.max(range.start,Math.min(playEnd,value));
      seek.value=clamped;
      const now=performance.now();
      if(force||now-lastTimePaint>=100){const text=displayTime(clamped);if(time.textContent!==text)time.textContent=text;lastTimePaint=now;}
    };
    const flushSeek=()=>{if(seekAnimation!==null)cancelAnimationFrame(seekAnimation);seekAnimation=null;media.currentTime=pendingTime;};
    const sync=()=>{animation=null;if(dragging)return;paint(media.currentTime);if(media.currentTime>=playEnd){media.pause();media.currentTime=playEnd;paint(playEnd,true);}else if(!media.paused)animation=requestAnimationFrame(sync);};
    media.addEventListener('loadedmetadata',()=>{
      if(range.start>media.duration||range.start<0||range.peak>media.duration){note.classList.add('segment-error');note.textContent='Intervallo non coperto dalla durata dello stimolo.';return;}
      playEnd=Math.min(playEnd,media.duration);seek.max=playEnd;
      pendingTime=Math.max(range.start,Math.min(playEnd,pendingTime));
      media.currentTime=pendingTime;paint(pendingTime,true);play.disabled=seek.disabled=range.start===playEnd;
    });
    media.addEventListener('play',()=>{root.MetricsVideo?.pause();for(const p of players)if(p.media!==media)p.media.pause();play.textContent='Ⅱ Pausa';stop();sync();});
    media.addEventListener('pause',()=>{stop();play.textContent='▶ Riproduci';if(!dragging)paint(media.currentTime,true);});
    media.addEventListener('seeked',()=>{if(!dragging&&seekAnimation===null)paint(media.currentTime,true);});
    media.addEventListener('error',()=>{note.classList.add('segment-error');note.textContent='Stimolo non riproducibile.';play.disabled=seek.disabled=true;});
    play.onclick=()=>{if(play.disabled)return;if(!media.paused){media.pause();return;}if(restart||media.currentTime>=playEnd||media.currentTime<range.start)media.currentTime=range.start;restart=false;media.play().catch(e=>{note.classList.add('segment-error');note.textContent=e.message;});};
    media.tabIndex=0;media.setAttribute('role','button');media.setAttribute('aria-label',`Stimolo ${format(range.start)}–${format(playEnd)} secondi. Clic o Invio per riprodurre o mettere in pausa.`);
    media.addEventListener('click',()=>play.onclick());
    media.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();play.onclick();}});
    seek.addEventListener('pointerdown',event=>{
      pendingTime=media.currentTime;dragging=true;resumeAfterDrag=!media.paused;media.pause();seek.setPointerCapture(event.pointerId);
    });
    seek.oninput=()=>{
      restart=false;pendingTime=Math.max(range.start,Math.min(playEnd,Number(seek.value)));paint(pendingTime,true);
      if(seekAnimation===null)seekAnimation=requestAnimationFrame(flushSeek);
    };
    const finishDrag=()=>{
      if(!dragging)return;flushSeek();dragging=false;paint(pendingTime,true);
      if(resumeAfterDrag&&pendingTime<playEnd)media.play().catch(e=>{note.classList.add('segment-error');note.textContent=e.message;});
      resumeAfterDrag=false;
    };
    seek.addEventListener('pointerup',finishDrag);seek.addEventListener('pointercancel',finishDrag);seek.addEventListener('lostpointercapture',finishDrag);
    seek.onchange=()=>{flushSeek();paint(pendingTime,true);};
    if(source?.kind==='image')note.textContent='Immagine statica · durata '+source.duration+' s';
    volume.oninput=()=>{media.volume=Number(volume.value);};
    const volumeLabel=document.createElement('label');volumeLabel.className='segment-volume-label';volumeLabel.append(document.createTextNode('Volume'),volume);
    controls.append(play,seek,time,...(source?.kind==='image'?[]:[volumeLabel]));wrapper.append(media,controls,note);
    players.add({media,range,seekTo:value=>{restart=true;pendingTime=Math.max(range.start,Math.min(playEnd,value));value=pendingTime;media.pause();if(media.readyState>=1&&value<media.duration){media.currentTime=value;paint(value,true);}},dispose:()=>{stop();if(seekAnimation!==null)cancelAnimationFrame(seekAnimation);media.pause();media.removeAttribute('src');media.load();}});
    return wrapper;
  }
  function focusTime(time,index=null,anchor=null){
    const range=Number.isInteger(index)?ranges[index]:ranges.find(r=>time>=r.start&&time<=r.end);if(!range)return;
    const rangeIndex = Number.isInteger(index) ? index : ranges.indexOf(range);
    if(floatingOnly&&anchor)openFloating(rangeIndex,anchor);
    const entry = rows.get(rangeIndex);
    if (entry) entry.time = time;
    const summary = entry?.summary;
    const data = summary && summaryAt?.(time);
    if (data) renderPreviewSummary(summary, data);
    root.MetricsVideo?.pause();
    for(const player of players){player.media.pause();if(player.range===range)player.seekTo(time);}
    if(floatingOnly)return;
    const intervalRows=$('significantIntervals').children;
    for(const [rowIndex,row] of Array.from(intervalRows).entries()){
      const selected=Number.isInteger(index)?rowIndex===index:Number(row.dataset.start)===range.start&&Number(row.dataset.end)===range.end;
      row.classList.toggle('is-selected',selected);
      if(selected){row.scrollIntoView({block:'center',behavior:'smooth'});row.focus({preventScroll:true});}
    }
  }
  function getExportPreviews() {
    if (!context || !floating) return [];
    return ranges.flatMap((range,index) => {
      if (!floating.has(index)) return [];
      const entry = rows.get(index), anchor = anchors[index];
      if (!entry || !anchor?.isConnected) return [];
      return [{index, rank:range.rank??index+1,shape:range.shape??'circle', time:entry.time, epoch:context.epoch, color:previewColor(index), anchor,
        caption: (range.groupName?range.groupName+' · ':'')+(entry.summary ? [...entry.summary.children].map(line => line.textContent).join(' · ') : format(entry.time) + ' s'),
        url:root.MetricsVideo?.source(context.epoch)?.url ?? null}];
    });
  }
  function waitEvent(media,name,signal,action){
    return new Promise((resolve,reject)=>{
      let timer;
      const finish=error=>{clearTimeout(timer);media.removeEventListener(name,ok);media.removeEventListener('error',bad);signal.removeEventListener('abort',abort);error?reject(error):resolve();};
      const ok=()=>finish(),bad=()=>finish(new Error('Impossibile leggere il video.')),abort=()=>finish(new Error('Estrazione annullata.'));
      media.addEventListener(name,ok,{once:true});media.addEventListener('error',bad,{once:true});signal.addEventListener('abort',abort,{once:true});
      timer=setTimeout(()=>finish(new Error('Tempo scaduto durante la lettura del video.')),15000);
      if(signal.aborted){abort();return;}try{action?.();}catch(e){finish(e);}
    });
  }
  function download(blob,name){const url=URL.createObjectURL(blob),a=document.createElement('a');a.href=url;a.download=name;a.click();setTimeout(()=>URL.revokeObjectURL(url),60000);}
  async function extract(range,kind){
    if(cancel)return;
    for(const player of players)player.media.pause();
    const meta=context,source=root.MetricsVideo?.source(meta.epoch);if(!source)return;
    const entry=rows.get(ranges.indexOf(range));if(!entry)return;
    const {status,cancelButton}=entry;
    const controller=new AbortController(),signal=controller.signal;cancel=()=>controller.abort();activeRange=range;
    cancelButton.hidden=false;cancelButton.onclick=cancel;
    const buttons=[...rows.values()].flatMap(item=>item.exportButtons).map(button=>({button,disabled:button.disabled}));
    for(const {button}of buttons)button.disabled=true;
    const media=source.kind==='image'?root.MetricsStaticMedia.create(source.duration):document.createElement('video');media.muted=true;media.playsInline=true;media.preload='auto';media.crossOrigin='anonymous';
    let stream=null,recorder=null,animation=null,audio=null;
    try{
      if(kind==='clip'&&source.kind!=='image'){
        const Audio=root.AudioContext||root.webkitAudioContext;if(!Audio)throw new Error('Esportazione con audio non supportata da questo browser.');
        audio=new Audio();await audio.resume();
      }
      status.textContent='Preparazione dello stimolo…';
      const readableSource=await root.MetricsVideo.exportSource?.(meta.epoch)??source;
      if(signal.aborted)return;
      await waitEvent(media,'loadeddata',signal,()=>{media.src=readableSource.url;media.load();});
      const start=kind==='frame'?range.peak:range.start,end=Math.min(range.end,media.duration);
      if(start<0||start>media.duration||(kind==='clip'&&end<=start))throw new Error('Intervallo fuori dalla durata dello stimolo: scegli un video che copra gli istanti significativi.');
      if(Math.abs(media.currentTime-start)>1e-7)await waitEvent(media,'seeked',signal,()=>{media.currentTime=start;});
      const canvas=document.createElement('canvas');canvas.width=media.videoWidth;canvas.height=media.videoHeight;
      const ctx=canvas.getContext('2d');ctx.drawImage(media,0,0);
      const prefix=`${meta.metric}-${meta.epoch}`.replace(/[^\p{L}\p{N}_-]/gu,'_');
      if(kind==='frame'){
        const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));if(signal.aborted)return;if(!blob)throw new Error('Impossibile creare il fotogramma.');
        download(blob,`${prefix}-${format(start)}s.png`);
      }else{
        const mime=['video/webm;codecs=vp9,opus','video/webm;codecs=vp8,opus','video/webm','video/mp4'].find(type=>root.MediaRecorder?.isTypeSupported(type));
        if(!mime||!canvas.captureStream)throw new Error('Esportazione clip non supportata da questo browser. Puoi scaricare il frame PNG.');
        stream=canvas.captureStream(30);
        if(audio){const destination=audio.createMediaStreamDestination(),audioSource=audio.createMediaElementSource(media);audioSource.connect(destination);media.muted=false;
        for(const track of destination.stream.getAudioTracks())stream.addTrack(track);}
        recorder=new MediaRecorder(stream,{mimeType:mime});const chunks=[];
        recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
        status.textContent=`Registrazione clip ${format(start)}–${format(end)} s in corso… Mantieni la scheda visibile.`;
        await new Promise((resolve,reject)=>{
          let timer;const cleanup=()=>{clearTimeout(timer);signal.removeEventListener('abort',abort);media.removeEventListener('error',error);};
          const fail=e=>{cleanup();reject(e);},abort=()=>fail(new Error('Estrazione annullata.')),error=()=>fail(new Error('Errore durante la registrazione del video.'));
          signal.addEventListener('abort',abort,{once:true});media.addEventListener('error',error,{once:true});
          recorder.onerror=error;recorder.onstop=()=>{cleanup();resolve();};
          timer=setTimeout(()=>fail(new Error('Registrazione interrotta: video bloccato o scheda in background.')),(end-start)*1000+15000);
          const draw=()=>{if(signal.aborted)return;try{ctx.drawImage(media,0,0);if(media.currentTime>=end||media.ended){media.pause();recorder.stop();return;}animation=requestAnimationFrame(draw);}catch(e){fail(e);}};
          recorder.start();media.play().then(draw).catch(fail);
        });
        if(signal.aborted)return;
        const blob=new Blob(chunks,{type:recorder.mimeType});if(!blob.size)throw new Error('La clip generata è vuota.');
        download(blob,`${prefix}-${format(start)}-${format(end)}s.${mime.startsWith('video/mp4')?'mp4':'webm'}`);
      }
      status.textContent='Download pronto.';
    }catch(e){if(context===meta)status.textContent=e.message;}
    finally{
      if(animation!==null)cancelAnimationFrame(animation);media.pause();if(recorder?.state==='recording')recorder.stop();stream?.getTracks().forEach(t=>t.stop());media.removeAttribute('src');media.load();
      if(audio)await audio.close();cancel=null;activeRange=null;cancelButton.hidden=true;
      if(context===meta)for(const {button,disabled}of buttons)button.disabled=disabled;
    }
  }
  document.addEventListener('metrics-video-changed',()=>{cancel?.();render();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){cancel?.();for(const p of players)p.media.pause();}});
  $('viewTab').addEventListener('click',()=>{closeFloating();for(const p of players)p.media.pause();});
  return {show,showRanges,clear,intervals,bands,focusTime,openFloating,closeFloating,getExportPreviews};
  }
  root.MetricsSignificantMedia={...createViewer({}, {floatingOnly:true,dock:document.getElementById('statsMomentsDock'),anchorEvent:'metrics-stat-bands-rendered',openAllButton:document.getElementById('openAllStatsMoments')}),createViewer,rankIntervals,previewColor,playbackRange};
})(globalThis);
