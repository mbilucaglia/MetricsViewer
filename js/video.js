(function(global){
  'use strict';
  const $=id=>document.getElementById(id),video=$('stimulusVideo'),assignments=new Map(),plots=new Map();
  let epoch='',activeUrl=null,time=0,frame=null,series=true;
  let assignmentEpochs = [], pending = null, changed = false;
  const videosToRemove = new Set();
  const stop=()=>{if(frame!==null)cancelAnimationFrame(frame);frame=null;};
  connectMetricsSettings({
    trigger: $('openVideoAssignments'), dialog: $('videoAssignmentDialog'),
    begin: () => {
      pending = new Map(assignments);
      videosToRemove.clear();
      $('videoAssignmentError').textContent = '';
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
      const atStart = activeUrl && p.showStart && time === 0 && p.min > 0;
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
    const next=assignments.get(epoch)?.url||null;
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
    const nextItem = id => videosToRemove.has(id) ? undefined : pending.get(id);
    const updates = assignmentEpochs.filter(id => assignments.get(id) !== nextItem(id));
    const uploaded = new Map();
    try {
      for (const id of updates) {
        const item = nextItem(id);
        if (item?.file) uploaded.set(id, {
          url: URL.createObjectURL(item.file), name: item.name, objectUrl: true
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
      if (old?.objectUrl) replaced.push(old.url);
      const item = uploaded.get(id) ?? nextItem(id);
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
    $('videoAssignments').replaceChildren();
    for(const id of assignmentEpochs){
      const row=document.createElement('div');row.className='video-assignment';
      const label=document.createElement('label');label.textContent=id;
      const input=document.createElement('input');input.type='file';input.accept='video/*';input.setAttribute('aria-label',`Video per ${id}`);
      input.addEventListener('change',()=>{
        const file=input.files[0];if(!file||!pending)return;
        videosToRemove.delete(id);
        pending.set(id,{file,name:file.name});rows();
      });
      label.append(input);row.append(label);
      const item=(pending ?? assignments).get(id);
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
  function replaceAssignments(items){
    stop();video.pause();video.removeAttribute('src');video.load();activeUrl=null;time=0;
    for(const id of assignments.keys())release(id);
    for(const item of items)assignments.set(item.epoch,{url:item.url,name:item.name,objectUrl:false});
    assignmentEpochs=items.map(item=>item.epoch);activate();rows();
    document.dispatchEvent?.(new CustomEvent('metrics-video-changed'));
  }
  function setContext(epochs,current,mode){
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
  video.addEventListener('loadedmetadata',()=>seek(time));
  for(const name of ['timeupdate','seeked'])video.addEventListener(name,()=>{if(activeUrl){time=video.currentTime;paint();}});
  video.addEventListener('play',()=>{stop();tick();});
  for(const name of ['pause','ended'])video.addEventListener(name,()=>{stop();if(activeUrl){time=video.currentTime;paint();}});
  video.addEventListener('error',()=>{stop();if(activeUrl)$('videoError').textContent='Video non riproducibile. Scegli un formato supportato dal browser, ad esempio MP4 o WebM.';});
  global.addEventListener('pagehide',()=>{video.pause();stop();});
  global.addEventListener('beforeunload',()=>{stop();for(const id of assignments.keys())release(id);});
  global.MetricsVideo={setContext,replaceAssignments,attach,seek,pause:()=>video.pause(),source:id=>assignments.get(id)||null};
})(window);
