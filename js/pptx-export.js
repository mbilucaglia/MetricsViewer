(function(root) {
  'use strict';
  const P='http://schemas.openxmlformats.org/presentationml/2006/main';
  const A='http://schemas.openxmlformats.org/drawingml/2006/main';
  const emu=value=>Math.round(value*914400);
  let loading;
  function script(name,globalName) {
    if(root[globalName])return Promise.resolve();
    return root.MetricsLocalLibrary.load(globalName,new URL('js/vendor/'+name,document.baseURI).href);
  }
  function libraries() {
    if(!loading)loading=script('jszip.min.js','JSZip').then(()=>script('pptxgen.min.js','PptxGenJS')).catch(error=>{loading=null;throw error;});
    return loading;
  }
  function xmlElement(doc,ns,name,attrs={}) {
    const element=doc.createElementNS(ns,name);
    for(const [key,value]of Object.entries(attrs))element.setAttribute(key,String(value));
    return element;
  }
  function svgData(svg) {
    return new Promise((resolve,reject)=>{
      const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=reject;
      reader.readAsDataURL(new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml'}));
    });
  }
  function hex(color) {
    const context=document.createElement('canvas').getContext('2d');context.fillStyle=color;
    return context.fillStyle.replace('#','').toUpperCase();
  }
  function findDrawing(doc,name) {
    const meta=[...doc.getElementsByTagNameNS(P,'cNvPr')].find(element=>element.getAttribute('name')===name);
    if(!meta)throw new Error('Oggetto PowerPoint mancante: '+name);
    const tree=doc.getElementsByTagNameNS(P,'spTree')[0];
    let node=meta;
    while(node.parentNode!==tree)node=node.parentNode;
    return {meta,node,id:meta.getAttribute('id')};
  }
  function groupDrawings(doc,names,rectangle,groupId,name) {
    const tree=doc.getElementsByTagNameNS(P,'spTree')[0];
    const nodes=names.map(name=>findDrawing(doc,name).node);
    const group=xmlElement(doc,P,'p:grpSp');
    const props=xmlElement(doc,P,'p:nvGrpSpPr');
    props.append(xmlElement(doc,P,'p:cNvPr',{id:groupId,name}),xmlElement(doc,P,'p:cNvGrpSpPr'),xmlElement(doc,P,'p:nvPr'));
    const transform=xmlElement(doc,A,'a:xfrm');
    transform.append(xmlElement(doc,A,'a:off',{x:emu(rectangle.x),y:emu(rectangle.y)}),
      xmlElement(doc,A,'a:ext',{cx:emu(rectangle.w),cy:emu(rectangle.h)}),
      xmlElement(doc,A,'a:chOff',{x:emu(rectangle.x),y:emu(rectangle.y)}),
      xmlElement(doc,A,'a:chExt',{cx:emu(rectangle.w),cy:emu(rectangle.h)}));
    const groupProps=xmlElement(doc,P,'p:grpSpPr');groupProps.append(transform);
    group.append(props,groupProps);tree.insertBefore(group,nodes[0]);
    for(const node of nodes)group.append(node);
  }
  function connector(doc,id,sourceId,targetId,start,end,color) {
    const drawing=xmlElement(doc,P,'p:cxnSp'),nonVisual=xmlElement(doc,P,'p:nvCxnSpPr');
    const connections=xmlElement(doc,P,'p:cNvCxnSpPr');
    connections.append(xmlElement(doc,A,'a:stCxn',{id:sourceId,idx:4}),xmlElement(doc,A,'a:endCxn',{id:targetId,idx:0}));
    nonVisual.append(xmlElement(doc,P,'p:cNvPr',{id,name:'Collegamento '+id}),connections,xmlElement(doc,P,'p:nvPr'));
    const props=xmlElement(doc,P,'p:spPr');
    const transform=xmlElement(doc,A,'a:xfrm',{...(end.x<start.x?{flipH:1}:{}),...(end.y<start.y?{flipV:1}:{})});
    transform.append(xmlElement(doc,A,'a:off',{x:emu(Math.min(start.x,end.x)),y:emu(Math.min(start.y,end.y))}),
      xmlElement(doc,A,'a:ext',{cx:emu(Math.max(.00001,Math.abs(end.x-start.x))),cy:emu(Math.max(.00001,Math.abs(end.y-start.y)))}));
    const geometry=xmlElement(doc,A,'a:prstGeom',{prst:'straightConnector1'});geometry.append(xmlElement(doc,A,'a:avLst'));
    const line=xmlElement(doc,A,'a:ln',{w:12700});
    const fill=xmlElement(doc,A,'a:solidFill');fill.append(xmlElement(doc,A,'a:srgbClr',{val:color}));
    line.append(fill,xmlElement(doc,A,'a:headEnd',{type:'none'}),xmlElement(doc,A,'a:tailEnd',{type:'none'}));
    props.append(transform,geometry,line);drawing.append(nonVisual,props);return drawing;
  }
  function patchSlide(xml,model,unit) {
    const doc=new DOMParser().parseFromString(xml,'application/xml');
    if(doc.querySelector('parsererror'))throw new Error('Documento PowerPoint non valido.');
    let nextId=Math.max(...[...doc.getElementsByTagNameNS(P,'cNvPr')].map(element=>Number(element.getAttribute('id'))))+1;
    const tree=doc.getElementsByTagNameNS(P,'spTree')[0];
    for(const card of model.cards) {
      const key='pip-'+card.index,point=findDrawing(doc,'point-'+card.index),frame=findDrawing(doc,key+'-frame');
      const adjustment=frame.node.getElementsByTagNameNS(A,'avLst')[0];
      adjustment?.append(xmlElement(doc,A,'a:gd',{name:'adj',fmla:'val '+Math.round(600000/Math.min(card.width,card.height))}));
      const names=[key+'-frame',...(card.frame?[key+'-image']:[]),key+'-number',key+'-caption'];
      if(!card.frame)names.push(key+'-missing');
      groupDrawings(doc,names,{x:card.x*unit,y:card.y*unit,w:card.width*unit,h:card.height*unit},nextId++,'PiP '+(card.index+1));
      const start={x:card.source.x*unit,y:(model.header+card.source.y+card.source.radius)*unit};
      const end={x:(card.x+card.width/2)*unit,y:card.y*unit};
      // Attach to the frame inside the group. PowerPoint groups have no connection sites.
      tree.insertBefore(connector(doc,nextId++,point.id,frame.id,start,end,hex(card.color)),point.node);
    }
    if(model.cards.length)groupDrawings(doc,['Grafico vettoriale',...model.cards.map(card=>'point-'+card.index)],
      {x:0,y:model.chart.y*unit,w:model.chart.width*unit,h:model.chart.height*unit},nextId++,'Grafico e punti');
    return new XMLSerializer().serializeToString(doc);
  }
  async function create({title,chart,model}) {
    await libraries();
    const deck=new root.PptxGenJS();
    const unit=13.333333/model.width;
    const countPerSlide=Math.max(1,Math.min(3,Math.floor((model.width-30)/234)));
    const groups=model.cards.length?Array.from({length:Math.ceil(model.cards.length/countPerSlide)},(_,index)=>model.cards.slice(index*countPerSlide,(index+1)*countPerSlide)):[[]];
    const measureContext=document.createElement('canvas').getContext('2d');measureContext.font='13px Arial';
    const pages=groups.map(cards=>root.MetricsExportLayout.compose(model.width,model.chart.height,cards,{measure:text=>measureContext.measureText(text).width}));
    const slideHeight=Math.max(7.5,...pages.map(page=>page.height*unit));
    if(slideHeight>55)throw new Error('Riduci l’altezza del grafico prima di esportarlo in PowerPoint.');
    deck.defineLayout({name:'METRICS_VIEW',width:13.333333,height:slideHeight});deck.layout='METRICS_VIEW';
    deck.author='MetricsViewer';deck.subject=title;deck.title=title;deck.lang='it-IT';
    for(const [pageIndex,page]of pages.entries()) {
      const slide=deck.addSlide();slide.background={color:'FFFFFF'};
      slide.addText(title+(pages.length>1?' · '+(pageIndex+1)+'/'+pages.length:''),{x:20*unit,y:7*unit,w:(model.width-40)*unit,h:28*unit,
        fontFace:'Arial',fontSize:17*unit*72,color:'25234A',bold:true,margin:0,objectName:'Titolo'});
      const background=chart.cloneNode(true);
      background.removeAttribute('x');background.removeAttribute('y');
      for(const card of page.cards)background.querySelector('[data-preview-index="'+card.index+'"] .preview-badge')?.remove();
      slide.addImage({data:await svgData(background),x:0,y:page.chart.y*unit,w:page.chart.width*unit,h:page.chart.height*unit,objectName:'Grafico vettoriale'});
      for(const card of page.cards) {
        const color=hex(card.color),key='pip-'+card.index,radius=card.source.radius;
        slide.addText(String(card.index+1),{shape:deck.ShapeType.ellipse,x:(card.source.x-radius)*unit,y:(page.header+card.source.y-radius)*unit,
          w:radius*2*unit,h:radius*2*unit,fontFace:'Arial',fontSize:12*unit*72,color:'FFFFFF',bold:true,align:'center',valign:'mid',
          fill:{color},line:{color:'FFFFFF',width:1},margin:0,objectName:'point-'+card.index});
        slide.addShape(deck.ShapeType.roundRect,{x:card.x*unit,y:card.y*unit,w:card.width*unit,h:card.height*unit,
          radius:.08,fill:{color:'FAFAFE'},line:{color:'DFE1EF',width:.7},objectName:key+'-frame'});
        if(card.frame) {
          const scale=Math.min(card.image.width/card.frameWidth,card.image.height/card.frameHeight);
          const width=card.frameWidth*scale,height=card.frameHeight*scale;
          slide.addImage({data:card.frame,x:(card.image.x+(card.image.width-width)/2)*unit,
            y:(card.image.y+(card.image.height-height)/2)*unit,w:width*unit,h:height*unit,objectName:key+'-image'});
        } else slide.addText('Video non associato',{x:card.image.x*unit,y:card.image.y*unit,w:card.image.width*unit,h:card.image.height*unit,
          fontFace:'Arial',fontSize:13*unit*72,color:'686887',align:'center',valign:'mid',margin:0,objectName:key+'-missing'});
        slide.addText(String(card.index+1),{shape:deck.ShapeType.ellipse,x:(card.x+9)*unit,y:(card.y+Math.min(card.captionHeight/2,24)-11)*unit,
          w:22*unit,h:22*unit,fontFace:'Arial',fontSize:12*unit*72,color:'FFFFFF',bold:true,align:'center',valign:'mid',fill:{color},line:{color,transparency:100},margin:0,objectName:key+'-number'});
        slide.addText(card.lines.join('\n'),{x:(card.x+38)*unit,y:(card.y+8)*unit,w:(card.width-44)*unit,h:(card.captionHeight-10)*unit,
          fontFace:'Arial',fontSize:13*unit*72,color:'25234A',valign:'top',breakLine:false,margin:0,lineSpacingMultiple:1,objectName:key+'-caption'});
      }
    }
    const zip=await root.JSZip.loadAsync(await deck.write({outputType:'arraybuffer'}));
    for(const [index,page]of pages.entries()) {
      const path='ppt/slides/slide'+(index+1)+'.xml';
      zip.file(path,patchSlide(await zip.file(path).async('string'),page,unit));
    }
    return zip.generateAsync({type:'blob',compression:'DEFLATE',mimeType:'application/vnd.openxmlformats-officedocument.presentationml.presentation'});
  }
  root.MetricsPptxExport={create};
})(globalThis);
