(function () {
  'use strict';

  const layout = document.querySelector('.metrics-layout');
  const sidebar = document.getElementById('workspaceSidebar');
  const style = getComputedStyle(layout);
  const pixels = name => parseFloat(style.getPropertyValue(name));

  function connect({ divider, pane, vertical, property, limits }) {
    const dimension = vertical ? 'height' : 'width';
    const coordinate = vertical ? 'clientY' : 'clientX';
    const size = () => Math.round(pane.getBoundingClientRect()[dimension]);
    let drag = null;

    function sync() {
      if (!divider.getClientRects().length) return;
      const { min, max } = limits();
      const current = size();
      divider.setAttribute('aria-valuemin', String(min));
      divider.setAttribute('aria-valuemax', String(max));
      divider.setAttribute('aria-valuenow', String(current));
      divider.setAttribute('aria-valuetext', current + ' pixel');
    }

    function resize(value) {
      const { min, max } = limits();
      layout.style.setProperty(property, Math.round(Math.max(min, Math.min(max, value))) + 'px');
      sync();
    }

    divider.addEventListener('pointerdown', event => {
      if (event.button !== 0 || drag) return;
      event.preventDefault();
      divider.focus({ preventScroll: true });
      drag = { id: event.pointerId, position: event[coordinate], size: size() };
      divider.setPointerCapture(event.pointerId);
      divider.classList.add('is-dragging');
    });

    document.addEventListener('pointermove', event => {
      if (drag?.id !== event.pointerId) return;
      const delta = event[coordinate] - drag.position;
      resize(drag.size + (vertical ? delta : -delta));
    });

    function stopDragging(event) {
      if (!drag || (event.pointerId !== undefined && event.pointerId !== drag.id)) return;
      drag = null;
      divider.classList.remove('is-dragging');
    }
    document.addEventListener('pointerup', stopDragging);
    document.addEventListener('pointercancel', stopDragging);
    divider.addEventListener('lostpointercapture', stopDragging);
    window.addEventListener('blur', stopDragging);

    divider.addEventListener('keydown', event => {
      let value = size();
      const step = event.shiftKey ? 40 : 10;
      if (event.key === (vertical ? 'ArrowDown' : 'ArrowLeft')) value += step;
      else if (event.key === (vertical ? 'ArrowUp' : 'ArrowRight')) value -= step;
      else if (event.key === 'Home') value = limits().min;
      else if (event.key === 'End') value = limits().max;
      else return;
      event.preventDefault();
      resize(value);
    });

    divider.addEventListener('dblclick', () => {
      layout.style.removeProperty(property);
      sync();
    });

    const observer = new ResizeObserver(sync);
    observer.observe(layout);
    observer.observe(pane);
    observer.observe(divider);
  }

  connect({
    divider: document.getElementById('workspaceDivider'), pane: sidebar, vertical: false,
    property: '--sidebar-width',
    limits: () => {
      const min = pixels('--sidebar-min');
      const available = layout.clientWidth - pixels('--workspace-main-min') - pixels('--workspace-divider-width');
      return { min, max: Math.max(min, Math.min(pixels('--sidebar-max'), available)) };
    }
  });
  connect({
    divider: document.getElementById('videoDivider'), pane: document.getElementById('stimulusMediaFrame'), vertical: true,
    property: '--workspace-video-height',
    limits: () => ({ min: pixels('--video-min'), max: pixels('--video-max') })
  });
  const heightDivider=document.getElementById('workspaceHeightDivider');
  const desktop=window.matchMedia('(min-width: 781px)');
  let heightDrag=null,resizeFrame=null;
  const rowHeight=()=>parseFloat(getComputedStyle(layout).gridTemplateRows)||layout.getBoundingClientRect().height;
  function automaticHeight(){
    resizeFrame=null;
    const visible=!document.getElementById('workspace').hidden;
    heightDivider.hidden=!visible||!desktop.matches;
    if(!visible||!desktop.matches)return;
    // Measure in document coordinates so scrolling cannot change the workspace height.
    const top=layout.getBoundingClientRect().top+window.scrollY;
    const methods=document.querySelector('.methods');
    const margins=element=>{const css=getComputedStyle(element);return parseFloat(css.marginTop)+parseFloat(css.marginBottom);};
    const footerHeight=heightDivider.offsetHeight+margins(heightDivider)+methods.querySelector('summary').getBoundingClientRect().height+2+margins(methods)+document.querySelector('.wrap > footer').getBoundingClientRect().height;
    const padding=parseFloat(getComputedStyle(document.querySelector('.wrap')).paddingBottom);
    const available=Math.max(300,Math.floor(window.innerHeight-top-footerHeight-padding-2));
    layout.style.setProperty('--workspace-auto-height',available+'px');
    layout.style.setProperty('--workspace-auto-video-height',Math.round(Math.max(110,Math.min(200,available*.25)))+'px');
    const height=Math.round(rowHeight());
    heightDivider.setAttribute('aria-valuemin','440');
    heightDivider.setAttribute('aria-valuemax','2400');
    heightDivider.setAttribute('aria-valuenow',String(height));
    heightDivider.setAttribute('aria-valuetext',height+' pixel');
  }
  function scheduleHeight(){if(resizeFrame===null)resizeFrame=requestAnimationFrame(automaticHeight);}
  function setHeight(height){
    layout.style.setProperty('--workspace-height',Math.round(Math.max(440,Math.min(2400,height)))+'px');
    automaticHeight();
  }
  heightDivider.addEventListener('pointerdown',event=>{
    if(event.button!==0)return;
    event.preventDefault();heightDivider.focus({preventScroll:true});
    heightDrag={id:event.pointerId,y:event.clientY,height:rowHeight()};
    heightDivider.setPointerCapture(event.pointerId);heightDivider.classList.add('is-dragging');
  });
  heightDivider.addEventListener('pointermove',event=>{
    if(heightDrag?.id===event.pointerId)setHeight(heightDrag.height+event.clientY-heightDrag.y);
  });
  function stopHeight(){heightDrag=null;heightDivider.classList.remove('is-dragging');}
  for(const name of ['pointerup','pointercancel','lostpointercapture'])heightDivider.addEventListener(name,stopHeight);
  window.addEventListener('blur',stopHeight);
  heightDivider.addEventListener('keydown',event=>{
    if(event.key==='Home'){event.preventDefault();setHeight(440);}
    else if(event.key==='End'){event.preventDefault();setHeight(2400);}
    else if(event.key==='ArrowUp'||event.key==='ArrowDown'){event.preventDefault();setHeight(rowHeight()+(event.key==='ArrowUp'?-1:1)*(event.shiftKey?50:20));}
  });
  heightDivider.addEventListener('dblclick',()=>{layout.style.removeProperty('--workspace-height');automaticHeight();});
  window.addEventListener('resize',scheduleHeight);
  const chromeObserver=new ResizeObserver(scheduleHeight);
  for(const selector of ['.workspace-nav','.page-header','.import-panel','#errors'])chromeObserver.observe(document.querySelector(selector));
  new MutationObserver(scheduleHeight).observe(document.getElementById('workspace'),{attributes:true,attributeFilter:['hidden']});
  automaticHeight();
})();
