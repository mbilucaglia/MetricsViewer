(function(global){
  'use strict';
  const $=id=>document.getElementById(id),video=$('stimulusVideo'),assignments=new Map(),plots=new Map();
  let epoch='',activeUrl=null,time=0,frame=null,series=true;
  const stop=()=>{if(frame!==null)cancelAnimationFrame(frame);frame=null;};
  function paint(){
    $('videoTime').textContent=`${time.toFixed(2)} s`;
    for(const [svg,p]of plots){
      if(!svg.isConnected){plots.delete(svg);continue;}
      const visible=series&&time>=p.min&&time<=p.max;
      p.line.setAttribute('visibility',visible?'visible':'hidden');
      if(visible){const x=p.left+(time-p.min)/(p.max-p.min)*p.width;p.line.setAttribute('x1',x);p.line.setAttribute('x2',x);}
    }
  }
  function seek(next){
    if(!Number.isFinite(next))return;
    time=Math.max(0,next);
    if(activeUrl&&video.readyState>=1&&Number.isFinite(video.duration)){
      time=Math.min(time,video.duration);video.currentTime=time;
    }
    paint();
  }
  function tick(){frame=null;if(!activeUrl||!series)return;time=video.currentTime;paint();if(!video.paused&&!video.ended)frame=requestAnimationFrame(tick);}
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
  function rows(epochs){
    $('videoAssignments').replaceChildren();
    for(const id of epochs){
      const row=document.createElement('div');row.className='video-assignment';
      const label=document.createElement('label');label.textContent=id;
      const input=document.createElement('input');input.type='file';input.accept='video/*';input.setAttribute('aria-label',`Video per ${id}`);
      input.addEventListener('change',()=>{
        const file=input.files[0];if(!file)return;
        const url=URL.createObjectURL(file),old=assignments.get(id);
        assignments.set(id,{url,name:file.name,objectUrl:true});activate();if(old?.objectUrl)URL.revokeObjectURL(old.url);rows(epochs);document.dispatchEvent?.(new CustomEvent('metrics-video-changed'));
      });
      label.append(input);row.append(label);
      const item=assignments.get(id);
      if(item){
        const name=document.createElement('span');name.textContent=item.name;row.append(name);
        const remove=document.createElement('button');remove.type='button';remove.textContent='Rimuovi';remove.setAttribute('aria-label',`Rimuovi video per ${id}`);
        remove.addEventListener('click',()=>{const old=assignments.get(id);assignments.delete(id);activate();if(old.objectUrl)URL.revokeObjectURL(old.url);rows(epochs);document.dispatchEvent?.(new CustomEvent('metrics-video-changed'));});row.append(remove);
      }
      $('videoAssignments').append(row);
    }
  }
  function replaceAssignments(items){
    stop();video.pause();video.removeAttribute('src');video.load();activeUrl=null;time=0;
    for(const id of assignments.keys())release(id);
    for(const item of items)assignments.set(item.epoch,{url:item.url,name:item.name,objectUrl:false});
    activate();rows(items.map(item=>item.epoch));
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
    rows(epochs);paint();
  }
  function attach(svg,{min,max,left,top,width,height}){
    const line=document.createElementNS('http://www.w3.org/2000/svg','line');
    for(const [key,value]of Object.entries({y1:top,y2:top+height,stroke:'#bd253b','stroke-width':2,'pointer-events':'none','aria-hidden':'true'}))line.setAttribute(key,value);
    svg.append(line);plots.set(svg,{min,max,left,width,line});
    svg.addEventListener('click',event=>{
      const matrix=svg.getScreenCTM();if(!matrix)return;
      const point=svg.createSVGPoint();point.x=event.clientX;point.y=event.clientY;
      const local=point.matrixTransform(matrix.inverse());
      if(local.x<left||local.x>left+width||local.y<top||local.y>top+height)return;
      seek(min+(local.x-left)/width*(max-min));
    });
    svg.setAttribute('tabindex','0');svg.setAttribute('aria-label',`${svg.getAttribute('aria-label')||'Grafico'}. Clicca per cercare nel video; frecce destra e sinistra per spostarti di un secondo.`);
    svg.addEventListener('keydown',event=>{if(event.key==='ArrowLeft'||event.key==='ArrowRight'){event.preventDefault();seek(Math.min(max,Math.max(min,time+(event.key==='ArrowRight'?1:-1))));}});
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
