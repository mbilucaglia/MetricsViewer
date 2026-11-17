(function () {
  'use strict';

  window.createMetricsChart = function ({ C, $, node, fmt, getMode, onZoom }) {
    const svgNS='http://www.w3.org/2000/svg';
    function svgEl(tag,attrs={},text){const e=document.createElementNS(svgNS,tag);for(const[k,v]of Object.entries(attrs))e.setAttribute(k,v);if(text!==undefined)e.textContent=text;return e;}
    const zoomByPlot = new Map();
    function axisValue([min, max], fraction) {
      return min + (max - min) * fraction;
    }

    const axes = ['x', 'y'];
    const axisHitDepth = 27;

    function panner(svg, axis, box, domain, visible, traces, dataY, categories, view, onPreview = null) {
      const horizontal = axis === 'x';
      const { x, y, width, height } = box;
      const span = domain[1] - domain[0];
      const fraction = value => (value - domain[0]) / span;
      const initial = visible.map(value => Math.max(0, Math.min(1, fraction(value))));
      let endpoints = [...initial];
      const minSpan = Math.min(initial[1] - initial[0], 1e-6);
      const control = part => 'panner-' + axis + '-' + part;
      const group = svgEl('g', { class: 'chart-panner', role: 'group',
        'aria-label': 'Panner asse ' + axis.toUpperCase(), 'data-panner-axis': axis });
      const track = svgEl('rect', { x, y, width, height, class: 'chart-panner__track' });
      const segment = (low, high) => horizontal
        ? { x: x + low * width, y, width: (high - low) * width, height }
        : { x, y: y + (1 - high) * height, width, height: (high - low) * height };
      const place = (element, attrs) => {
        for (const [key, value] of Object.entries(attrs)) element.setAttribute(key, value);
      };
      group.append(track);

      if (horizontal) {
        const preview = svgEl('g', { class: 'chart-panner__overview', 'aria-hidden': 'true' });
        const previewY = value => y + height - 2 - (value - dataY[0]) / (dataY[1] - dataY[0]) * (height - 4);
        for (const tr of traces) {
          if (tr.isolationOnly) continue;
          const stride = Math.max(1, Math.floor(tr.x.length / Math.max(160, width)));
          let path = '', open = false;
          for (let i = 0; i < tr.x.length; i++) {
            if (!C.finite(tr.y[i])) { open = false; continue; }
            if (i % stride && i !== tr.x.length - 1) continue;
            const px = x + fraction(tr.x[i]) * width;
            if (px < x || px > x + width) { open = false; continue; }
            const py = previewY(tr.y[i]);
            if (categories || tr.x.length === 1) {
              preview.append(svgEl('circle', { cx: px, cy: py, r: 1.6 }));
            } else {
              path += (open ? 'L' : 'M') + px.toFixed(2) + ',' + py.toFixed(2);
              open = true;
            }
          }
          if (path) preview.append(svgEl('path', { d: path, fill: 'none',
            'stroke-width': tr.bold ? 1.6 : .75, opacity: tr.bold ? .85 : .42 }));
        }
        group.append(preview);
      } else {
        const bins = Array(Math.max(16, Math.min(64, Math.floor(height / 5)))).fill(0);
        const subjects = traces.filter(tr => tr.subjectId);
        for (const tr of subjects.length ? subjects : traces) {
          for (const value of tr.y) {
            if (!C.finite(value)) continue;
            const f = fraction(value);
            if (f >= 0 && f <= 1) bins[Math.min(bins.length - 1, Math.floor(f * bins.length))]++;
          }
        }
        const peak = Math.max(1, ...bins);
        const histogram = svgEl('g', { class: 'chart-panner__histogram', 'aria-hidden': 'true' });
        bins.forEach((count, index) => {
          if (!count) return;
          const bar = segment((index + .08) / bins.length, (index + .92) / bins.length);
          bar.width = (width - 3) * count / peak;
          histogram.append(svgEl('rect', bar));
        });
        group.append(histogram);
      }

      const masks = [0, 1].map(() => svgEl('rect', { class: 'chart-panner__mask', 'aria-hidden': 'true' }));
      const slider = (label, part, cls) => svgEl('rect', { class: cls, role: 'slider', tabindex: 0,
        'aria-label': label + ' asse ' + axis.toUpperCase(), 'aria-orientation': horizontal ? 'horizontal' : 'vertical',
        'data-zoom-control': control(part) });
      const frame = slider('Sposta finestra', 'window', 'chart-panner__window');
      const handles = ['Minimo visibile', 'Massimo visibile'].map((label, index) =>
        slider(label, index, 'chart-panner__handle'));
      const grips = handles.map(() => svgEl('rect', { class: 'chart-panner__grip', rx: 1,
        'aria-hidden': 'true' }));
      group.append(...masks, frame, ...grips, ...handles);

      function selectedRange() {
        return endpoints.map((value, index) => value === initial[index] ? visible[index] : axisValue(domain, value));
      }

      function update() {
        const [low, high] = endpoints;
        place(masks[0], segment(0, low));
        place(masks[1], segment(high, 1));
        place(frame, segment(low, high));
        place(frame, { 'aria-valuemin': domain[0], 'aria-valuemax': axisValue(domain, 1 - high + low),
          'aria-valuenow': axisValue(domain, low),
          'aria-valuetext': fmt(axisValue(domain, low)) + ' – ' + fmt(axisValue(domain, high)) });
        const crowded = (high - low) * (horizontal ? width : height) < 12;
        handles.forEach((handle, index) => {
          const position = endpoints[index];
          const offset = crowded ? index ? -1 : 1 : 0;
          if (horizontal) {
            const cx = Math.round(x + position * width);
            const top = y + Math.round(height / 4) * (1 + offset);
            const barHeight = Math.round(height / (crowded ? 4 : 2));
            place(grips[index], { x: cx - 2, y: top, width: 4, height: barHeight });
            place(handle, { x: cx - 5, y: crowded ? top : y, width: 10, height: crowded ? barHeight : height });
          } else {
            const cy = Math.round(y + (1 - position) * height);
            const left = x + Math.round(width / 4) * (1 - offset);
            const barWidth = Math.round(width / (crowded ? 4 : 2));
            place(grips[index], { x: left, y: cy - 2, width: barWidth, height: 4 });
            place(handle, { x: crowded ? left : x, y: cy - 5, width: crowded ? barWidth : width, height: 10 });
          }
          place(handle, { 'aria-valuemin': index ? axisValue(domain, low + minSpan) : domain[0],
            'aria-valuemax': index ? domain[1] : axisValue(domain, high - minSpan),
            'aria-valuenow': axisValue(domain, position), 'aria-valuetext': fmt(axisValue(domain, position)) });
        });
      }

      function apply(part) {
        view.commit({ [axis]: selectedRange() }, control(part));
      }

      function change(part, offset, from) {
        const [low, high] = from;
        if (part === 'window') {
          const length = high - low;
          const first = Math.max(0, Math.min(1 - length, low + offset));
          endpoints = [first, first + length];
        } else if (part === 0) {
          endpoints = [Math.max(0, Math.min(high - minSpan, low + offset)), high];
        } else {
          endpoints = [low, Math.min(1, Math.max(low + minSpan, high + offset))];
        }
        update();
        onPreview?.(selectedRange());
      }

      [frame, ...handles].forEach((element, index) => {
        const part = index === 0 ? 'window' : index - 1;
        element.addEventListener('keydown', event => {
          const amount = { ArrowLeft: -.02, ArrowDown: -.02, ArrowRight: .02, ArrowUp: .02,
            PageDown: -.1, PageUp: .1, Home: -1, End: 1 }[event.key];
          if (amount === undefined) return;
          event.preventDefault();
          change(part, amount, initial);
          apply(part);
        });
      });

      let drag;
      function position(event) {
        const rect = track.getBoundingClientRect();
        return horizontal ? (event.clientX - rect.left) / rect.width : (rect.bottom - event.clientY) / rect.height;
      }
      group.addEventListener('pointerdown', event => {
        if (event.button !== 0 || !event.isPrimary || drag) return;
        const handle = handles.indexOf(event.target);
        const part = handle < 0 ? 'window' : handle;
        const start = position(event);
        event.preventDefault();
        event.stopPropagation();
        (part === 'window' ? frame : handles[part]).focus({ preventScroll: true });
        if (!group.isConnected) return;
        group.setPointerCapture(event.pointerId);
        svg.classList.add('is-view-dragging');
        const outside = event.target === track;
        if (outside) change(part, start - (initial[0] + initial[1]) / 2, initial);
        drag = { id: event.pointerId, part, start, from: [...endpoints] };
      });
      group.addEventListener('pointermove', event => {
        if (drag?.id === event.pointerId) change(drag.part, position(event) - drag.start, drag.from);
      });
      group.addEventListener('pointerup', event => {
        if (drag?.id !== event.pointerId) return;
        const { part } = drag;
        drag = null;
        svg.classList.remove('is-view-dragging');
        apply(part);
      });
      group.addEventListener('lostpointercapture', () => {
        if (!drag) return;
        drag = null;
        endpoints = [...initial];
        svg.classList.remove('is-view-dragging');
        update();
        onPreview?.(visible);
      });
      group.addEventListener('click', event => event.stopPropagation());
      update();
      svg.append(group);
    }

    function zoomTools() {
      const element = node('div', undefined, 'chart-navigation');
      element.setAttribute('role', 'group');
      element.setAttribute('aria-label', 'Navigazione del grafico');
      const limits = node('div', undefined, 'chart-navigation__limits');
      limits.setAttribute('role', 'group');
      limits.setAttribute('aria-label', 'Limiti visibili dell’asse Y');
      const paths = {
        lower: 'M8 2v9m-3-3 3 3 3-3M3 14h10',
        upper: 'M8 14V5m-3 3 3-3 3 3M3 2h10',
        auto: 'M5 3h14M5 21h14M12 10V6m-3 3 3-3 3 3m-3 5v4m-3-3 3 3 3-3',
        lens: 'M15.5 15.5 21 21M17.5 10.5a7 7 0 1 1-14 0 7 7 0 0 1 14 0ZM7.5 10.5h6m-3-3v6',
        reset: 'M5 10.5a7.5 7.5 0 1 1 1.9 7.4M5 5v5.5h5.5'
      };
      const icon = (name, size = 24) => {
        const svg = svgEl('svg', { viewBox: '0 0 ' + size + ' ' + size, 'aria-hidden': 'true' });
        svg.append(svgEl('path', { d: paths[name] }));
        return svg;
      };
      let state;

      const inputs = ['inferiore', 'superiore'].map((direction, index) => {
        const field = node('label');
        const input = node('input');
        input.type = 'text';
        input.inputMode = 'decimal';
        input.autocomplete = 'off';
        input.dataset.zoomControl = 'y-limit-' + index;
        input.setAttribute('aria-label', 'Limite ' + direction + ' dell’asse Y');
        input.title = 'Limite ' + direction + ' dell’asse Y';
        field.append(icon(index ? 'upper' : 'lower', 16), input);
        limits.append(field);
        input.oninput = () => {
          input.setCustomValidity('');
          input.setAttribute('aria-invalid', 'false');
        };
        input.onchange = () => {
          const draft = input.value.trim().replace(',', '.');
          const current = state.visible.y;
          const candidate = [...current];
          candidate[index] = draft === formatLimit(current, index) ? current[index] : Number(draft);
          if (!draft || !state.view.valid(candidate)) {
            input.setCustomValidity('Inserisci un limite numerico valido. Il minimo deve essere inferiore al massimo.');
            input.setAttribute('aria-invalid', 'true');
            input.reportValidity();
            return;
          }
          input.setCustomValidity('');
          input.setAttribute('aria-invalid', 'false');
          state.view.commit({ y: candidate });
        };
        input.onkeydown = event => {
          if (event.key === 'Enter') {
            event.preventDefault();
            input.blur();
          } else if (event.key === 'Escape') {
            event.preventDefault();
            sync(state.visible.y, true);
          }
        };
        return input;
      });

      function formatLimit(range, index) {
        const value = range[index];
        const digits = Math.ceil(Math.log10(Math.abs(value)) - Math.log10(range[1] - range[0])) + 3;
        return String(Number(value.toPrecision(Math.min(17, Math.max(6, digits)))));
      }

      function sync(range, force = false) {
        inputs.forEach((input, index) => {
          if (!force && input === document.activeElement) return;
          input.value = formatLimit(range, index);
          input.setCustomValidity?.('');
          input.setAttribute('aria-invalid', 'false');
        });
      }

      function button(name, id, label, action) {
        const control = node('button');
        control.dataset.zoomControl = id;
        control.title = label;
        control.setAttribute('aria-label', label);
        control.append(icon(name));
        control.onclick = action;
        element.append(control);
        return control;
      }
      element.append(limits);
      button('auto', 'y-auto', 'Scala automatica Y', () => state.view.resetY('y-auto'));
      const lens = button('lens', 'lens', 'Zoom a selezione', () => {
        state.zoom.selecting = !state.zoom.selecting;
        lens.setAttribute('aria-pressed', String(state.zoom.selecting));
        state.svg.classList.toggle('is-zoom-mode', state.zoom.selecting);
      });
      button('reset', 'reset', 'Ripristina la vista', () => state.view.reset('reset'));

      return {
        element, sync,
        update(visible, view, zoom, svg) {
          state = { visible, view, zoom, svg };
          lens.setAttribute('aria-pressed', String(zoom.selecting));
          svg.classList.toggle('is-zoom-mode', zoom.selecting);
          sync(visible.y);
        }
      };
    }

    function createView(zoom, visible, automatic, categories, redraw) {
      function valid([low, high]) {
        const span = high - low;
        const precision = Math.max(Math.abs(low), Math.abs(high)) * Number.EPSILON * 8;
        return Number.isFinite(span) && span > Math.max(precision, Number.MIN_VALUE * 5);
      }

      function range(axis, low, high) {
        if (axis === 'x') {
          const [min, max] = automatic.x;
          const width = high - low;
          if (categories) {
            const span = Math.max(1, Math.min(max - min, width));
            const first = Math.max(min, Math.min(max - span, low + (width - span) / 2));
            return [first, first + span];
          }
          if (low < min) return [min, min + width];
        }
        return [low, high];
      }

      function commit(next, control) {
        if (next.x && valid(next.x)) next.x = range('x', ...next.x);
        const changes = axes.filter(axis => next[axis] && valid(next[axis]) &&
          next[axis].some((value, index) => value !== visible[axis][index]));
        for (const axis of changes) zoom[axis] = next[axis];
        if (changes.includes('y')) {
          const basis = zoom.yDomain ?? automatic.y;
          const extent = [Math.min(basis[0], next.y[0]), Math.max(basis[1], next.y[1])];
          if (valid(extent) && extent.some((value, index) => value !== basis[index])) zoom.yDomain = extent;
        }
        if (changes.length) redraw(control);
        return changes.length > 0;
      }

      function scale(factor, control, anchors = { x: .5, y: .5 }, scope = axes) {
        const next = {};
        for (const axis of scope) {
          const current = visible[axis];
          const anchor = axisValue(current, anchors[axis]);
          next[axis] = range(axis, ...current.map(value => anchor + (value - anchor) * factor));
        }
        commit(next, control);
      }

      function translate(axis, fraction) {
        const current = visible[axis];
        const amount = (current[1] - current[0]) * fraction;
        const next = range(axis, current[0] + amount, current[1] + amount);
        return valid(next) ? next : current;
      }

      function resetY(control) {
        zoom.y = zoom.yDomain = null;
        redraw(control);
      }

      function reset(control) {
        zoom.x = null;
        zoom.selecting = false;
        resetY(control);
      }

      return { valid, range, commit, scale, translate, resetY, reset };
    }

    function enableSubjectSelection(element, subjectId, label, epoch) {
      element.dataset.subjectId = subjectId;
      if (epoch) element.dataset.subjectEpoch = epoch;
      element.setAttribute('tabindex', '0');
      element.setAttribute('role', 'button');
      element.setAttribute('aria-label', 'Opzioni outlier · ' + label);
      element.setAttribute('aria-haspopup', 'dialog');
      function select(event) {
        event.stopPropagation();
        document.dispatchEvent(new CustomEvent('metrics-isolate-subject', { detail: { id: subjectId, epoch, anchor: element } }));
      }
      element.addEventListener('click', select);
      element.addEventListener('keydown', event => {
        if (event.key !== 'Enter' && event.key !== ' ') return;
        event.preventDefault();
        select(event);
      });
    }

    function enableNavigation(svg, bounds, zoom, visible, view, traceContent) {
      const { left, top, width, height } = bounds;
      const selection = svgEl('rect', { class: 'chart-zoom-selection', 'aria-hidden': 'true' });
      let drag = null;
      let suppressClick = false;
      let wheelFactor = 1;
      let wheelFrame = null;
      let wheelAnchor;
      let wheelScope;

      function locate(event) {
        const matrix = svg.getScreenCTM();
        if (!matrix) return null;
        const point = svg.createSVGPoint();
        point.x = event.clientX;
        point.y = event.clientY;
        return point.matrixTransform(matrix.inverse());
      }

      function scopeAt(point) {
        if (!point) return null;
        const { x, y } = point;
        const withinX = x >= left && x <= left + width;
        const withinY = y >= top && y <= top + height;
        if (withinX && y > top + height && y <= top + height + axisHitDepth) return ['x'];
        if (withinY && x >= 0 && x < left) return ['y'];
        return withinX && withinY ? axes : null;
      }

      svg.dataset.zoomControl = 'plot';
      svg.setAttribute('tabindex', '0');
      svg.setAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight ArrowUp ArrowDown + - Home');
      svg.addEventListener('keydown', event => {
        if (event.target !== svg || event.ctrlKey || event.metaKey || event.altKey) return;
        const offset = { ArrowLeft: ['x', -.15], ArrowRight: ['x', .15],
          ArrowDown: ['y', -.15], ArrowUp: ['y', .15] }[event.key];
        if (offset) {
          view.commit({ [offset[0]]: view.translate(...offset) }, 'plot');
        } else if (event.key === '+' || event.key === '-' || event.key === '−') {
          view.scale(event.key === '+' ? 1 / 1.4 : 1.4, 'plot');
        } else if (event.key === 'Home') {
          view.reset('plot');
        } else return;
        event.preventDefault();
      });

      svg.addEventListener('wheel', event => {
        if (event.ctrlKey || event.metaKey || drag || event.target.closest('.video-playhead-axis')) return;
        const point = locate(event);
        const scope = scopeAt(point);
        if (!scope || (scope === axes && !event.shiftKey && document.activeElement !== svg)) return;
        event.preventDefault();
        const multiplier = event.deltaMode === 1 ? 16 : event.deltaMode === 2 ? 160 : 1;
        const delta = Math.max(-200, Math.min(200, (event.deltaY || event.deltaX) * multiplier));
        wheelFactor = Math.max(.5, Math.min(2, wheelFactor * Math.exp(delta * .0025)));
        wheelAnchor = { x: (point.x - left) / width, y: 1 - (point.y - top) / height };
        wheelScope = scope;
        if (wheelFrame !== null) return;
        wheelFrame = requestAnimationFrame(() => {
          wheelFrame = null;
          const factor = wheelFactor;
          wheelFactor = 1;
          if (svg.isConnected && !drag) view.scale(factor, undefined, wheelAnchor, wheelScope);
        });
      }, { passive: false });

      function gesture(event) {
        const point = locate(event);
        if (!point) return null;
        const movedX = drag.scope.includes('x') && Math.abs(event.clientX - drag.clientX) >= 5;
        const movedY = drag.scope.includes('y') && Math.abs(event.clientY - drag.clientY) >= 5;
        const next = {};
        if (!drag.selecting) {
          if (movedX) next.x = view.translate('x', (drag.start.x - point.x) / width);
          if (movedY) next.y = view.translate('y', (point.y - drag.start.y) / height);
          return { next };
        }

        const x = Math.max(left, Math.min(left + width, point.x));
        const y = Math.max(top, Math.min(top + height, point.y));
        const box = {
          left: movedX ? Math.min(x, drag.start.x) : left,
          right: movedX ? Math.max(x, drag.start.x) : left + width,
          top: movedY ? Math.min(y, drag.start.y) : top,
          bottom: movedY ? Math.max(y, drag.start.y) : top + height
        };
        if (movedX && box.right > box.left) next.x = view.range('x',
          axisValue(visible.x, (box.left - left) / width), axisValue(visible.x, (box.right - left) / width));
        if (movedY && box.bottom > box.top) next.y = view.range('y',
          axisValue(visible.y, 1 - (box.bottom - top) / height), axisValue(visible.y, 1 - (box.top - top) / height));
        return { box, next };
      }

      function cancel() {
        drag = null;
        document.removeEventListener('pointermove', move);
        document.removeEventListener('pointerup', finish);
        document.removeEventListener('pointercancel', cancelPointer);
        document.removeEventListener('keydown', cancelKey);
        window.removeEventListener('blur', cancel);
        selection.remove();
        traceContent.removeAttribute('transform');
        svg.classList.remove('is-selecting', 'is-panning', 'is-view-dragging');
      }

      function cancelPointer(event) {
        if (drag?.id === event.pointerId) cancel();
      }

      function cancelKey(event) {
        if (event.key !== 'Escape') return;
        event.preventDefault();
        suppressClick = drag.active;
        cancel();
      }

      svg.classList.add('chart-direct-navigation');
      svg.addEventListener('pointerdown', event => {
        if (!event.isPrimary || event.button !== 0 || drag) return;
        suppressClick = false;
        const start = locate(event);
        const scope = scopeAt(start);
        if (!scope || event.target.closest('.video-playhead-axis')) return;
        event.preventDefault();
        drag = {
          start, scope, id: event.pointerId, clientX: event.clientX, clientY: event.clientY, active: false,
          selecting: scope === axes && (zoom.selecting || event.shiftKey)
        };
        svg.classList.add('is-view-dragging');
        document.addEventListener('pointermove', move);
        document.addEventListener('pointerup', finish);
        document.addEventListener('pointercancel', cancelPointer);
        document.addEventListener('keydown', cancelKey);
        window.addEventListener('blur', cancel);
      });

      function move(event) {
        if (drag?.id !== event.pointerId) return;
        if (!svg.isConnected) { cancel(); return; }
        const result = gesture(event);
        if (!result || (!Object.keys(result.next).length && !drag.active)) return;
        if (!drag.active) {
          drag.active = true;
          $('tooltip').hidden = true;
          svg.classList.add(drag.selecting ? 'is-selecting' : 'is-panning');
          if (result.box) svg.append(selection);
        }
        if (result.box) {
          const box = result.box;
          selection.setAttribute('x', box.left);
          selection.setAttribute('y', box.top);
          selection.setAttribute('width', box.right - box.left);
          selection.setAttribute('height', box.bottom - box.top);
        } else {
          const { x = visible.x, y = visible.y } = result.next;
          const dx = (visible.x[0] - x[0]) / (visible.x[1] - visible.x[0]) * width;
          const dy = (y[0] - visible.y[0]) / (visible.y[1] - visible.y[0]) * height;
          traceContent.setAttribute('transform', 'translate(' + dx + ' ' + dy + ')');
        }
      }

      function finish(event) {
        if (drag?.id !== event.pointerId) return;
        const result = svg.isConnected ? gesture(event) : null;
        suppressClick = drag.active || Boolean(result && Object.keys(result.next).length);
        cancel();
        if (suppressClick && result) view.commit(result.next);
      }

      svg.addEventListener('click', event => {
        if (suppressClick && event.detail > 0) {
          suppressClick = false;
          event.stopImmediatePropagation();
        }
      }, true);
      svg.addEventListener('click', event => {
        if (scopeAt(locate(event)) === axes) svg.focus({ preventScroll: true });
      });
    }

    let momentMarkers = null;
    const lastPlots = new Map();
    const plotSizes = new Map();

    function fitPlot(target) {
      const saved = lastPlots.get(target);
      const chart = $(target);
      const viewport = chart.querySelector('.chart-plot-viewport');
      if (!saved || !viewport?.clientWidth || !viewport.clientHeight) return;
      const previous = plotSizes.get(target);
      const desktop = window.matchMedia('(min-width: 781px)').matches;
      const width = Math.max(desktop ? 620 : 200, viewport.clientWidth);
      const height = desktop ? Math.round(viewport.clientHeight * width / viewport.clientWidth) : null;
      if (width === previous?.width && height === previous?.height) return;
      plotSizes.set(target, { width, height });
      const focused = chart.contains(document.activeElement) ? document.activeElement : null;
      const previewIndex = focused?.getAttribute('data-preview-index');
      const zoomControl = focused?.getAttribute('data-zoom-control');
      plot(saved.traces, saved.options, saved.rendered);
      if (target === 'chart') onZoom();
      if (previewIndex != null) chart.querySelector(`[data-preview-index="${previewIndex}"]`)?.focus({preventScroll:true});
      if (zoomControl) chart.querySelector(`[data-zoom-control="${zoomControl}"]`)?.focus({preventScroll:true});
    }

    if (typeof ResizeObserver === 'function') {
      const fitObserver = new ResizeObserver(entries => {
        const targets = new Set(entries.map(({target}) => ({momentsDock:'chart',statsMomentsDock:'statsGroupPlot'}[target.id] || target.id)));
        for (const target of targets) fitPlot(target);
      });
      for (const id of ['chart', 'statsGroupPlot', 'momentsDock', 'statsMomentsDock']) fitObserver.observe($(id));
    }

    function previewBadge(x, y, index, total) {
      const rank = window.MetricsSignificantMedia?.previewRank(index, total) ?? '0%';
      const badge = svgEl('g', { class: 'preview-badge', style: '--preview-rank: ' + rank, 'aria-hidden': 'true' });
      badge.append(
        svgEl('circle', { cx: x, cy: y, r: 11 }),
        svgEl('text', { x, y: y+4, 'text-anchor': 'middle' }, String(index+1))
      );
      return badge;
    }
    function markMoments(points,source,onSelect){
      momentMarkers=points.length?{points,source,onSelect}:null;
      const saved = lastPlots.get('chart');
      if (!saved) return;
      const { traces, options } = saved;
      $('chart').replaceChildren();plot(traces,options);
    }
    function plot(traces,{categories=null,xLabel='Tempo dall’inizio dell’epoca [s]',hover=null,target='chart',title=null,bars=false,comparisons=[],significancePoints=[],significanceStep=null,significanceRanges=null,pThresholds={single:.05,double:.01,triple:.001}}={}, rendered = null){
      const chart=$(target);
      const saved = { traces, options: {
        categories, xLabel, hover, target, title, bars, comparisons, significancePoints, significanceStep, significanceRanges, pThresholds
      } };
      const usesMetricScale = target === 'chart' || target === 'statsGroupPlot';
      if (usesMetricScale) lastPlots.set(target, saved);

      if(target==='chart'&&!categories){
        if(momentMarkers&&!traces.some(t=>momentMarkers.source.subjectId?t.subjectId===momentMarkers.source.subjectId:!t.subjectId))traces=[...traces,momentMarkers.source];
      }

      let xmin=Infinity,xmax=-Infinity,ymin=Infinity,ymax=-Infinity;
      for(const tr of traces)for(let i=0;i<tr.x.length;i++){if(!C.finite(tr.y[i]))continue;const d=tr.band?.[i]||0;xmin=Math.min(xmin,tr.x[i]);xmax=Math.max(xmax,tr.x[i]);ymin=Math.min(ymin,tr.y[i]-d);ymax=Math.max(ymax,tr.y[i]+d);}
      if(!Number.isFinite(ymin)){chart.append(node('p','Nessun valore disponibile nell’intervallo selezionato.','empty-state'));return;}
      if (categories) {
        xmin = -.5;
        xmax = categories.length - .5;
      } else if (xmin === xmax) {
        if (!usesMetricScale) xmin -= .5;
        xmax += .5;
      }
      if(bars){ymin=Math.min(0,ymin);ymax=Math.max(0,ymax);}
      const pad=(ymax-ymin)*.12||Math.max(Math.abs(ymax)*.1,1);ymin-=pad;ymax+=pad;
      const automatic = { x: [xmin, xmax], y: [ymin, ymax] };
      let zoom, visible, domain, view, redraw;
      if (usesMetricScale) {
        const key = getMode() + ':' + target;
        if (!zoomByPlot.has(key)) zoomByPlot.set(key, { x: null, y: null, yDomain: null, selecting: false, lastFollow: -Infinity });
        zoom = zoomByPlot.get(key);
        visible = { x: zoom.x ?? automatic.x, y: zoom.y ?? automatic.y };
        redraw = (control = chart.contains(document.activeElement) ? document.activeElement.dataset.zoomControl : null) => {
          $('tooltip').hidden = true;
          plot(saved.traces, saved.options, saved.rendered);
          if (target === 'chart') onZoom();
          if (control) chart.querySelector('[data-zoom-control="' + control + '"]')?.focus({ preventScroll: true });
        };
        view = createView(zoom, visible, automatic, categories, redraw);
        visible.x = view.range('x', ...visible.x);
        [xmin, xmax] = visible.x;
        [ymin, ymax] = visible.y;
        domain = {};
        for (const axis of axes) {
          const bounds = axis === 'y' ? zoom.yDomain ?? automatic.y : automatic.x;
          const extent = [Math.min(bounds[0], visible[axis][0]), Math.max(bounds[1], visible[axis][1])];
          domain[axis] = view.valid(extent) ? extent : visible[axis];
        }
      }

      const visibleCategory = index => index >= 0 && index >= xmin && index <= xmax;
      const size = plotSizes.get(target);
      const w = size?.width ?? 900;
      const compact = w < 470;
      const pannerSpace = usesMetricScale ? (compact ? 49 : 72) : 0;
      const rightPannerSpace = usesMetricScale ? (compact ? 22 : 28) : 0;
      const p = { l: compact ? 47 : 65, r: (compact ? 16 : 25) + rightPannerSpace,
        t: 25, b: (categories ? 70 : 84) + pannerSpace };
      const X = x => p.l + (x - xmin) / (xmax - xmin) * (w - p.l - p.r);
      const barTraces = traces.filter(trace => !trace.subjectId);
      const individualBars = traces.filter(trace => trace.isolationOnly);
      const slotWidth = count => Math.min(88, (w - p.l - p.r) / (xmax - xmin) * .7 / Math.max(1, count));
      const barCenter = (at, slot, count, width) => X(at) + (slot - (count - 1) / 2) * width;
      const annotations = [];
      if (categories && comparisons.length) {
        const count = barTraces.length;
        const width = slotWidth(count);
        const barX = (index, group) => Number.isInteger(group) ? barCenter(index, group, count, width) : X(index);
        for (const comparison of comparisons) {
          const { pAdjusted, epochA, epochB, groupIndexA, groupIndexB } = comparison;
          if (!Number.isFinite(pAdjusted) || pAdjusted < 0 || pAdjusted > 1) continue;
          const a = categories.indexOf(epochA), b = categories.indexOf(epochB);
          if (!visibleCategory(a) || !visibleCategory(b)) continue;
          const xa = barX(a, groupIndexA), xb = barX(b, groupIndexB);
          const center = (xa + xb) / 2;
          annotations.push({ comparison, xa, xb, center,
            left: Math.min(xa, xb, center - 18), right: Math.max(xa, xb, center + 18) });
        }
      }
      // Reuse a row for annotations that do not overlap horizontally.
      annotations.sort((a, b) => (a.right - a.left) - (b.right - b.left) || a.left - b.left);
      const lanes = [];
      for (const annotation of annotations) {
        const { left, right } = annotation;
        let lane = lanes.findIndex(row => row.every(item => right + 6 < item.left || left > item.right + 6));
        if (lane === -1) {
          lane = lanes.length;
          lanes.push([]);
        }
        lanes[lane].push(annotation);
        annotation.lane = lane;
      }
      const bracketSpace = lanes.length ? 12 + lanes.length * 24 : 0;
      p.t += bracketSpace;
      // Reserve plot space when many annotations need to stack above the bars.
      const minHeight = (bracketSpace ? bracketSpace + 240 : 140) + pannerSpace;
      const h = size?.height == null ? (compact ? 306 : 410) + bracketSpace + pannerSpace : Math.max(size.height, minHeight);
      const Y = y => h - p.b - (y - ymin) / (ymax - ymin) * (h - p.t - p.b);
      const hasVideoCursor = !categories && getMode() === 'series';
      const svg=svgEl('svg',{viewBox:`0 0 ${w} ${h}`,role:usesMetricScale||hasVideoCursor||(target==='chart'&&(momentMarkers||traces.some(t=>t.subjectId)))||significancePoints.length||significanceRanges?.length||annotations.length?'group':'img','aria-label':title||$('chartTitle').textContent});
      if (size?.height != null && h > size.height) svg.classList.add('chart-overflow');
      if (usesMetricScale) {
        svg.append(
          svgEl('rect', { x: p.l, y: h - p.b, width: w - p.l - p.r, height: axisHitDepth,
            class: 'chart-axis-hit chart-axis-hit--x', 'aria-hidden': 'true' }),
          svgEl('rect', { x: 0, y: p.t, width: p.l, height: h - p.t - p.b,
            class: 'chart-axis-hit chart-axis-hit--y', 'aria-hidden': 'true' })
        );
      }
      const yStep = (ymax - ymin) / 5;
      function tickLabel(value, step) {
        if (value === 0 || Math.abs(value) < step / 1000) return '0';
        const magnitude = Math.abs(value);
        if (magnitude < 1e-6 || magnitude >= 1e8) {
          const digits = Math.ceil(Math.log10(magnitude) - Math.log10(step)) + 2;
          return Number(value.toPrecision(Math.min(17, Math.max(2, digits)))).toString();
        }
        const decimals = Math.min(20, Math.max(0, 1 - Math.floor(Math.log10(step))));
        return Number(value.toFixed(decimals)).toString();
      }
      for (let i = 0; i <= 5; i++) {
        const value = ymin + i * yStep;
        const y = Y(value);
        const label = tickLabel(value, yStep);
        svg.append(
          svgEl('line', { x1: p.l, x2: w - p.r, y1: y, y2: y, class: 'grid-line' }),
          svgEl('text', { x: p.l - 10, y: y + 4, 'text-anchor': 'end', class: usesMetricScale ? 'chart-axis-hit--y' : '' }, label)
        );
      }
      const xDivisions = compact ? 3 : 5;
      const ticks = categories ? categories.map((name, i) => [i, name]).filter(([i]) => visibleCategory(i)) :
        Array.from({ length: xDivisions + 1 }, (_, i) => {
          const x = axisValue([xmin, xmax], i / xDivisions);
          return [x, tickLabel(x, (xmax - xmin) / xDivisions)];
        });
      const categoryChars = Math.max(3, Math.min(22, Math.floor((w - p.l - p.r) / (Math.max(1, ticks.length) * 8))));
      for (const [x, label] of ticks) {
        const text = categories && label.length > categoryChars ? label.slice(0, categoryChars - 1) + '…' : label;
        const tick = svgEl('text', { x: X(x), y: h - p.b + 24, 'text-anchor': 'middle', class: usesMetricScale ? 'chart-axis-hit--x' : '' }, text);
        tick.append(svgEl('title', {}, label));
        svg.append(tick);
      }
      svg.append(svgEl('text',{x:w/2,y:h-12-pannerSpace,'text-anchor':'middle'},xLabel));
      const clipId=`${target}-plot-clip`;const defs=svgEl('defs'),clip=svgEl('clipPath',{id:clipId});clip.append(svgEl('rect',{x:p.l,y:p.t,width:w-p.l-p.r,height:h-p.t-p.b}));defs.append(clip);svg.append(defs);
      const statAnchors=[];
      if(!categories&&(significancePoints.length||significanceRanges?.length)){
        const layer=svgEl('g',{class:'significance-bars','clip-path':`url(#${clipId})`});
        const ranges=significanceRanges??window.MetricsSignificantMedia.rankIntervals(window.MetricsSignificantMedia.bands(significancePoints,significanceStep,pThresholds.single));
        for(const [index,range] of ranges.entries()){
          const left=Math.max(p.l,X(range.left)),right=Math.min(w-p.r,X(range.right));
          if(right<left)continue;
          const label=range.cluster ? 'Anteprima ' + (index+1) + ' · ' + range.label : `Anteprima ${index+1} · ${fmt(range.start)}–${fmt(range.end)} s · ${range.count} istanti significativi · p minimo ${fmt(range.minP)}. Vai al frammento video.`;
          const bar=svgEl('g',{class:'significance-band',tabindex:0,role:'button','aria-label':label,'data-preview-index':index});
          const center=Math.max(p.l+12,Math.min(w-p.r-12,(left+right)/2));
          bar.append(svgEl('title',{},label),
            svgEl('rect',{x:left,y:p.t,width:Math.max(1,right-left),height:h-p.t-p.b,class:'significance-bar'}),
            previewBadge(center,p.t+16+(index%2)*25,index,ranges.length));
          statAnchors[index]=bar;
          const activate=event=>{
            event.stopPropagation();
            let time=range.peak;
            const onBand = !range.cluster && event.type === 'click' && !event.target.closest('.preview-badge');
            const matrix = onBand ? svg.getScreenCTM() : null;
            if(matrix){
              const point=svg.createSVGPoint();point.x=event.clientX;point.y=event.clientY;
              const x=point.matrixTransform(matrix.inverse()).x;
              time=xmin+(x-p.l)/(w-p.l-p.r)*(xmax-xmin);
              if(Number.isFinite(significanceStep)&&significanceStep>0)time=range.start+Math.round((time-range.start)/significanceStep)*significanceStep;
              time=Math.max(range.start,Math.min(range.end,time));
            }
            window.MetricsSignificantMedia.focusTime(time,index,bar);
          };
          bar.addEventListener('click',activate);
          bar.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();activate(event);}});
          layer.append(bar);
        }
        svg.append(layer);
      }
      for (const { comparison, xa, xb, center, lane } of annotations) {
        const y = p.t - 14 - lane * 24;
        const { pAdjusted } = comparison;
        const significant = pAdjusted <= pThresholds.single;
        const mark = pAdjusted <= pThresholds.triple ? '***' : pAdjusted <= pThresholds.double ? '**' : significant ? '*' : 'n.s.';
        const label = (comparison.label || comparison.epochA + ' – ' + comparison.epochB) +
          ': ' + (significant ? 'significativo' : 'non significativo') + ', p finale = ' + fmt(pAdjusted);
        const group = svgEl('g', { role: 'img', 'aria-label': label, 'data-significance': significant });
        group.append(svgEl('title', {}, label));
        if (!comparison.single) {
          group.append(svgEl('path', { d: `M${xa},${y + 6}V${y}H${xb}V${y + 6}`, fill: 'none', 'stroke-width': 1.5 }));
        }
        group.append(svgEl('text', { x: center, y: y - 4, 'text-anchor': 'middle', 'aria-hidden': 'true' }, mark));
        svg.append(group);
      }
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
      const traceClip = svgEl('g', { 'clip-path': 'url(#' + clipId + ')' });
      const traceContent = svgEl('g');
      traceClip.append(traceContent);
      svg.append(traceClip);
      for(const tr of traces){
        const traceLayer=svgEl('g',{'data-trace-subject':tr.subjectId||''});
        if(tr.isolationOnly){traceLayer.dataset.isolationOnly='true';}
        traceContent.append(traceLayer);
        if(tr.swarm&&categories){
          for(let i=0;i<tr.x.length;i++){
            if(!C.finite(tr.y[i]) || !visibleCategory(tr.x[i]) || tr.y[i] < ymin || tr.y[i] > ymax)continue;
            const point=swarmPositions.get(tr)[i],label=`${tr.name} · ${categories[i]}: ${fmt(tr.y[i])}`;
            const circle=svgEl('circle',{cx:X(tr.x[i])+point.dx,cy:Y(tr.y[i]),r:point.r,fill:tr.color,stroke:'white','stroke-width':.6});
            circle.append(svgEl('title',{},label));
            enableSubjectSelection(circle, tr.subjectId, label, categories[i]);
            traceLayer.append(circle);
          }
          continue;
        }
        if(bars&&categories){
          const peers=tr.isolationOnly?individualBars:barTraces,slot=peers.indexOf(tr),width=slotWidth(peers.length);
          for(let i=0;i<tr.x.length;i++){
            if(!C.finite(tr.y[i]))continue;
            const x=barCenter(tr.x[i],slot,peers.length,width),y=Y(tr.y[i]),half=tr.band?.[i],n=tr.n?.[i];
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
          if (target === 'chart' && tr.subjectId && path.includes('L')) enableSubjectSelection(line, tr.subjectId, tr.name + ' · ' + (tr.epoch ?? ''), tr.epoch);
          traceLayer.append(line);
        }
        if(categories||tr.x.length===1)for(let i=0;i<tr.x.length;i++){if(!C.finite(tr.y[i]))continue;const x=X(tr.x[i]),y=Y(tr.y[i]);if(tr.band&&C.finite(tr.band[i]))traceLayer.append(svgEl('line',{x1:x,x2:x,y1:Y(tr.y[i]-tr.band[i]),y2:Y(tr.y[i]+tr.band[i]),stroke:tr.color,'stroke-width':2}));const circle=svgEl('circle',{cx:x,cy:y,r:tr.bold?6:4,fill:tr.color,opacity:tr.bold?1:.65});circle.append(svgEl('title',{},`${tr.name}: ${fmt(tr.y[i])}`));if(tr.subjectId)enableSubjectSelection(circle,tr.subjectId,tr.name+' · '+(categories?.[tr.x[i]]??tr.epoch??''),categories?.[tr.x[i]]??tr.epoch);traceLayer.append(circle);}
      }
      if(hover){svg.addEventListener('pointermove',event=>{if(svg.classList.contains('is-selecting')||svg.classList.contains('is-panning'))return;if(event.target.closest('.chart-panner')){$('tooltip').hidden=true;return;}const rect=svg.getBoundingClientRect(),x=xmin+((event.clientX-rect.left)/rect.width*w-p.l)/(w-p.l-p.r)*(xmax-xmin);$('tooltip').textContent=hover(x);$('tooltip').hidden=false;$('tooltip').style.left=Math.max(5,Math.min(event.clientX+12,window.innerWidth-320))+'px';$('tooltip').style.top=Math.max(5,Math.min(event.clientY+12,window.innerHeight-110))+'px';});svg.addEventListener('pointerleave',()=>{$('tooltip').hidden=true;});}
      const momentAnchors=[];
      if(target==='chart'&&!categories&&momentMarkers){
        const layer=svgEl('g',{class:'moment-markers','aria-label':'Istanti estratti','clip-path':'url(#'+clipId+')'});
        momentMarkers.points.forEach((point,index)=>{
          if (point.peak < xmin || point.peak > xmax || point.value < ymin || point.value > ymax) return;
          const circle=svgEl('g',{class:'moment-marker',tabindex:0,role:'button','aria-pressed':'false','data-preview-index':index,'aria-label':`Anteprima ${index+1} · ${point.label}.`});
          circle.append(previewBadge(X(point.peak),Y(point.value),index,momentMarkers.points.length));
          circle.append(svgEl('title',{},point.label));
          const activate=event=>{event.stopPropagation();for(const other of layer.children){other.classList.toggle('is-selected',other===circle);other.setAttribute('aria-pressed',String(other===circle));}momentMarkers.onSelect(index,circle);};
          circle.addEventListener('click',activate);
          circle.addEventListener('keydown',event=>{if(event.key==='Enter'||event.key===' '){event.preventDefault();activate(event);}});
          layer.append(circle);momentAnchors[index] = circle;
        });
        svg.append(layer);
      }
      let overview;
      let followPlayback;
      if (zoom) {
        if (!rendered) {
          const layout = node('div', undefined, 'chart-plot-layout');
          const viewport = node('div', undefined, 'chart-plot-viewport');
          const navigation = zoomTools();
          layout.append(navigation.element, viewport);
          chart.append(layout);
          rendered = { viewport, navigation };
        }
        saved.rendered = rendered;
        const { viewport, navigation } = rendered;
        navigation.update(visible, view, zoom, svg);
        viewport.replaceChildren(svg);
        const plotWidth = w - p.l - p.r;
        const plotHeight = h - p.t - p.b;
        const xPanner = { x: p.l, y: h - pannerSpace + 1, width: plotWidth,
          height: Math.min(pannerSpace - 8, Math.round((plotHeight + pannerSpace) * .16)) };
        enableNavigation(svg, { left: p.l, top: p.t, width: plotWidth, height: plotHeight },
          zoom, visible, view, traceContent);
        panner(svg, 'x', xPanner, domain.x, visible.x, traces, automatic.y, categories, view);
        panner(svg, 'y', { x: w - p.r + 9, y: p.t, width: rightPannerSpace - 2, height: plotHeight },
          domain.y, visible.y, traces, automatic.y, categories, view, navigation.sync);
        if (hasVideoCursor) {
          overview = { ...xPanner, min: domain.x[0], max: domain.x[1] };
          followPlayback = (time, now) => {
            if (now - zoom.lastFollow < 125 || !svg.isConnected || !svg.getClientRects().length ||
                svg.classList.contains('is-view-dragging') ||
                document.activeElement?.dataset?.zoomControl?.startsWith('y-limit-')) return;
            const span = xmax - xmin;
            const offset = (time - xmin) / span;
            if (offset >= 0 && offset <= .85) return;
            const anchor = offset < 0 ? .15 : .85;
            const [min, max] = automatic.x;
            if (span >= max - min) return;
            const start = Math.max(min, Math.min(max - span, time - anchor * span));
            if (Math.abs(start - xmin) < Math.max(.015, span * .005)) return;
            zoom.lastFollow = now;
            view.commit({ x: [start, start + span] });
          };
        }
      } else {
        chart.append(svg);
      }
      if (target === 'chart') document.dispatchEvent(new Event('metrics-subject-points-rendered'));
      if(target==='chart'&&!categories)document.dispatchEvent(new CustomEvent('metrics-markers-rendered',{detail:{anchors:momentAnchors}}));
      if(target==='statsGroupPlot'&&!categories)document.dispatchEvent(new CustomEvent('metrics-stat-bands-rendered',{detail:{anchors:statAnchors}}));
      if(hasVideoCursor)window.MetricsVideo?.attach(svg,{min:xmin,max:xmax,left:p.l,top:p.t,width:w-p.l-p.r,height:h-p.t-p.b,showStart:!zoom?.x,overview,followPlayback});
      if(target==='chart'||target==='statsGroupPlot')return;
      const legend=node('div',undefined,'legend');for(const tr of traces){const span=node('span'),dot=node('i');span.dataset.traceSubject=tr.subjectId||'';if(tr.isolationOnly){span.dataset.isolationOnly='true';}dot.style.background=tr.color;span.append(dot,document.createTextNode(tr.name));legend.append(span);}chart.append(legend);
    }
    function redrawSeries(traces) {
      const options = lastPlots.get('chart')?.options || {};
      $('chart').replaceChildren();
      plot(traces, options);
    }

    function reset() {
      momentMarkers = null;
      lastPlots.clear();
    }

    return { plot, markMoments, redrawSeries, clearZoom: () => zoomByPlot.clear(), reset };
  };
})();
