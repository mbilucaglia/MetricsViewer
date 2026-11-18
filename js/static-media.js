(function(root){
  'use strict';
  function kind(file) {
    if(file.type?.startsWith('image/')||/\.(png|jpe?g|webp|gif|bmp|avif|svg)$/i.test(file.name))return 'image';
    if(file.type?.startsWith('video/')||/\.(mp4|webm|mov|m4v|ogv|ogg|avi|mkv)$/i.test(file.name))return 'video';
    return null;
  }
  function create(duration=1) {
    const image=document.createElement('img');
    image.className='static-stimulus';image.alt='Immagine dello stimolo';image.crossOrigin='anonymous';
    let position=0,playing=false,frame=null,last=0,limit=duration,ready=false;
    const emit=name=>image.dispatchEvent(new Event(name));
    const stop=()=>{if(frame!==null)cancelAnimationFrame(frame);frame=null;};
    function pause(){const was=playing;playing=false;stop();if(was)emit('pause');}
    function tick(now){
      frame=null;if(!playing)return;
      position=Math.min(limit,position+(now-last)/1000);last=now;emit('timeupdate');
      if(position>=limit){pause();emit('ended');}else frame=requestAnimationFrame(tick);
    }
    Object.defineProperties(image,{
      currentTime:{get:()=>position,set:value=>{position=Math.max(0,Math.min(limit,Number(value)||0));last=performance.now();emit('timeupdate');emit('seeked');}},
      duration:{get:()=>limit},paused:{get:()=>!playing},ended:{get:()=>position>=limit},readyState:{get:()=>ready?4:0},
      videoWidth:{get:()=>image.naturalWidth},videoHeight:{get:()=>image.naturalHeight}
    });
    image.volume=0;image.muted=true;
    image.setDuration=value=>{limit=Number.isFinite(value)&&value>0?value:1;position=Math.min(position,limit);};
    image.play=async()=>{if(!ready)throw new Error('Immagine non ancora disponibile.');if(playing)return;if(position>=limit)position=0;playing=true;last=performance.now();emit('play');if(playing)frame=requestAnimationFrame(tick);};
    image.pause=pause;image.load=()=>{pause();position=0;ready=false;};
    image.addEventListener('load',()=>{ready=true;emit('loadedmetadata');emit('loadeddata');});
    image.dispose=()=>{pause();image.removeAttribute('src');image.load();};
    return image;
  }
  root.MetricsStaticMedia={kind,create};
})(window);
