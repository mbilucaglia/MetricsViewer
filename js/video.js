(function(global){
  'use strict';
  const $=id=>document.getElementById(id),movie=$('stimulusVideo'),assignments=new Map(),plots=new Map();
  const still=global.MetricsStaticMedia?.create();
  if(still){still.hidden=true;$('stimulusMediaFrame').append(still);}
  let video=movie;
  let durations={},mediaFiles=[];
  let epoch='',activeUrl=null,time=0,frame=null,series=true;
  let assignmentEpochs = [], pending = null, changed = false;
  let demoVideosLoading=null;
  const videosToRemove = new Set();
  const stop=()=>{if(frame!==null)cancelAnimationFrame(frame);frame=null;};
  connectMetricsSettings({
    trigger: $('openVideoAssignments'), dialog: $('videoAssignmentDialog'),
    begin: () => {
      pending = new Map(assignments);
      videosToRemove.clear();
      $('videoAssignmentError').textContent = '';
      for(const id of assignmentEpochs){
        if(pending.has(id))continue;
        const normalize=name=>name.normalize('NFKC').toLowerCase().replace(/[^\p{L}\p{N}]/gu,'');
        const matches=mediaFiles.filter(file=>normalize(file.name.replace(/\.[^.]+$/,''))===normalize(id));
        if(matches.length===1)pending.set(id,{file:matches[0],name:matches[0].name,kind:global.MetricsStaticMedia.kind(matches[0])});
      }
      rows();
    },
    accept: saveAssignments,
    discard: () => { pending = null; videosToRemove.clear(); rows(); },
    applied: () => {
      if (changed) document.dispatchEvent?.(new CustomEvent('metrics-video-changed'));
    }
  });
  function paint(followAt){
    const following = [];
    const label = `${time.toFixed(2)} s`;
    $('videoTime').textContent = label;
    if(still&&video===still){
      $('staticStimulusSeek').value=time;
      $('staticStimulusPlay').textContent=video.paused?'▶ Riproduci':'Ⅱ Pausa';
    }
    for(const [svg,p]of plots){
      if(!svg.isConnected){plots.delete(svg);continue;}
      if (p.overview) {
        const { marker, min, max, x, width } = p.overview;
        const inOverview = activeUrl && series && time >= min && time <= max;
        marker.setAttribute('visibility', inOverview ? 'visible' : 'hidden');
        if (inOverview) {
          const position = x + (time - min) / (max - min) * width;
          marker.setAttribute('x1', position);
          marker.setAttribute('x2', position);
        }
      }
      // Keep the playhead at the left edge throughout the lead-in before the first sample.
      const atStart = activeUrl && p.showStart && time >= 0 && time < p.min;
      const visible = series && (atStart || (time >= p.min && time <= p.max));
      p.line.setAttribute('visibility',visible?'visible':'hidden');
      p.marker.setAttribute('visibility', visible ? 'visible' : 'hidden');
      p.axis.setAttribute('aria-valuenow', Math.max(p.min, Math.min(p.max, time)));
      p.axis.setAttribute('aria-valuetext', visible ? label : label + ', fuori dall’intervallo visibile');
      if (visible) {
        const x = p.left + (Math.max(p.min, time) - p.min) / (p.max - p.min) * p.width;
        p.line.setAttribute('x1', x);
        p.line.setAttribute('x2', x);
        const width = Math.max(58, label.length * 8 + 16);
        const center = Math.max(p.left + width / 2, Math.min(p.left + p.width - width / 2, x));
        p.marker.setAttribute('transform', `translate(${center} ${p.axisY})`);
        p.badge.setAttribute('x', -width / 2);
        p.badge.setAttribute('width', width);
        p.label.textContent = label;
      }
      if (followAt !== undefined && p.followPlayback && !p.seeking()) following.push(p.followPlayback);
    }
    for (const follow of following) follow(time, followAt);
  }
  function seek(next){
    if(!Number.isFinite(next))return;
    time=Math.max(0,next);
    if(activeUrl&&video.readyState>=1&&Number.isFinite(video.duration)){
      time=Math.min(time,video.duration);video.currentTime=time;
    }
    paint();
  }
  function tick(now) {
    frame = null;
    if (!activeUrl || !series) return;
    time = video.currentTime;
    const playing = !video.paused && !video.ended;
    paint(playing ? now : undefined);
    if (playing) frame = requestAnimationFrame(tick);
  }
  function activate(){
    const item=assignments.get(epoch),next=item?.url||null;
    const nextPlayer=item?.kind==='image'&&still?still:movie;
    if(video!==nextPlayer){video.pause();video.hidden=true;video=nextPlayer;activeUrl=null;}
    if(video===still){
      still.setDuration(item?.duration||durations[epoch]||1);
      $('staticStimulusSeek').max=still.duration;
      $('staticStimulusDuration').textContent=Number(still.duration.toFixed(2))+' s';
    }
    $('staticStimulusControls').hidden=video!==still||!next;
    if(next!==activeUrl){
      stop();video.pause();activeUrl=next;time=0;
      if(next)video.src=next;else video.removeAttribute('src');
      video.load();
    }
    video.hidden=!next;$('videoEmpty').hidden=!!next;
    $('videoError').textContent='';$('videoEpoch').textContent=epoch||'Nessuna epoca selezionata';paint();
  }
  function release(id){const old=assignments.get(id);assignments.delete(id);if(old?.objectUrl)URL.revokeObjectURL(old.url);}
  function saveAssignments() {
    if([...$('videoAssignments').querySelectorAll('input[type=number]')].some(input=>input.checkValidity&&!input.checkValidity()))return false;
    const nextItem = id => videosToRemove.has(id) ? undefined : pending.get(id);
    const updates = assignmentEpochs.filter(id => assignments.get(id) !== nextItem(id));
    const uploaded = new Map();
    try {
      for (const id of updates) {
        const item = nextItem(id);
        if (item?.file) uploaded.set(id, {
          url: URL.createObjectURL(item.file), name: item.name, file:item.file, objectUrl: true, kind:item.kind??global.MetricsStaticMedia?.kind(item.file)??'video', ...(item.duration?{duration:item.duration}:{})
        });
      }
    } catch {
      for (const item of uploaded.values()) URL.revokeObjectURL(item.url);
      $('videoAssignmentError').textContent = 'Impossibile associare il video. Riprova.';
      return false;
    }
    const replaced = [];
    for (const id of updates) {
      const old = assignments.get(id);
      const item = uploaded.get(id) ?? nextItem(id);
      if (old?.objectUrl&&old.url!==item?.url) replaced.push(old.url);
      if (item) assignments.set(id, item);
      else assignments.delete(id);
    }
    changed = updates.length > 0;
    pending = null;
    videosToRemove.clear();
    if (changed) activate();
    for (const url of replaced) URL.revokeObjectURL(url);
    rows();
  }
  function rows(){
    const library=$('stimulusLibrary');
    if(library)library.textContent=mediaFiles.length?mediaFiles.map(file=>file.name).join(' · ')+(assignmentEpochs.length?'':' — Carica i dati per associare gli stimoli alle epoche.'):'';
    $('videoAssignments').replaceChildren();
    for(const id of assignmentEpochs){
      const row=document.createElement('div');row.className='video-assignment';
      const label=document.createElement('label');label.textContent=id;
      const input=document.createElement('input');input.type='file';input.accept='video/*,image/*';input.setAttribute('aria-label',`Video o immagine per ${id}`);
      input.addEventListener('change',()=>{
        const file=input.files[0];if(!file||!pending)return;
        if(global.MetricsStaticMedia&&!global.MetricsStaticMedia.kind(file)){$('videoAssignmentError').textContent='Scegli un video o un’immagine.';return;}
        videosToRemove.delete(id);
        mediaFiles.push(file);pending.set(id,{file,name:file.name,kind:global.MetricsStaticMedia?.kind(file)??'video'});rows();
      });
      label.append(input);row.append(label);
      const item=(pending ?? assignments).get(id);
      if(mediaFiles.length){
        const select=document.createElement('select');select.setAttribute('aria-label','Stimolo per '+id);
        const empty=document.createElement('option');empty.value='';empty.textContent='Nessuno';select.append(empty);
        if(item&&!mediaFiles.includes(item.file)){const current=document.createElement('option');current.value='current';current.textContent=item.name;select.append(current);}
        mediaFiles.forEach((file,index)=>{const option=document.createElement('option');option.value=String(index);option.textContent=file.name;select.append(option);});
        select.value=item?(item.file?String(mediaFiles.indexOf(item.file)):'current'):'';
        select.onchange=()=>{
          if(!pending)return;
          if(select.value===''){pending.delete(id);videosToRemove.add(id);}
          else if(select.value!=='current'){const file=mediaFiles[Number(select.value)];videosToRemove.delete(id);pending.set(id,{file,name:file.name,kind:global.MetricsStaticMedia.kind(file)});}
          rows();
        };row.append(select);
      }
      if(item?.kind==='image'){
        const durationLabel=document.createElement('label');durationLabel.textContent='Durata (s)';
        const duration=document.createElement('input');duration.type='number';duration.min='0.001';duration.step='any';duration.placeholder=String(durations[id]||'');duration.value=item.duration??'';duration.setAttribute('aria-label','Durata immagine per '+id);
        duration.onchange=()=>{
          if(duration.value!==''&&(!Number.isFinite(Number(duration.value))||Number(duration.value)<=0)){duration.setCustomValidity('Inserisci una durata maggiore di zero.');duration.reportValidity();return;}
          duration.setCustomValidity('');if(pending)pending.set(id,{...pending.get(id),duration:duration.value===''?undefined:Number(duration.value)});
        };durationLabel.append(duration);row.append(durationLabel);
      }
      if(item){
        const name=document.createElement('span');name.textContent=item.name;row.append(name);
        const choice = document.createElement('label');
        choice.className = 'video-removal-choice';
        const select = document.createElement('input');
        select.type = 'checkbox';
        select.checked = videosToRemove.has(id);
        select.setAttribute('aria-label', 'Seleziona il video per ' + id);
        select.onchange = () => {
          if (select.checked) videosToRemove.add(id);
          else videosToRemove.delete(id);
        };
        choice.append(select, document.createTextNode('Seleziona per rimuovere'));
        row.append(choice);
      }
      $('videoAssignments').append(row);
    }
  }
  function replaceAssignments(items, library=[]){
    stop();video.pause();video.removeAttribute('src');video.load();activeUrl=null;time=0;mediaFiles=library;
    for(const id of assignments.keys())release(id);
    for(const item of items)assignments.set(item.epoch,{url:item.url,name:item.name,objectUrl:Boolean(item.file),...(item.file?{file:item.file}:{}),...(item.demoFile?{demoFile:item.demoFile}:{}),...(item.kind?{kind:item.kind}:{}),...(item.duration?{duration:item.duration}:{})});
    assignmentEpochs=items.map(item=>item.epoch);activate();rows();
    document.dispatchEvent?.(new CustomEvent('metrics-video-changed'));
  }
  async function exportSource(id) {
    const item=source(id);
    if(!item||global.location?.protocol!=='file:'||!item.demoFile)return item??null;
    if(!global.MetricsDemoVideoData) {
      if(!demoVideosLoading)demoVideosLoading=global.MetricsLocalLibrary.load(
        'MetricsDemoVideoData',new URL('js/demo-videos.js',document.baseURI).href
      ).catch(error=>{demoVideosLoading=null;throw error;});
      await demoVideosLoading;
    }
    const url=global.MetricsDemoVideoData[item.demoFile];
    if(typeof url!=='string'||!url.startsWith('data:video/'))throw new Error('Video dimostrativo per l’esportazione non disponibile.');
    return {...item,url};
  }
  async function projectMedia() {
    const files = [...new Set(mediaFiles)], links = [], position = time;
    for (const [epoch,item] of assignments) {
      let file = item.file;
      if (!file) {
        const source = await exportSource(epoch);
        const response = await fetch(source.url);
        if (!response.ok) throw new Error('Impossibile includere ' + item.name);
        const blob = await response.blob();
        file = new File([blob],item.name,{type:blob.type});
      }
      if (!files.includes(file)) files.push(file);
      links.push({epoch, index:files.indexOf(file), duration:item.duration});
    }
    return {files, links, position};
  }
  function prepareProjectMedia(files, links) {
    const valid = MetricsProject.requireValid;
    valid(files.every(file => global.MetricsStaticMedia.kind(file)) && Array.isArray(links));
    const items = links.map(link => {
      valid(typeof link.epoch === 'string' && Number.isInteger(link.index) && files[link.index] &&
        (link.duration === undefined || Number.isFinite(link.duration) && link.duration > 0));
      const file = files[link.index];
      return {epoch:link.epoch, file, name:file.name, kind:global.MetricsStaticMedia.kind(file), duration:link.duration};
    });
    valid(new Set(items.map(item => item.epoch)).size === items.length);
    try {
      for (const item of items) item.url = URL.createObjectURL(item.file);
    } catch (error) {
      for (const item of items) if (item.url) URL.revokeObjectURL(item.url);
      throw error;
    }
    return () => replaceAssignments(items,files);
  }
  function setContext(epochs,current,mode,epochDurations={}){
    durations=epochDurations;
    series=mode==='series';$('videoCard').hidden=!series;
    if(!series){video.pause();stop();}
    if(epoch!==current)time=0;
    epoch=current;
    const stale=[...assignments.keys()].filter(id=>!epochs.includes(id));
    // Detach media before releasing the object URL.
    if(stale.includes(epoch)||!epochs.includes(epoch))epoch='';
    activate();for(const id of stale)release(id);
    assignmentEpochs=epochs;rows();paint();
  }
  function attach(svg,{min,max,left,top,width,height,showStart=true,overview,followPlayback}){
    function element(tag, attributes) {
      const node = document.createElementNS('http://www.w3.org/2000/svg', tag);
      for (const [key, value] of Object.entries(attributes)) node.setAttribute(key, value);
      return node;
    }
    const axisY = top + height + 29;
    const line = element('line', { y1: top, y2: axisY + 6, class: 'video-playhead-line', 'aria-hidden': 'true' });
    const axis = element('rect', {
      x: left, y: axisY - 2, width, height: 26, rx: 4,
      class: 'video-playhead-axis', tabindex: 0, role: 'slider',
      'aria-label': 'Posizione del video in secondi', 'aria-valuemin': min, 'aria-valuemax': max
    });
    const marker = element('g', { class: 'video-playhead-marker', 'aria-hidden': 'true' });
    const badge = element('rect', { height: 22, rx: 5 });
    const label = element('text', { x: 0, y: 11, 'text-anchor': 'middle', 'dominant-baseline': 'central' });
    marker.append(badge, label);
    svg.append(line, axis, marker);
    let pointerId = null;
    const p = { min, max, left, width, axisY, line, axis, marker, badge, label, showStart, followPlayback,
      seeking: () => pointerId !== null };
    if (overview) {
      const previewMarker = element('line', { y1: overview.y, y2: overview.y + overview.height,
        class: 'video-playhead-line video-playhead-overview', 'aria-hidden': 'true' });
      svg.append(previewMarker);
      p.overview = { ...overview, marker: previewMarker };
    }
    plots.set(svg, p);

    function localPoint(event) {
      const matrix = svg.getScreenCTM();
      if (!matrix) return null;
      const point = svg.createSVGPoint();
      point.x = event.clientX;
      point.y = event.clientY;
      return point.matrixTransform(matrix.inverse());
    }
    function seekAt(x) {
      seek(min + Math.max(0, Math.min(1, (x - left) / width)) * (max - min));
    }
    axis.addEventListener('pointerdown', event => {
      if (!event.isPrimary || event.button !== 0 || pointerId !== null) return;
      const local = localPoint(event);
      if (!local) return;
      event.preventDefault();
      axis.focus({ preventScroll: true });
      pointerId = event.pointerId;
      document.addEventListener('pointermove', move);
      document.addEventListener('pointerup', finish);
      document.addEventListener('pointercancel', finish);
      global.addEventListener('blur', stopDrag);
      seekAt(local.x);
    });
    function move(event) {
      if (pointerId !== event.pointerId) return;
      if (!svg.isConnected) {
        stopDrag();
        return;
      }
      const local = localPoint(event);
      if (local) seekAt(local.x);
    }
    function finish(event) {
      if (pointerId !== event.pointerId) return;
      if (event.type === 'pointerup') move(event);
      stopDrag();
    }
    function stopDrag() {
      pointerId = null;
      document.removeEventListener('pointermove', move);
      document.removeEventListener('pointerup', finish);
      document.removeEventListener('pointercancel', finish);
      global.removeEventListener('blur', stopDrag);
    }
    axis.addEventListener('keydown', event => {
      const next = { ArrowLeft: time - 1, ArrowRight: time + 1, Home: min, End: max }[event.key];
      if (!Number.isFinite(next)) return;
      event.preventDefault();
      seek(Math.min(max, Math.max(min, next)));
    });
    paint();
  }
  for(const player of [movie,still].filter(Boolean)){
    player.addEventListener('loadedmetadata',()=>{if(video===player)seek(time);});
    for(const name of ['timeupdate','seeked'])player.addEventListener(name,()=>{if(activeUrl&&video===player){time=player.currentTime;paint();}});
    player.addEventListener('play',()=>{if(video===player){stop();tick();}});
    for(const name of ['pause','ended'])player.addEventListener(name,()=>{if(video===player){stop();if(activeUrl){time=player.currentTime;paint();}}});
    player.addEventListener('error',()=>{if(video===player){stop();if(activeUrl)$('videoError').textContent='Stimolo non riproducibile. Scegli un video o un’immagine supportati dal browser.';}});
  }
  if(still){
    $('staticStimulusPlay').onclick=()=>video.paused?video.play().catch(error=>{$('videoError').textContent=error.message;}):video.pause();
    $('staticStimulusSeek').oninput=()=>seek(Number($('staticStimulusSeek').value));
  }
  function importFiles(files){
    for(const file of files)if(global.MetricsStaticMedia.kind(file)&&!mediaFiles.some(other=>other.name===file.name&&other.size===file.size&&other.lastModified===file.lastModified))mediaFiles.push(file);
    $('openVideoAssignments').hidden=!assignmentEpochs.length&&!mediaFiles.length;
    $('openVideoAssignments').click();
  }
  function source(id){
    const item=assignments.get(id);
    return item?.kind==='image'?{...item,duration:item.duration||durations[id]||1}:item||null;
  }
  global.addEventListener('pagehide',()=>{video.pause();stop();});
  global.addEventListener('beforeunload',()=>{stop();for(const id of assignments.keys())release(id);});
  global.MetricsVideo={setContext,replaceAssignments,projectMedia,prepareProjectMedia,attach,seek,pause:()=>video.pause(),source,exportSource,importFiles};
})(window);
