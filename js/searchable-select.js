(function () {
  'use strict';

  const popup = document.createElement('div');
  popup.id = 'selectSearchPopup';
  popup.className = 'searchable-select-popup';
  popup.setAttribute('role', 'dialog');
  popup.hidden = true;

  const search = document.createElement('input');
  search.type = 'search';
  search.autocomplete = 'off';
  search.placeholder = 'Cerca…';
  search.setAttribute('aria-label', 'Cerca tra le opzioni');
  search.setAttribute('role', 'combobox');
  search.setAttribute('aria-autocomplete', 'list');

  const list = document.createElement('div');
  list.id = 'selectSearchList';
  list.className = 'searchable-select-list';
  list.setAttribute('aria-label', 'Opzioni disponibili');
  list.setAttribute('role', 'listbox');
  search.setAttribute('aria-controls', list.id);

  const empty = document.createElement('p');
  empty.className = 'panel-note';
  empty.textContent = 'Nessuna opzione trovata.';
  popup.append(search, list, empty);
  document.body.append(popup);

  const enhanced = new WeakMap();
  let nextId = 0;
  let current = null;
  let choices = [];
  let active = -1;

  const normalize = value => value.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase();

  function close(returnFocus = false) {
    if (!current) return;
    const { button } = current;
    current = null;
    popup.hidden = true;
    button.setAttribute('aria-expanded', 'false');
    search.setAttribute('aria-expanded', 'false');
    search.removeAttribute('aria-activedescendant');
    if (returnFocus && button.isConnected) button.focus({ preventScroll: true });
  }

  function position() {
    if (!current) return;
    const { button } = current;
    const bounds = button.getBoundingClientRect();
    if (!button.isConnected || !bounds.width || !bounds.height ||
        bounds.bottom < 0 || bounds.top > window.innerHeight) {
      close();
      return;
    }
    const edge = 8;
    const below = window.innerHeight - bounds.bottom - edge;
    const above = bounds.top - edge;
    const openAbove = below < 180 && above > below;
    const width = Math.min(Math.max(bounds.width, 210), document.documentElement.clientWidth - edge * 2);
    popup.style.width = width + 'px';
    popup.style.left = Math.max(edge, Math.min(bounds.left, document.documentElement.clientWidth - width - edge)) + 'px';
    list.style.maxHeight = Math.max(40, Math.min(230, (openAbove ? above : below) - 62)) + 'px';
    const top = openAbove ? bounds.top - 5 - popup.offsetHeight : bounds.bottom + 5;
    popup.style.top = Math.max(edge, top) + 'px';
  }

  function setActive(index) {
    active = index;
    choices.forEach((choice, i) => choice.classList.toggle('is-keyboard-active', i === index));
    const option = choices[index];
    if (option) {
      search.setAttribute('aria-activedescendant', option.id);
      option.scrollIntoView({ block: 'nearest' });
    } else {
      search.removeAttribute('aria-activedescendant');
    }
  }

  function renderList() {
    if (!current) return;
    const { select } = current;
    const query = normalize(search.value.trim());
    choices = [];
    list.replaceChildren();
    for (const option of select.options) {
      if (option.hidden || option.closest('optgroup')?.hidden ||
          !normalize(option.label).includes(query)) continue;
      const item = document.createElement('div');
      item.id = 'selectSearchOption' + choices.length;
      item.className = 'searchable-select-option';
      item.textContent = option.label;
      item.setAttribute('role', 'option');
      item.setAttribute('aria-selected', String(option.selected));
      if (option.disabled || option.closest('optgroup')?.disabled) {
        item.setAttribute('aria-disabled', 'true');
        item.id = '';
      } else {
        item.onmousedown = event => event.preventDefault();
        item.onclick = () => {
          select.selectedIndex = option.index;
          close(true);
          sync(select);
          select.dispatchEvent(new Event('change', { bubbles: true }));
        };
        choices.push(item);
      }
      list.append(item);
    }
    empty.hidden = list.children.length > 0;
    setActive(-1);
    position();
  }

  function sync(select) {
    const entry = enhanced.get(select);
    if (!entry) return;
    const { button, title } = entry;
    const selected = select.selectedOptions[0]?.label || 'Seleziona…';
    button.textContent = selected + ' ▾';
    button.setAttribute('aria-label', title + ', ' + selected);
    button.disabled = select.matches(':disabled');
    if (current === entry) {
      if (button.disabled) close();
      else renderList();
    }
  }

  function enhance(select) {
    if (enhanced.has(select) || select.multiple || select.size > 1) return;
    const labels = Array.from(select.labels || []);
    const title = select.getAttribute('aria-label') || labels.map(label => label.textContent.trim()).join(' ') || 'Seleziona';
    const wrapper = document.createElement('div');
    wrapper.className = 'searchable-select';
    const button = document.createElement('button');
    button.type = 'button';
    button.id = select.id ? select.id + 'Picker' : 'selectPicker' + ++nextId;
    button.className = 'searchable-select-trigger';
    button.setAttribute('aria-haspopup', 'dialog');
    button.setAttribute('aria-controls', popup.id);
    button.setAttribute('aria-expanded', 'false');
    for (const label of labels) label.htmlFor = button.id;

    const entry = { select, button, title };
    enhanced.set(select, entry);
    select.before(wrapper);
    wrapper.append(button, select);
    select.hidden = true;
    select.tabIndex = -1;
    button.onclick = () => {
      if (current === entry) {
        close();
        return;
      }
      close();
      current = entry;
      popup.setAttribute('aria-label', title);
      popup.hidden = false;
      button.setAttribute('aria-expanded', 'true');
      search.setAttribute('aria-expanded', 'true');
      search.value = '';
      renderList();
      search.focus({ preventScroll: true });
    };
    sync(select);
  }

  search.addEventListener('input', renderList);
  search.addEventListener('keydown', event => {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      close(true);
    } else if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const length = choices.length;
      if (!length) return;
      const next = event.key === 'ArrowDown' ? active + 1 : active < 0 ? length - 1 : active - 1;
      setActive((next + length) % length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const option = active >= 0 ? choices[active] : choices.length === 1 ? choices[0] : null;
      option?.click();
    } else if (event.key === 'Tab') {
      close(true);
    }
  });
  document.addEventListener('change', event => {
    if (event.target instanceof HTMLSelectElement) sync(event.target);
  });
  for (const type of ['pointerdown', 'focusin']) {
    document.addEventListener(type, event => {
      if (current && !popup.contains(event.target) && event.target !== current.button) close();
    });
  }
  document.addEventListener('scroll', event => {
    if (current && !popup.contains(event.target)) position();
  }, true);
  window.addEventListener('resize', position);

  function syncAll() {
    for (const select of document.querySelectorAll('select')) sync(select);
  }
  for (const type of ['metrics-ready', 'metrics-invalidated']) {
    document.addEventListener(type, syncAll);
  }

  document.querySelectorAll('select').forEach(enhance);
  new MutationObserver(changes => {
    const changed = new Set();
    for (const change of changes) {
      const select = change.target.closest?.('select');
      if (select) changed.add(select);
      for (const node of change.addedNodes) {
        if (!(node instanceof Element)) continue;
        if (node.matches('select')) enhance(node);
        node.querySelectorAll('select').forEach(enhance);
      }
    }
    for (const select of changed) sync(select);
    if (current && !current.button.isConnected) close();
  }).observe(document.body, {
    childList: true, subtree: true, attributes: true,
    attributeFilter: ['selected', 'disabled', 'hidden', 'label']
  });
})();
