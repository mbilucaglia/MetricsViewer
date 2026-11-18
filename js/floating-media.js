(function(root){
  'use strict';
  function create({document:doc=root.document,window:win=root,onClose=()=>{},dock=null}={}){
    const windows=new Map(),ns='http://www.w3.org/2000/svg';
    let overlay=null,active=null,frame=null;
    const clamp=(n,low,high)=>Math.max(low,Math.min(Math.max(low,high),n));
    function mark(anchor,open){anchor?.classList.toggle('is-open',open);anchor?.setAttribute('aria-expanded',String(open));}
    function front(item){active=item.index;for(const other of windows.values())other.box.classList.toggle('is-front',other===item);}
    function position(item){
      if(dock)return;
      const {box,anchor,line}=item;
      const width=box.offsetWidth,height=box.offsetHeight;
      const viewportWidth=doc.documentElement?.clientWidth||win.innerWidth;
      item.x=clamp(item.x,8,viewportWidth-width-8);item.y=clamp(item.y,8,win.innerHeight-height-8);
      box.style.left=`${item.x}px`;box.style.top=`${item.y}px`;
      const a=anchor?.isConnected?anchor.getBoundingClientRect():null;
      const visible=item.linked&&a&&a.bottom>=0&&a.top<=win.innerHeight&&a.right>=0&&a.left<=win.innerWidth;
      line.classList.toggle('is-hidden',!visible);
      if(!visible)return;
      const x=(a.left+a.right)/2,y=(a.top+a.bottom)/2;
      for(const [key,value]of Object.entries({x1:x,y1:y,x2:clamp(x,item.x,item.x+width),y2:clamp(y,item.y,item.y+height)}))line.setAttribute(key,value);
    }
    function update(){frame=null;for(const item of windows.values())position(item);}
    function schedule(){if(frame===null)frame=win.requestAnimationFrame(update);}
    function escape(event){if(event.key==='Escape'&&!event.defaultPrevented&&!event.target?.closest?.('dialog[open]')&&windows.has(active)){event.preventDefault();close(active,true);}}
    function start(){
      if(!dock){
        overlay=doc.createElementNS(ns,'svg');overlay.classList.add('moment-pip-links');overlay.setAttribute('aria-hidden','true');doc.body.append(overlay);
        win.addEventListener('resize',schedule);doc.addEventListener('scroll',schedule,true);
      }
      doc.addEventListener('keydown',escape);
    }
    function stop(){
      win.removeEventListener('resize',schedule);doc.removeEventListener('scroll',schedule,true);doc.removeEventListener('keydown',escape);
      if(frame!==null)win.cancelAnimationFrame(frame);frame=null;overlay?.remove();overlay=null;active=null;
    }
    function close(index,restoreFocus=false){
      const item=windows.get(index);if(!item)return;
      if (item.popup?.open) item.popup.close('cancel');
      item.popup?.remove();
      if (item.summary) item.row.prepend(item.summary);
      windows.delete(index);item.observer?.disconnect();mark(item.anchor,false);item.line?.remove();onClose(index,item.row);item.box.remove();
      if(restoreFocus&&item.anchor?.isConnected)item.anchor.focus({preventScroll:true});
      if(!windows.size)stop();else front([...windows.values()].at(-1));
    }
    function open(index,anchor,row,label,color='#4935a6',reveal=true){
      if (windows.has(index)) {
        const item = windows.get(index);
        mark(item.anchor, false);
        item.anchor = anchor;
        mark(anchor, true);
        position(item);
        if (reveal) { front(item); item.handle.focus({preventScroll:true}); }
        return item;
      }
      if(!windows.size)start();
      const box=doc.createElement('section');box.className='moment-pip';box.classList.add('is-compact');box.setAttribute('role',dock?'group':'dialog');box.setAttribute('aria-label',dock?`Anteprima ${index+1} · ${label}`:label);
      if(dock){
        box.classList.add('is-docked');
        box.dataset.index=index;
      }
      box.setAttribute('style', '--preview-color: ' + color);
      const header=doc.createElement('div');header.className='moment-pip__header';
      const handle=doc.createElement('button');handle.type='button';handle.className='moment-pip__drag';handle.textContent=`⋮⋮ ${index+1}`;handle.title=label;handle.setAttribute('aria-label',`Sposta frammento ${index+1}: trascina o usa le frecce`);
      const link=doc.createElement('button');link.type='button';link.className='moment-pip__link';link.textContent='↗';link.title='Mostra/nascondi collegamento';link.setAttribute('aria-pressed','true');link.setAttribute('aria-label','Mostra il segmento di collegamento al punto');
      const dismiss=doc.createElement('button');dismiss.type='button';dismiss.textContent='×';dismiss.setAttribute('aria-label','Chiudi anteprima');dismiss.onclick=()=>close(index,true);
      const controls=doc.createElement('button');controls.type='button';controls.className='moment-pip__controls';controls.textContent='⋯';controls.title='Apri controlli';controls.setAttribute('aria-label','Apri controlli di riproduzione ed esportazione');controls.setAttribute('aria-haspopup','dialog');controls.setAttribute('aria-expanded','false');
      const summary = row.querySelector?.('.preview-summary');
      let line=null;
      if(dock){
        const badge=doc.createElement('span');badge.className='moment-pip__number';badge.textContent=String(index+1);
        badge.setAttribute('style', '--preview-color: ' + color);
        header.append(badge);
        if (summary) header.append(summary);
        header.append(controls,dismiss);
        box.append(header,row);
        const next=Array.from(dock.children).find(child=>Number(child.dataset.index)>index);
        dock.insertBefore(box,next||null);
      }else{
        header.append(handle);
        if (summary) header.append(summary);
        header.append(link,controls,dismiss);box.append(header,row);doc.body.append(box);
        line=doc.createElementNS(ns,'line');overlay.append(line);
      }
      const a=dock ? {right:0,top:0} : anchor.getBoundingClientRect(),offset=(windows.size%6)*24;
      const item={index,box,row,anchor,line,summary,handle:dock?dismiss:handle,controls,compact:true,linked:true,x:a.right+12+offset,y:a.top-box.offsetHeight/2+offset};windows.set(index,item);mark(anchor,true);
      box.addEventListener('pointerdown',()=>front(item));box.addEventListener('focusin',()=>front(item));
      link.onclick=()=>{item.linked=!item.linked;link.setAttribute('aria-pressed',String(item.linked));position(item);};
      controls.onclick = () => {
        if (item.popup) return;
        const popup = doc.createElement('dialog');
        popup.className = 'settings-dialog moment-pip-popup';
        popup.setAttribute('aria-label', 'Controlli anteprima ' + (index + 1));
        const title = doc.createElement('h2');
        title.textContent = summary ? [...summary.children].map(line => line.textContent).join(' · ') : 'Anteprima ' + (index + 1);
        const top = doc.createElement('header');
        top.className = 'settings-dialog-header';
        const dismissPopup = doc.createElement('button');
        dismissPopup.type = 'button';
        dismissPopup.textContent = '×';
        dismissPopup.className = 'settings-dialog-close';
        dismissPopup.setAttribute('data-dismiss', '');
        dismissPopup.setAttribute('aria-label', 'Chiudi senza salvare');
        dismissPopup.onclick = () => popup.close('cancel');
        if (summary) {
          const number = doc.createElement('span');
          number.className = 'moment-pip__number';
          number.textContent = String(index + 1);
          number.setAttribute('style', '--preview-color: ' + color);
          top.append(number);
        }
        top.append(title, dismissPopup);
        const body = doc.createElement('div');
        body.className = 'settings-dialog-body';
        const video = row.querySelector('video');
        const initialVolume = video?.volume;
        video?.pause();
        const moved = [];
        for (const element of row.querySelectorAll(':scope > .segment-player, :scope > span, :scope > button, :scope > .panel-note')) {
          if (summary && element.tagName === 'SPAN') continue;
          const placeholder = doc.createComment('PIP control');
          element.before(placeholder);
          moved.push({element, placeholder});
          body.append(element);
        }
        const footer = doc.createElement('footer');
        footer.className = 'settings-dialog-actions';
        const cancel = doc.createElement('button'), ok = doc.createElement('button');
        cancel.type = ok.type = 'button';
        cancel.textContent = 'Annulla'; ok.textContent = 'OK';
        cancel.setAttribute('data-dismiss', '');
        ok.setAttribute('data-confirm', '');
        cancel.onclick = () => popup.close('cancel');
        ok.onclick = () => popup.close('ok');
        footer.append(cancel, ok);
        popup.append(top, body, footer);
        doc.body.append(popup);
        item.popup = popup;
        controls.setAttribute('aria-expanded', 'true');
        popup.addEventListener('close', () => {
          video?.pause();
          if (popup.returnValue !== 'ok' && video) {
            video.volume = initialVolume;
            const volume = popup.querySelector('.segment-volume');
            if (volume) volume.value = String(initialVolume);
          }
          for (const {element, placeholder} of moved) placeholder.replaceWith(element);
          controls.setAttribute('aria-expanded', 'false');
          popup.remove();
          item.popup = null;
          if (controls.isConnected) controls.focus({preventScroll:true});
        }, {once: true});
        popup.showModal();
      };
      if (dock) {
        front(item);
        if (reveal) {
          box.scrollIntoView({block:'nearest',inline:'nearest'});
          dismiss.focus({preventScroll:true});
        }
        return item;
      }
      let drag=null;
      handle.addEventListener('pointerdown',event=>{
        if(event.button!==0)return;event.preventDefault();front(item);handle.focus({preventScroll:true});
        drag={id:event.pointerId,x:event.clientX,y:event.clientY,left:item.x,top:item.y};handle.setPointerCapture(event.pointerId);box.classList.add('is-dragging');
      });
      handle.addEventListener('pointermove',event=>{
        if(!drag||event.pointerId!==drag.id)return;
        item.x=drag.left+event.clientX-drag.x;item.y=drag.top+event.clientY-drag.y;position(item);
      });
      const end=()=>{drag=null;box.classList.remove('is-dragging');};
      for(const event of ['pointerup','pointercancel','lostpointercapture'])handle.addEventListener(event,end);
      handle.addEventListener('keydown',event=>{
        const delta={ArrowLeft:[-1,0],ArrowRight:[1,0],ArrowUp:[0,-1],ArrowDown:[0,1]}[event.key];if(!delta)return;
        event.preventDefault();const step=event.shiftKey?1:10;item.x+=delta[0]*step;item.y+=delta[1]*step;position(item);
      });
      if(win.ResizeObserver){item.observer=new win.ResizeObserver(schedule);item.observer.observe(box);}
      front(item);position(item);dismiss.focus({preventScroll:true});return item;
    }
    function reanchor(anchors){for(const item of windows.values()){mark(item.anchor,false);item.anchor=anchors[item.index]||null;mark(item.anchor,true);}update();}
    return {open,close,reanchor,has:index=>windows.has(index),get size(){return windows.size;},clear:()=>{for(const index of [...windows.keys()])close(index);}};
  }
  if(typeof module==='object'&&module.exports)module.exports={create};else root.MetricsFloatingMedia={create};
})(globalThis);
