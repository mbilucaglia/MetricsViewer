(function(root) {
  'use strict';
  const ns='http://www.w3.org/2000/svg';
  const menu=document.createElement('div');
  menu.className='chart-export-menu';menu.id='chartExportMenu';
  menu.setAttribute('popover','auto');menu.setAttribute('role','menu');menu.setAttribute('aria-label','Esporta la vista');
  document.body.append(menu);
  let current=null;
  function close() {
    if(menu.matches(':popover-open'))menu.hidePopover();
    current?.anchor.setAttribute('aria-expanded','false');current=null;
  }
  menu.addEventListener('toggle',event=>{
    if(event.newState==='closed'&&!menu.matches(':popover-open')){current?.anchor.setAttribute('aria-expanded','false');current=null;}
  });
  document.addEventListener('metrics-invalidated',close);
  function svgElement(name,attrs={},text) {
    const element=document.createElementNS(ns,name);
    for(const [key,value]of Object.entries(attrs))element.setAttribute(key,value);
    if(text!==undefined)element.textContent=text;
    return element;
  }
  function filename(title,extension) {
    return (title||'MetricsViewer').replace(/[^\p{L}\p{N}_-]+/gu,'-').replace(/^-|-$/g,'')+'.'+extension;
  }
  function download(blob,name) {
    const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();
    setTimeout(()=>URL.revokeObjectURL(url),1000);
  }
  function cloneChart(svg,title) {
    const clone=svg.cloneNode(true),originals=[svg,...svg.querySelectorAll('*')],copies=[clone,...clone.querySelectorAll('*')];
    const styles=['fill','fill-opacity','stroke','stroke-width','stroke-opacity','stroke-dasharray',
      'stroke-linecap','stroke-linejoin','opacity','font-family','font-size','font-weight','text-anchor','dominant-baseline','visibility'];
    originals.forEach((element,index)=>{
      const computed=getComputedStyle(element);
      for(const property of styles)copies[index].style.setProperty(property,computed.getPropertyValue(property));
      for(const attribute of ['tabindex','role','aria-pressed','aria-expanded'])copies[index].removeAttribute(attribute);
    });
    clone.querySelectorAll('.chart-panner,.chart-axis-hit,.chart-zoom-selection').forEach(element=>element.remove());
    for(const circle of clone.querySelectorAll('.preview-badge circle')) { circle.style.stroke='#fff';circle.style.strokeWidth='2'; }
    const view=svg.viewBox.baseVal,height=Number(svg.dataset.exportHeight)||view.height;
    clone.setAttribute('xmlns',ns);clone.setAttribute('viewBox',[view.x,view.y,view.width,height].join(' '));
    clone.setAttribute('width',view.width);clone.setAttribute('height',height);
    clone.style.background='#fff';clone.prepend(svgElement('title',{},title));
    return {element:clone,width:view.width,height};
  }
  function sourcePoint(svg,preview) {
    if(!svg.contains(preview.anchor))return null;
    const circle=preview.anchor.querySelector('.preview-badge circle');
    const matrix=svg.getScreenCTM();
    if(!circle||!matrix)return null;
    const bounds=circle.getBoundingClientRect(),point=svg.createSVGPoint();
    point.x=(bounds.left+bounds.right)/2;point.y=(bounds.top+bounds.bottom)/2;
    const center=point.matrixTransform(matrix.inverse());
    return {x:center.x,y:center.y,radius:Number(circle.getAttribute('r'))||11};
  }
  function waitVideo(video,event,action) {
    return new Promise((resolve,reject)=>{
      const cleanup=()=>{clearTimeout(timer);video.removeEventListener(event,done);video.removeEventListener('error',failed);};
      const done=()=>{cleanup();resolve();},failed=()=>{cleanup();reject(new Error('Impossibile leggere un fotogramma del video associato.'));};
      const timer=setTimeout(failed,15000);
      video.addEventListener(event,done,{once:true});video.addEventListener('error',failed,{once:true});
      try{action();}catch(error){cleanup();reject(error);}
    });
  }
  async function previewFrames(previews,job) {
    const videos=new Map(),result=[];
    try {
      for(const [index,preview]of previews.entries()){
        await job.step('Preparazione anteprima '+(index+1)+' di '+previews.length+'…',{value:index,max:previews.length});
        if(!preview.url){result.push({...preview,frame:null});continue;}
        let video=videos.get(preview.url);
        if(!video){
          const source=await root.MetricsVideo?.exportSource?.(preview.epoch);
          video=source?.kind==='image'?root.MetricsStaticMedia.create(source.duration):document.createElement('video');video.muted=true;video.playsInline=true;video.preload='auto';video.crossOrigin='anonymous';
          videos.set(preview.url,video);
          await waitVideo(video,'loadeddata',()=>{video.src=source?.url??preview.url;video.load();});
        }
        if(!Number.isFinite(video.duration)||video.duration<=0||preview.time<0||preview.time>video.duration+1e-7)
          throw new Error('L’istante '+preview.time+' s non è coperto dal video associato.');
        const frameTime=Math.min(preview.time,Math.max(0,video.duration-.0001));
        if(Math.abs(video.currentTime-frameTime)>1e-7)await waitVideo(video,'seeked',()=>{video.currentTime=frameTime;});
        const canvas=document.createElement('canvas');canvas.width=Math.min(960,video.videoWidth);canvas.height=Math.round(canvas.width*video.videoHeight/video.videoWidth);
        canvas.getContext('2d').drawImage(video,0,0,canvas.width,canvas.height);
        result.push({...preview,frame:canvas.toDataURL('image/png'),frameWidth:canvas.width,frameHeight:canvas.height});
      }
      return result;
    } finally {for(const video of videos.values()){video.pause();video.removeAttribute('src');video.load();}}
  }
  function badge(parent,x,y,rank,color,radius=11,shape='circle') {
    const geometry=root.MetricsViewSummary?.symbol(shape,x,y,radius)??{tag:'circle',attrs:{cx:x,cy:y,r:radius}};
    parent.append(svgElement(geometry.tag,{...geometry.attrs,fill:color}),
      svgElement('text',{x,y:y+4,'text-anchor':'middle',fill:'#fff','font-size':12,'font-family':'Arial, sans-serif','font-weight':700},rank));
  }
  function composeSvg(chart,model,title) {
    const svg=svgElement('svg',{xmlns:ns,width:model.width,height:model.height,viewBox:'0 0 '+model.width+' '+model.height,role:'img','aria-label':title});
    svg.append(svgElement('title',{},title),svgElement('rect',{width:model.width,height:model.height,fill:'#fff'}),
      svgElement('text',{x:20,y:25,fill:'#25234a','font-family':'Arial, sans-serif','font-size':17,'font-weight':600},title));
    chart.setAttribute('x',model.chart.x);chart.setAttribute('y',model.chart.y);svg.append(chart);
    for(const card of model.cards){
      svg.append(svgElement('polyline',{points:card.connector.map(point=>point.x+','+point.y).join(' '),fill:'none',stroke:card.color,'stroke-width':1.15,opacity:.75,'data-export-link':card.index}));
    }
    for(const card of model.cards){
      const group=svgElement('g',{'data-export-pip':card.index});
      group.append(svgElement('rect',{x:card.x,y:card.y,width:card.width,height:card.height,rx:6,fill:'#fafafe',stroke:'#dfe1ef','stroke-width':1}));
      badge(group,card.x+20,card.y+Math.min(card.captionHeight/2,24),card.rank??card.index+1,card.color,11,card.shape);
      card.lines.forEach((line,index)=>group.append(svgElement('text',{x:card.x+38,y:card.y+20+index*17,fill:'#25234a','font-family':'Arial, sans-serif','font-size':13},line)));
      if(card.frame)group.append(svgElement('image',{href:card.frame,x:card.image.x,y:card.image.y,width:card.image.width,height:card.image.height,preserveAspectRatio:'xMidYMid meet'}));
      else group.append(svgElement('text',{x:card.x+card.width/2,y:card.image.y+card.image.height/2,'text-anchor':'middle',fill:'#686887','font-family':'Arial, sans-serif','font-size':13},'Video non associato'));
      svg.append(group);
    }
    return svg;
  }
  function blobFromSvg(svg) {
    return new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml;charset=utf-8'});
  }
  async function pngFromSvg(svg,width,height) {
    const url=URL.createObjectURL(blobFromSvg(svg)),image=new Image();
    try{
      await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=()=>reject(new Error('Impossibile esportare il grafico.'));image.src=url;});
      const scale=Math.min(3,16384/Math.max(width,height),Math.sqrt(16000000/(width*height)));
      const canvas=document.createElement('canvas');canvas.width=Math.round(width*scale);canvas.height=Math.round(height*scale);
      const context=canvas.getContext('2d');context.fillStyle='#fff';context.fillRect(0,0,canvas.width,canvas.height);
      context.drawImage(image,0,0,canvas.width,canvas.height);
      const blob=await new Promise(resolve=>canvas.toBlob(resolve,'image/png'));
      if(!blob)throw new Error('Impossibile esportare il grafico.');
      return blob;
    }finally{URL.revokeObjectURL(url);}
  }
  async function save(type,options,job) {
    if(type==='csv'){options.csv();return;}
    const source=options.svg();if(!source)return;
    const previews=(options.previews?.()??[]).flatMap(preview=>{
      const point=sourcePoint(source,preview);return point?[{...preview,source:point}]:[];
    });
    const chart=cloneChart(source,options.title);
    const frames=await previewFrames(previews,job);
    const measureContext=document.createElement('canvas').getContext('2d');measureContext.font='13px Arial';
    const model=root.MetricsExportLayout.compose(chart.width,chart.height,frames,{measure:text=>measureContext.measureText(text).width});
    if(type==='pptx'){
      await job.step('Preparazione PowerPoint modificabile…');
      const blob=await root.MetricsPptxExport.create({title:options.title,chart:chart.element,model});
      download(blob,filename(options.title,'pptx'));return;
    }
    const svg=composeSvg(chart.element,model,options.title);
    download(type==='svg'?blobFromSvg(svg):await pngFromSvg(svg,model.width,model.height),filename(options.title,type));
  }
  for(const [type,label]of [['csv','CSV · vista'],['csv-summary','CSV · solo media e IC 95%'],['png','PNG · grafico e PiP'],['svg','SVG · grafico e PiP'],['pptx','PowerPoint · modificabile']]){
    const item=document.createElement('button');item.type='button';item.textContent=label;item.dataset.format=type;item.setAttribute('role','menuitem');
    item.onclick=()=>{
      const options=current;if(!options)return;close();
      const operation=type==='csv'?Promise.resolve(options.csv()):type==='csv-summary'?Promise.resolve(options.csvSummary()):root.MetricsBusy.run('Esportazione della vista…',job=>save(type,options,job));
      operation.catch(error=>{
        const host=options.anchor.closest('.chart-navigation');let message=host.querySelector('.chart-export-error');
        if(!message){message=document.createElement('p');message.className='chart-export-error';message.setAttribute('role','alert');host.append(message);}
        message.textContent=error.message;
      });
    };menu.append(item);
  }
  menu.addEventListener('keydown',event=>{
    if(!['ArrowDown','ArrowUp','Home','End'].includes(event.key))return;
    event.preventDefault();
    const items=[...menu.querySelectorAll('button')].filter(button=>!button.hidden),index=items.indexOf(document.activeElement);
    const next=event.key==='Home'?0:event.key==='End'?items.length-1:(index+(event.key==='ArrowDown'?1:items.length-1))%items.length;
    items[next].focus();
  });
  root.MetricsChartExport={open(anchor,options){
    if(current?.anchor===anchor&&menu.matches(':popover-open')){close();return;}
    close();current={...options,anchor};menu.querySelector('[data-format="csv"]').textContent=options.csvLabel||'CSV';menu.querySelector('[data-format="csv-summary"]').hidden=typeof options.csvSummary!=='function';anchor.setAttribute('aria-expanded','true');
    anchor.closest('.chart-navigation').querySelector('.chart-export-error')?.remove();
    menu.showPopover();
    const bounds=anchor.getBoundingClientRect();
    menu.style.left=Math.max(8,Math.min(bounds.left,innerWidth-menu.offsetWidth-8))+'px';
    menu.style.top=Math.max(8,Math.min(bounds.bottom+6,innerHeight-menu.offsetHeight-8))+'px';
    menu.querySelector('button').focus({preventScroll:true});
  }};
})(globalThis);
