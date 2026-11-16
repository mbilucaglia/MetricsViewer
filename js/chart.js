(function () {
  'use strict';

  window.createMetricsChart = function ({ C, $, node, fmt, getMode, onZoom }) {
    const svgNS='http://www.w3.org/2000/svg';
    function svgEl(tag,attrs={},text){const e=document.createElementNS(svgNS,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;return e;}
    const zoomByPlot = new Map();
    function axisValue([min, max], fraction) {
      return min + (max - min) * fraction;
    }

    function axisPanner(axis, zoom, domain, visible, categories, redraw) {
      const horizontal = axis === 'x';
      const label = axis.toUpperCase();
      const extent = domain[1] - domain[0];
      const scale = 1000;
      const endpoints = visible.map(value => (value - domain[0]) / extent * scale);
      const minimumSteps = Math.min(
        endpoints[1] - endpoints[0],
        horizontal && categories ? scale / extent : 1
      );
      const panner = node('div', undefined, 'chart-panner chart-panner--' + axis);
      panner.setAttribute('role', 'group');
      panner.setAttribute('aria-label', 'Zoom e spostamento asse ' + label);
      const track = node('div', undefined, 'chart-panner__track');
      const range = node('div', undefined, 'chart-panner__window');
      track.append(range);
      const handles = ['Minimo', 'Massimo'].map((name, index) => {
        const input = node('input');
        input.type = 'range';
        input.min = '0';
        input.max = String(scale);
        input.value = String(endpoints[index]);
        input.step = 'any';
        input.disabled = minimumSteps >= scale;
        input.dataset.zoomControl = axis + '-' + index;
        input.setAttribute('aria-label', name + ' visibile asse ' + label);
        track.append(input);
        return input;
      });
      function preview() {
        track.style.setProperty('--window-start', endpoints[0] / scale * 100 + '%');
        track.style.setProperty('--window-size', (endpoints[1] - endpoints[0]) / scale * 100 + '%');
        handles.forEach((handle, index) => {
          handle.value = String(endpoints[index]);
          if (!horizontal || !categories) {
            const value = fmt(axisValue(domain, endpoints[index] / scale));
            handle.setAttribute('aria-valuetext', horizontal ? value + ' s' : value);
          }
        });
      }
      function apply(control) {
        zoom[axis] = endpoints.map(value => axisValue(domain, value / scale));
        redraw(control);
      }
      handles.forEach((handle, index) => {
        handle.oninput = () => {
          endpoints[index] = index === 0
            ? Math.min(Number(handle.value), endpoints[1] - minimumSteps)
            : Math.max(Number(handle.value), endpoints[0] + minimumSteps);
          preview();
        };
        handle.onchange = () => apply(handle.dataset.zoomControl);
      });
      let drag = null;
      track.addEventListener('pointerdown', event => {
        const index = handles.indexOf(event.target);
        const isPan = event.target === range && endpoints[1] - endpoints[0] < scale;
        if (!event.isPrimary || event.button !== 0 || (!isPan && (index < 0 || minimumSteps >= scale))) return;
        event.preventDefault();
        if (!isPan) handles[index].focus({ preventScroll: true });
        track.setPointerCapture(event.pointerId);
        drag = { id: event.pointerId, start: horizontal ? event.clientX : -event.clientY,
          initial: [...endpoints], index, isPan };
      });
      track.addEventListener('pointermove', event => {
        if (drag?.id !== event.pointerId) return;
        const rect = track.getBoundingClientRect();
        const distance = (horizontal ? event.clientX : -event.clientY) - drag.start;
        const offset = distance / (horizontal ? rect.width : rect.height) * scale;
        const [lower, upper] = drag.initial;
        if (drag.isPan) {
          const size = upper - lower;
          endpoints[0] = Math.max(0, Math.min(scale - size, lower + offset));
          endpoints[1] = endpoints[0] + size;
        } else if (drag.index === 0) {
          endpoints[0] = Math.max(0, Math.min(upper - minimumSteps, lower + offset));
        } else {
          endpoints[1] = Math.min(scale, Math.max(lower + minimumSteps, upper + offset));
        }
        preview();
      });
      track.addEventListener('pointerup', event => {
        if (drag?.id !== event.pointerId) return;
        const changed = drag.initial.some((position, index) => position !== endpoints[index]);
        const control = handles[drag.index]?.dataset.zoomControl;
        drag = null;
        if (changed) apply(control);
      });
      for (const name of ['pointercancel', 'lostpointercapture']) {
        track.addEventListener(name, event => {
          if (drag?.id !== event.pointerId) return;
          [endpoints[0], endpoints[1]] = drag.initial;
          drag = null;
          preview();
        });
      }
      preview();
      panner.append(track);
      return panner;
    }

    function zoomTools(zoom, redraw) {
      const tools = node('div', undefined, 'chart-zoom-tools');
      tools.setAttribute('role', 'group');
      tools.setAttribute('aria-label', 'Controlli di zoom');
      function auto(axis) {
        const label = axis.toUpperCase();
          const auto = node('button', 'Auto ' + label);
          auto.setAttribute('aria-label', 'Scala automatica asse ' + label);
          auto.title = 'Scala automatica asse ' + label;
          auto.dataset.zoomControl = axis + '-auto';
          auto.setAttribute('aria-disabled', String(zoom[axis] === null));
          auto.onclick = () => {
            if (zoom[axis] === null) return;
            zoom[axis] = null;
            redraw(auto.dataset.zoomControl);
          };
        return auto;
      }
      function iconButton(id, label, paths, action) {
        const button = node('button');
        button.dataset.zoomControl = id;
        button.title = label;
        button.setAttribute('aria-label', label);
        const icon = svgEl('svg', {
          viewBox: '0 0 24 24', class: 'chart-tool-icon', 'aria-hidden': 'true',
          fill: 'none', stroke: 'currentColor', 'stroke-width': 1.8,
          'stroke-linecap': 'round', 'stroke-linejoin': 'round'
        });
        for (const path of paths) icon.append(svgEl('path', { d: path }));
        button.append(icon);
        button.onclick = action;
        return button;
      }
      const selection = iconButton('selection', 'Zoom a selezione',
        ['M15.5 15.5 21 21', 'M18 10a8 8 0 1 1-16 0 8 8 0 0 1 16 0Z', 'M7 10h6m-3-3v6'],
        () => {
          zoom.selection = !zoom.selection;
          redraw('selection');
        });
      selection.setAttribute('aria-pressed', String(zoom.selection));
      const reset = iconButton('reset', 'Ripristina entrambi gli assi',
        ['M4 11a8 8 0 1 1 2 6', 'M4 5v6h6'],
        () => {
          if (zoom.x === null && zoom.y === null) return;
          zoom.x = zoom.y = null;
          redraw('reset');
        });
      reset.setAttribute('aria-disabled', String(zoom.x === null && zoom.y === null));
      tools.append(auto('x'), selection, reset, auto('y'));
      return tools;
    }

    function enableSubjectSelection(element, subjectId, label) {
      element.setAttribute('tabindex', '0');
      element.setAttribute('role', 'button');
      element.setAttribute('aria-label', 'Evidenzia ' + label);
      function select(event) {
        event.stopPropagation();
        document.dispatchEvent(new CustomEvent('metrics-isolate-subject', { detail: { id: subjectId } }));
      }
      element.addEventListener('click', select);
      element.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        select(event);
      });
    }

    function enableDragZoom(svg, bounds, zoom, visible, domain, categories, redraw) {
      const selection = svgEl('rect', { class: 'chart-zoom-selection', 'aria-hidden': 'true' });
      const threshold = 6;
      let drag = null;
      let suppressClick = false;

      function location(event) {
        const matrix = svg.getScreenCTM();
        if (!matrix) return null;
        const point = svg.createSVGPoint();
        point.x = event.clientX;
        point.y = event.clientY;
        return point.matrixTransform(matrix.inverse());
      }

      function area(event) {
        const point = location(event);
        if (!point) return null;
        const { left, top, width, height } = bounds;
        const x = Math.max(left, Math.min(left + width, point.x));
        const y = Math.max(top, Math.min(top + height, point.y));
        const across = x !== drag.start.x && Math.abs(event.clientX - drag.clientX) >= threshold;
        const down = y !== drag.start.y && Math.abs(event.clientY - drag.clientY) >= threshold;
        return {
          across, down,
          left: across ? Math.min(x, drag.start.x) : left,
          right: across ? Math.max(x, drag.start.x) : left + width,
          top: down ? Math.min(y, drag.start.y) : top,
          bottom: down ? Math.max(y, drag.start.y) : top + height
        };
      }

      function cancel() {
        drag = null;
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', finish);
        document.removeEventListener('pointercancel', cancel);
        window.removeEventListener('blur', cancel);
        selection.remove();
        svg.classList.remove('is-selecting');
      }

      svg.addEventListener('pointerdown', event => {
        if (!event.isPrimary || event.button !== 0 || event.pointerType === 'touch') return;
        suppressClick = false;
        const start = location(event);
        const { left, top, width, height } = bounds;
        if (!start || start.x < left || start.x > left + width || start.y < top || start.y > top + height) return;
        event.preventDefault();
        drag = { start, id: event.pointerId, clientX: event.clientX, clientY: event.clientY, active: false };
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', finish);
        document.addEventListener('pointercancel', cancel);
        window.addEventListener('blur', cancel);
      });

      function move(event) {
        if (drag?.id !== event.pointerId) return;
        const box = area(event);
        if (!box || (!box.across && !box.down && !drag.active)) return;
        if (!drag.active) {
          drag.active = true;
          svg.append(selection);
          svg.classList.add('is-selecting');
          $('tooltip').hidden = true;
        }
        selection.setAttribute('x', box.left);
        selection.setAttribute('y', box.top);
        selection.setAttribute('width', box.right - box.left);
        selection.setAttribute('height', box.bottom - box.top);
      }

      function finish(event) {
        if (drag?.id !== event.pointerId) return;
        const box = area(event);
        suppressClick = drag.active;
        cancel();
        if (!suppressClick || !box || (!box.across && !box.down)) return;
        const { left, top, width, height } = bounds;
        function select(axis, start, end) {
          const current = visible[axis];
          const isCategory = axis === 'x' && categories;
          const minimum = Math.min(current[1] - current[0],
            isCategory ? 1 : (domain[axis][1] - domain[axis][0]) * .001);
          const low = axisValue(current, start);
          const high = axisValue(current, end);
          const span = Math.max(minimum, high - low);
          let center = low + (high - low) / 2;
          if (isCategory && span === 1) center = Math.round(center);
          const first = Math.max(current[0], Math.min(current[1] - span, center - span / 2));
          zoom[axis] = [first, first + span];
        }
        if (box.across) select('x', (box.left - left) / width, (box.right - left) / width);
        if (box.down) select('y', 1 - (box.bottom - top) / height, 1 - (box.top - top) / height);
        redraw();
      }
      svg.addEventListener('click', event => {
        if (suppressClick && event.detail > 0) {
          suppressClick = false;
          event.stopImmediatePropagation();
        }
      }, true);
    }

    let momentMarkers = null;
    let lastSeriesPlot = null;
    function markMoments(points,source,onSelect){
      momentMarkers=points.length?{points,source,onSelect}:null;
      if(!lastSeriesPlot)return;
      const {traces,options}=lastSeriesPlot;
      $('chart').replaceChildren();plot(traces,options);
    }
    function plot(traces,{categories=null,xLabel='Tempo dall’inizio dell’epoca [s]',hover=null,target='chart',title=null,bars=false,comparisons=[],significancePoints=[],significanceStep=null}={}){
      const chart=$(target);
      const saved = { traces, options: {
        categories, xLabel, hover, target, title, bars, comparisons, significancePoints, significanceStep
      } };
      const usesMetricScale = target === 'chart' || target === 'statsGroupPlot';

      if(target==='chart'&&!categories){
        lastSeriesPlot = saved;
        if(momentMarkers&&!traces.some(t=>momentMarkers.source.subjectId?t.subjectId===momentMarkers.source.subjectId:!t.subjectId))traces=[...traces,momentMarkers.source];
      }

      let xmin=Infinity,xmax=-Infinity,ymin=Infinity,ymax=-Infinity;
      for(const tr of traces)for(let i=0;i<tr.x.length;i++){if(!C.finite(tr.y[i]))continue;const d=tr.band?.[i]||0;xmin=Math.min(xmin,tr.x[i]);xmax=Math.max(xmax,tr.x[i]);ymin=Math.min(ymin,tr.y[i]-d);ymax=Math.max(ymax,tr.y[i]+d);}
      if(!Number.isFinite(ymin)){chart.append(node('p','Nessun valore disponibile nell’intervallo selezionato.','empty-state'));return;}
      if(categories){xmin=-0.5;xmax=categories.length-0.5;}else if(xmin===xmax){xmin-=.5;xmax+=.5;}
      if(bars){ymin=Math.min(0,ymin);ymax=Math.max(0,ymax);}
      const pad=(ymax-ymin)*.12||Math.max(Math.abs(ymax)*.1,1);ymin-=pad;ymax+=pad;
      const automatic = { x: [xmin, xmax], y: [ymin, ymax] };
      let zoom, visible, domain, redraw;
      if (usesMetricScale) {
        const key = getMode() + ':' + target;
        if (!zoomByPlot.has(key)) zoomByPlot.set(key, { x: null, y: null, selection: false });
        zoom = zoomByPlot.get(key);
        visible = { x: zoom.x ?? automatic.x, y: zoom.y ?? automatic.y };
        // Keep both the data and the saved view reachable through the panners.
        domain = Object.fromEntries(['x', 'y'].map(axis => [axis, [
          Math.min(automatic[axis][0], visible[axis][0]),
          Math.max(automatic[axis][1], visible[axis][1])
        ]]));
        [xmin, xmax] = visible.x;
        [ymin, ymax] = visible.y;
        redraw = control => {
          $('tooltip').hidden = true;
          chart.replaceChildren();
          plot(saved.traces, saved.options);
          if (target === 'chart') onZoom();
          if (control) chart.querySelector('[data-zoom-control="' + control + '"]')?.focus({ preventScroll: true });
        };
      }

      const visibleCategory = index => index >= 0 && index >= xmin && index <= xmax;
      const significant = comparisons.filter(c => Number.isFinite(c.pAdjusted) && c.pAdjusted <= .05 &&
        categories && visibleCategory(categories.indexOf(c.epochA)) && visibleCategory(categories.indexOf(c.epochB)));
      const bracketSpace = significant.length ? 32 + significant.length * 24 : 0;
      const w=900,h=410+bracketSpace,p={l:65,r:25,t:25+bracketSpace,b:categories?70:84};
      const X=x=>p.l+(x-xmin)/(xmax-xmin)*(w-p.l-p.r),Y=y=>h-p.b-(y-ymin)/(ymax-ymin)*(h-p.t-p.b);
      const hasVideoCursor = !categories && getMode() === 'series';
      const svg=svgEl('svg',{viewBox:`0 0 ${w} ${h}`,role:hasVideoCursor||(target==='chart'&&(momentMarkers||traces.some(t=>t.subjectId)))||significancePoints.length?'group':'img','aria-label':title||$('chartTitle').textContent});
      if (zoom?.selection) {
        svg.classList.add('chart-drag-zoom');
        enableDragZoom(svg, { left: p.l, top: p.t, width: w - p.l - p.r, height: h - p.t - p.b }, zoom, visible, domain, categories, redraw);
      }
      const yStep = (ymax - ymin) / 5;
      const formatYTick = new Intl.NumberFormat('it-IT', {
        useGrouping: false,
        maximumFractionDigits: Math.min(14, Math.max(2, Math.ceil(-Math.log10(yStep))))
      });
      for (let i = 0; i <= 5; i++) {
        const value = ymin + i * yStep;
        const y = Y(value);
        const label = formatYTick.format(Math.abs(value) < yStep / 1000 ? 0 : value);
        svg.append(
          svgEl('line', { x1: p.l, x2: w - p.r, y1: y, y2: y, class: 'grid-line' }),
          svgEl('text', { x: p.l - 10, y: y + 4, 'text-anchor': 'end' }, label)
        );
      }
      const ticks=categories?categories.map((c,i)=>[i,c]).filter(([i])=>visibleCategory(i)):Array.from({length:6},(_,i)=>{const x=xmin+(xmax-xmin)*i/5;return[x,fmt(x)];});
      for(const[x,label]of ticks){const t=svgEl('text',{x:X(x),y:h-p.b+24,'text-anchor':'middle'},label.length>22?label.slice(0,20)+'…':label);t.append(svgEl('title',{},label));svg.append(t);}
      svg.append(svgEl('text',{x:w/2,y:h-12,'text-anchor':'middle'},xLabel));
      const clipId=`${target}-plot-clip`;const defs=svgEl('defs'),clip=svgEl('clipPath',{id:clipId});clip.append(svgEl('rect',{x:p.l,y:p.t,width:w-p.l-p.r,height:h-p.t-p.b}));defs.append(clip);svg.append(defs);
      if(!categories&&significancePoints.length){
        const layer=svgEl('g',{class:'significance-bars','clip-path':`url(#${clipId})`});
        for(const range of window.MetricsSignificantMedia.bands(significancePoints,significanceStep)){
          const left=Math.max(p.l,X(range.left)),right=Math.min(w-p.r,X(range.right));
          if(right<left)continue;
          const label=`${fmt(range.start)}–${fmt(range.end)} s · ${range.count} istanti significativi · p minimo ${fmt(range.minP)}. Vai al frammento video.`;
          const bar=svgEl('rect',{x:left,y:p.t,width:Math.max(1,right-left),height:h-p.t-p.b,class:'significance-bar',tabindex:0,role:'button','aria-label':label});
          bar.append(svgEl('title',{},label));
          const activate=event=>{
            event.stopPropagation();
            let time=range.peak;
            const matrix=event.type==='click'?svg.getScreenCTM():null;
            if(matrix){
              const point=svg.createSVGPoint();point.x=event.clientX;point.y=event.clientY;
              const x=point.matrixTransform(matrix.inverse()).x;
              time=xmin+(x-p.l)/(w-p.l-p.r)*(xmax-xmin);
              if(Number.isFinite(significanceStep)&&significanceStep>0)time=range.start+Math.round((time-range.start)/significanceStep)*significanceStep;
              time=Math.max(range.start,Math.min(range.end,time));
            }
            window.MetricsSignificantMedia.focusTime(time,null,bar);
          };
          bar.addEventListener('click',activate);
          bar.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();activate(event);}});
          layer.append(bar);
        }
        svg.append(layer);
        chart.append(node('p','Fasce verdi: istanti consecutivi con p finale ≤ 0,05, estesi di mezzo passo temporale ai bordi. Clicca una fascia per aprire il frammento video corrispondente.','panel-note'));
      }
      if(categories&&comparisons.length){
        significant.forEach((c,i)=>{
          const a=categories.indexOf(c.epochA),b=categories.indexOf(c.epochB);if(a<0||b<0)return;
          const y=p.t-14-i*24,stars=c.pAdjusted<=.001?'***':c.pAdjusted<=.01?'**':'*';
          const label=`${c.label||c.epochA+' – '+c.epochB}: ${stars}, p ${c.correction} = ${fmt(c.pAdjusted)}`;
          const width=Math.min(88,(X(1)-X(0))*.7/Math.max(1,traces.length));
          const xa=X(a)+(Number.isInteger(c.groupIndexA)?(c.groupIndexA-(traces.length-1)/2)*width:0),xb=X(b)+(Number.isInteger(c.groupIndexB)?(c.groupIndexB-(traces.length-1)/2)*width:0);
          const group=svgEl('g',{'aria-label':label,'data-significance':'true'});
          if(!c.single)group.append(svgEl('path',{d:`M${xa},${y+6}V${y}H${xb}V${y+6}`,stroke:'#35335b',fill:'none','stroke-width':1.5}));
          const text=svgEl('text',{x:(xa+xb)/2,y:y-4,'text-anchor':'middle'},stars);text.append(svgEl('title',{},label));group.append(text);svg.append(group);
        });
        chart.append(node('p',comparisons.some(c => Number.isFinite(c.pAdjusted) && c.pAdjusted <= .05)?'Significatività: * p ≤ 0,05 · ** p ≤ 0,01 · *** p ≤ 0,001. P-value corretti secondo il test; dettagli in tabella.':'Nessun confronto significativo dopo la correzione prevista.','panel-note'));
      }
      const barTraces=traces.filter(tr=>!tr.subjectId),individualBars=traces.filter(tr=>tr.isolationOnly);
      if(bars&&ymin<=0&&ymax>=0)svg.append(svgEl('line',{x1:p.l,x2:w-p.r,y1:Y(0),y2:Y(0),stroke:'#8e87a8','stroke-width':1}));
      const swarmPositions=new Map();
      if(categories){
        for(let i=0;i<categories.length;i++){
          const points=traces.filter(t=>t.swarm&&C.finite(t.y[i])).map(t=>({t,y:Y(t.y[i])})).sort((a,b)=>a.y-b.y||a.t.name.localeCompare(b.t.name));
          const placed=[];
          for(const point of points){
            const candidates=[0];
            for(const q of placed){const dy=point.y-q.y;if(Math.abs(dy)<9){const dx=Math.sqrt(81-dy*dy);candidates.push(q.dx-dx,q.dx+dx);}}
            candidates.sort((a,b)=>Math.abs(a)-Math.abs(b)||a-b);
            point.dx=candidates.find(dx=>placed.every(q=>(dx-q.dx)**2+(point.y-q.y)**2>=81-1e-7))??0;placed.push(point);
          }
          const extent=Math.max(4,...placed.map(q=>Math.abs(q.dx)+4)),scale=Math.min(1,(X(1)-X(0))*.32/extent);
          for(const q of placed){if(!swarmPositions.has(q.t))swarmPositions.set(q.t,[]);swarmPositions.get(q.t)[i]={dx:q.dx*scale,r:4*scale};}
        }
      }
      for(const tr of traces){
        const traceLayer=svgEl('g',{'data-trace-subject':tr.subjectId||''});
        traceLayer.setAttribute('clip-path',`url(#${clipId})`);
        if(tr.isolationOnly){traceLayer.dataset.isolationOnly='true';}
        svg.append(traceLayer);
        if(tr.swarm&&categories){
          for(let i=0;i<tr.x.length;i++){
            if(!C.finite(tr.y[i]) || !visibleCategory(tr.x[i]) || tr.y[i] < ymin || tr.y[i] > ymax)continue;
            const point=swarmPositions.get(tr)[i],label=`${tr.name} · ${categories[i]}: ${fmt(tr.y[i])}`;
            const circle=svgEl('circle',{cx:X(tr.x[i])+point.dx,cy:Y(tr.y[i]),r:point.r,fill:tr.color,stroke:'white','stroke-width':.6});
            circle.append(svgEl('title',{},label));
            enableSubjectSelection(circle, tr.subjectId, label);
            traceLayer.append(circle);
          }
          continue;
        }
        if(bars&&categories){
          const peers=tr.isolationOnly?individualBars:barTraces,slot=peers.indexOf(tr),step=X(1)-X(0),width=Math.min(88,step*.7/Math.max(1,peers.length));
          for(let i=0;i<tr.x.length;i++){
            if(!C.finite(tr.y[i]))continue;
            const x=X(tr.x[i])+(slot-(peers.length-1)/2)*width,y=Y(tr.y[i]),half=tr.band?.[i],n=tr.n?.[i];
            const label=`${tr.name} · ${categories[i]}: ${fmt(tr.y[i])}${tr.band?(C.finite(half)?` · ${tr.bandLabel||'IC 95%'} [${fmt(tr.y[i]-half)}, ${fmt(tr.y[i]+half)}]`:` · ${tr.bandLabel||'IC 95%'} non disponibile (N < 2)`):''}${n!==undefined?` · N=${n}`:''}`;
            const bar=svgEl('rect',{x:x-width*.43,y:Math.min(Y(0),y),width:width*.86,height:Math.max(.8,Math.abs(y-Y(0))),fill:tr.color,opacity:tr.isolationOnly?.9:.78,rx:2});
            bar.append(svgEl('title',{},label));traceLayer.append(bar);
            if(C.finite(half)){
              const low=Y(tr.y[i]-half),high=Y(tr.y[i]+half),cap=Math.min(9,width*.3);
              const error=svgEl('path',{d:`M${x},${low}V${high} M${x-cap},${low}H${x+cap} M${x-cap},${high}H${x+cap}`,fill:'none',stroke:tr.color,'stroke-width':2});
              error.append(svgEl('title',{},label));traceLayer.append(error);
            }
          }
          continue;
        }
        if(tr.band && !categories){let run=[];const flush=()=>{if(run.length>1){const pts=run.map(i=>`${X(tr.x[i])},${Y(tr.y[i]+tr.band[i])}`).concat([...run].reverse().map(i=>`${X(tr.x[i])},${Y(tr.y[i]-tr.band[i])}`)).join(' ');traceLayer.append(svgEl('polygon',{points:pts,fill:tr.color,opacity:'.12'}));}run=[];};for(let i=0;i<tr.x.length;i++){if(C.finite(tr.y[i])&&C.finite(tr.band[i]))run.push(i);else flush();}flush();}
        if (!categories && tr.x.length > 1) {
          let path = '', open = false;
          for (let i = 0; i < tr.x.length; i++) {
            if (!C.finite(tr.y[i])) { open = false; continue; }
            path += `${open ? 'L' : 'M'}${X(tr.x[i])},${Y(tr.y[i])} `;
            open = true;
          }
          const line = svgEl('path', { d: path, fill: 'none', stroke: tr.color, 'stroke-width': tr.bold ? 2.8 : 1.4, opacity: tr.bold ? 1 : .7 });
          if (target === 'chart' && tr.subjectId && path.includes('L')) enableSubjectSelection(line, tr.subjectId, tr.name);
          traceLayer.append(line);
        }
        if(categories||tr.x.length===1)for(let i=0;i<tr.x.length;i++){if(!C.finite(tr.y[i]))continue;const x=X(tr.x[i]),y=Y(tr.y[i]);if(tr.band&&C.finite(tr.band[i]))traceLayer.append(svgEl('line',{x1:x,x2:x,y1:Y(tr.y[i]-tr.band[i]),y2:Y(tr.y[i]+tr.band[i]),stroke:tr.color,'stroke-width':2}));const circle=svgEl('circle',{cx:x,cy:y,r:tr.bold?6:4,fill:tr.color,opacity:tr.bold?1:.65});circle.append(svgEl('title',{},`${tr.name}: ${fmt(tr.y[i])}`));traceLayer.append(circle);}
      }
      if(hover){svg.addEventListener('pointermove',event=>{if(svg.classList.contains('is-selecting'))return;const rect=svg.getBoundingClientRect(),x=xmin+((event.clientX-rect.left)/rect.width*w-p.l)/(w-p.l-p.r)*(xmax-xmin);$('tooltip').textContent=hover(x);$('tooltip').hidden=false;$('tooltip').style.left=Math.max(5,Math.min(event.clientX+12,window.innerWidth-320))+'px';$('tooltip').style.top=Math.max(5,Math.min(event.clientY+12,window.innerHeight-110))+'px';});svg.addEventListener('pointerleave',()=>{$('tooltip').hidden=true;});}
      const momentAnchors=[];
      if(target==='chart'&&!categories&&momentMarkers){
        const layer=svgEl('g',{class:'moment-markers','aria-label':'Istanti estratti','clip-path':'url(#'+clipId+')'});
        momentMarkers.points.forEach((point,index)=>{
          if (point.peak < xmin || point.peak > xmax || point.value < ymin || point.value > ymax) return;
          const circle=svgEl('circle',{cx:X(point.peak),cy:Y(point.value),r:8,class:'moment-marker',tabindex:0,role:'button','aria-pressed':'false','aria-label':`${point.label}. Apri il frammento corrispondente.`});
          circle.append(svgEl('title',{},point.label));
          const activate=event=>{event.stopPropagation();for(const other of layer.children){other.classList.toggle('is-selected',other===circle);other.setAttribute('aria-pressed',String(other===circle));}momentMarkers.onSelect(index,circle);};
          circle.addEventListener('click',activate);
          circle.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();activate(event);}});
          layer.append(circle);momentAnchors[index] = circle;
        });
        svg.append(layer);
      }
      if (zoom) {
        const layout = node('div', undefined, 'chart-plot-layout');
        const viewport = node('div', undefined, 'chart-plot-viewport');
        viewport.append(svg);
        const horizontal = axisPanner('x', zoom, domain.x, visible.x, categories, redraw);
        horizontal.append(zoomTools(zoom, redraw));
        layout.append(viewport, axisPanner('y', zoom, domain.y, visible.y, categories, redraw), horizontal);
        chart.append(layout);
      } else {
        chart.append(svg);
      }
      if(target==='chart'&&!categories)document.dispatchEvent(new CustomEvent('metrics-markers-rendered',{detail:{anchors:momentAnchors}}));
      if(hasVideoCursor)window.MetricsVideo?.attach(svg,{min:xmin,max:xmax,left:p.l,top:p.t,width:w-p.l-p.r,height:h-p.t-p.b,showStart:!zoom?.x});
      if(target==='chart'&&!categories)return;
      const legend=node('div',undefined,'legend');for(const tr of traces){const span=node('span'),dot=node('i');span.dataset.traceSubject=tr.subjectId||'';if(tr.isolationOnly){span.dataset.isolationOnly='true';}dot.style.background=tr.color;span.append(dot,document.createTextNode(tr.name));legend.append(span);}chart.append(legend);
    }
    function redrawSeries(traces) {
      const options = lastSeriesPlot?.options || {};
      $('chart').replaceChildren();
      plot(traces, options);
    }

    function reset() {
      momentMarkers = null;
      lastSeriesPlot = null;
    }

    return { plot, markMoments, redrawSeries, clearZoom: () => zoomByPlot.clear(), reset };
  };
})();
