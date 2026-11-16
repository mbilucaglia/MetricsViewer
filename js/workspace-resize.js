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
    divider: document.getElementById('videoDivider'), pane: document.getElementById('stimulusVideo'), vertical: true,
    property: '--workspace-video-height',
    limits: () => ({ min: pixels('--video-min'), max: pixels('--video-max') })
  });
})();
