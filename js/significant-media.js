(function(root){
  'use strict';
  function intervals(points,step){
    const out=[];let run=null,previous=null;
    for(const p of [...points].sort((a,b)=>a.time-b.time)){
      const significant=Number.isFinite(p.time)&&Number.isFinite(p.pAdjusted)&&p.pAdjusted<=.05;
      if(!significant){run=null;previous=null;continue;}
      const adjacent=run&&Number.isFinite(step)&&step>0&&Math.abs(p.time-previous-step)<=Math.max(1e-8,step*1e-5);
      if(!adjacent){run={start:p.time,end:p.time,count:0,minP:p.pAdjusted,peak:p.time};out.push(run);}
      run.end=p.time;run.count++;if(p.pAdjusted<run.minP){run.minP=p.pAdjusted;run.peak=p.time;}previous=p.time;
    }
    return out;
  }
  // Display each sample's temporal cell; keep clip endpoints at measured instants.
  function bands(points,step){
    const half=Number.isFinite(step)&&step>0?step/2:0;
    return intervals(points,step).map(range=>({...range,left:range.start-half,right:range.end+half}));
  }
  if(typeof module==='object'&&module.exports){module.exports={intervals,bands};return;}
  const $=id=>document.getElementById(id);
  let context=null,ranges=[],cancel=null;
  const players=new Set();
  function disposePlayers(){for(const p of players)p.dispose();players.clear();}
  function clear(){cancel?.();disposePlayers();context=null;ranges=[];$('significantMedia').hidden=true;$('significantIntervals').replaceChildren();$('mediaStatus').textContent='';}
  function show(points,meta){clear();if(meta.view!=='series')return;context=meta;ranges=intervals(points,Number(meta.grid_step));render();}
  const format=n=>Number(n.toFixed(6)).toString();
  function render(){
    if(!context)return;
    disposePlayers();$('significantMedia').hidden=false;$('significantIntervals').replaceChildren();
    const available=!!root.MetricsVideo?.source(context.epoch);
    $('mediaStatus').textContent=!ranges.length?'Nessun istante significativo (p finale ≤ 0,05).':!available?'Associa un video a questa epoca per estrarre frame e clip.':'';
    for(const r of ranges){
      const row=document.createElement('div');row.className='significant-interval';row.tabIndex=-1;row.dataset.start=r.start;row.dataset.end=r.end;
      const label=document.createElement('span');label.textContent=`${format(r.start)}–${format(r.end)} s · ${r.count} istanti · p min ${r.minP.toPrecision(3)}`;row.append(label);
      if(available)row.append(miniPlayer(r,root.MetricsVideo.source(context.epoch).url));
      for(const [text,kind]of [['Vai al video','seek'],['Frame PNG (p minimo)','frame'],['Clip video','clip']]){
        const button=document.createElement('button');button.type='button';button.textContent=text;button.disabled=!available||(kind==='clip'&&r.start===r.end);
        button.onclick=()=>kind==='seek'?root.MetricsVideo.seek(r.peak):extract(r,kind);row.append(button);
      }
      $('significantIntervals').append(row);
    }
  }
  function miniPlayer(range,url){
    const wrapper=document.createElement('div');wrapper.className='segment-player';
    const media=document.createElement('video');media.src=url;media.preload='metadata';media.playsInline=true;media.setAttribute('aria-label',`Segmento significativo da ${format(range.start)} a ${format(range.end)} secondi`);
    const controls=document.createElement('div');controls.className='segment-controls';
    const play=document.createElement('button');play.type='button';play.textContent='▶ Riproduci';play.disabled=true;
    const seek=document.createElement('input');seek.type='range';seek.min=range.start;seek.max=range.end;seek.step='any';seek.value=range.start;seek.disabled=true;seek.setAttribute('aria-label','Posizione nel segmento');
    const volume=document.createElement('input');volume.type='range';volume.min=0;volume.max=1;volume.step='.05';volume.value=1;volume.setAttribute('aria-label','Volume del segmento');volume.className='segment-volume';
    const time=document.createElement('output');const displayTime=value=>`${value.toFixed(2).replace('.',',')} s`;time.textContent=displayTime(range.start);
    const note=document.createElement('p');note.className='panel-note';note.textContent=range.start===range.end?'Istante isolato · fotogramma':'Audio originale · riproduzione limitata al segmento';
    let animation=null,seekAnimation=null,pendingTime=range.start,dragging=false,resumeAfterDrag=false,lastTimePaint=-Infinity;
    const stop=()=>{if(animation!==null)cancelAnimationFrame(animation);animation=null;};
    const paint=(value,force=false)=>{
      const clamped=Math.max(range.start,Math.min(range.end,value));
      seek.value=clamped;
      const now=performance.now();
      if(force||now-lastTimePaint>=100){const text=displayTime(clamped);if(time.textContent!==text)time.textContent=text;lastTimePaint=now;}
    };
    const flushSeek=()=>{if(seekAnimation!==null)cancelAnimationFrame(seekAnimation);seekAnimation=null;media.currentTime=pendingTime;};
    const sync=()=>{animation=null;if(dragging)return;paint(media.currentTime);if(media.currentTime>=range.end){media.pause();media.currentTime=range.end;paint(range.end,true);}else if(!media.paused)animation=requestAnimationFrame(sync);};
    media.addEventListener('loadedmetadata',()=>{
      if(range.start>=media.duration||range.start<0||range.end>media.duration){note.textContent='Intervallo non coperto dalla durata del video.';return;}
      media.currentTime=pendingTime;paint(pendingTime,true);play.disabled=seek.disabled=range.start===range.end;
    });
    media.addEventListener('play',()=>{root.MetricsVideo?.pause();for(const p of players)if(p.media!==media)p.media.pause();play.textContent='Ⅱ Pausa';stop();sync();});
    media.addEventListener('pause',()=>{stop();play.textContent='▶ Riproduci';if(!dragging)paint(media.currentTime,true);});
    media.addEventListener('seeked',()=>{if(!dragging&&seekAnimation===null)paint(media.currentTime,true);});
    media.addEventListener('error',()=>{note.textContent='Video non riproducibile.';play.disabled=seek.disabled=true;});
    play.onclick=()=>{if(!media.paused){media.pause();return;}if(media.currentTime>=range.end||media.currentTime<range.start)media.currentTime=range.start;media.play().catch(e=>{note.textContent=e.message;});};
    seek.addEventListener('pointerdown',event=>{
      pendingTime=media.currentTime;dragging=true;resumeAfterDrag=!media.paused;media.pause();seek.setPointerCapture(event.pointerId);
    });
    seek.oninput=()=>{
      pendingTime=Math.max(range.start,Math.min(range.end,Number(seek.value)));paint(pendingTime,true);
      if(seekAnimation===null)seekAnimation=requestAnimationFrame(flushSeek);
    };
    const finishDrag=()=>{
      if(!dragging)return;flushSeek();dragging=false;paint(pendingTime,true);
      if(resumeAfterDrag&&pendingTime<range.end)media.play().catch(e=>{note.textContent=e.message;});
      resumeAfterDrag=false;
    };
    seek.addEventListener('pointerup',finishDrag);seek.addEventListener('pointercancel',finishDrag);seek.addEventListener('lostpointercapture',finishDrag);
    seek.onchange=()=>{flushSeek();paint(pendingTime,true);};
    volume.oninput=()=>{media.volume=Number(volume.value);};
    const volumeLabel=document.createElement('label');volumeLabel.className='segment-volume-label';volumeLabel.append(document.createTextNode('Volume'),volume);
    controls.append(play,seek,time,volumeLabel);wrapper.append(media,controls,note);
    players.add({media,range,seekTo:value=>{pendingTime=value;media.pause();if(media.readyState>=1&&value<media.duration){media.currentTime=value;paint(value,true);}},dispose:()=>{stop();if(seekAnimation!==null)cancelAnimationFrame(seekAnimation);media.pause();media.removeAttribute('src');media.load();}});
    return wrapper;
  }
  function focusTime(time){
    const range=ranges.find(r=>time>=r.start&&time<=r.end);if(!range)return;
    root.MetricsVideo?.pause();
    for(const player of players){player.media.pause();if(player.range===range)player.seekTo(time);}
    const rows=$('significantIntervals').children;
    for(const row of rows){
      const selected=Number(row.dataset.start)===range.start&&Number(row.dataset.end)===range.end;
      row.classList.toggle('is-selected',selected);
      if(selected){row.scrollIntoView({block:'center',behavior:'smooth'});row.focus({preventScroll:true});}
    }
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
    const controller=new AbortController(),signal=controller.signal;cancel=()=>controller.abort();
    $('cancelMedia').hidden=false;$('cancelMedia').onclick=cancel;
    for(const button of $('significantIntervals').querySelectorAll('button'))button.disabled=true;
    const media=document.createElement('video');media.muted=true;media.playsInline=true;media.preload='auto';
    let stream=null,recorder=null,animation=null,audio=null;
    try{
      if(kind==='clip'){
        const Audio=root.AudioContext||root.webkitAudioContext;if(!Audio)throw new Error('Esportazione con audio non supportata da questo browser.');
        audio=new Audio();await audio.resume();
      }
      $('mediaStatus').textContent='Preparazione del video…';
      await waitEvent(media,'loadeddata',signal,()=>{media.src=source.url;media.load();});
      const start=kind==='frame'?range.peak:range.start,end=range.end;
      if(start<0||start>=media.duration||(kind==='clip'&&end>media.duration))throw new Error('Intervallo fuori dalla durata del video: scegli un video che copra gli istanti significativi.');
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
        const destination=audio.createMediaStreamDestination(),audioSource=audio.createMediaElementSource(media);audioSource.connect(destination);media.muted=false;
        for(const track of destination.stream.getAudioTracks())stream.addTrack(track);
        recorder=new MediaRecorder(stream,{mimeType:mime});const chunks=[];
        recorder.ondataavailable=e=>{if(e.data.size)chunks.push(e.data);};
        $('mediaStatus').textContent=`Registrazione clip ${format(start)}–${format(end)} s in corso… Mantieni la scheda visibile.`;
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
      $('mediaStatus').textContent='Download pronto.';
    }catch(e){if(context===meta)$('mediaStatus').textContent=e.message;}
    finally{
      if(animation!==null)cancelAnimationFrame(animation);media.pause();if(recorder?.state==='recording')recorder.stop();stream?.getTracks().forEach(t=>t.stop());media.removeAttribute('src');media.load();
      if(audio)await audio.close();cancel=null;$('cancelMedia').hidden=true;
      if(context===meta){const message=$('mediaStatus').textContent;render();$('mediaStatus').textContent=message;}
    }
  }
  document.addEventListener('metrics-video-changed',()=>{cancel?.();render();});
  document.addEventListener('visibilitychange',()=>{if(document.hidden){cancel?.();for(const p of players)p.media.pause();}});
  $('viewTab').addEventListener('click',()=>{for(const p of players)p.media.pause();});
  root.MetricsSignificantMedia={show,clear,intervals,bands,focusTime};
})(globalThis);
