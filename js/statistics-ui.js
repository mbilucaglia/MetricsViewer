(function(){
  'use strict';
  const C=MetricsCore,A=MetricsAnalysis,$=id=>document.getElementById(id);
  const subviews={series:'view',summary:'view'};
  let currentMode='series',context=null,version=0,results=[],resultMeta=null;
  let report;
  const groupSettingsKey = 'metrics-viewer:groups';
  const savedGroups = loadGroupSettings();
  const thresholdFields = { single: 'pThresholdSingle', double: 'pThresholdDouble', triple: 'pThresholdTriple' };
  const defaultThresholds = { single: .05, double: .01, triple: .001 };
  let pThresholds = validThresholds(savedGroups?.pThresholds) ? savedGroups.pThresholds : defaultThresholds;
  let groups = savedGroups?.groups ?? [{id:'g1',name:'Gruppo 1'},{id:'g2',name:'Gruppo 2'}];
  let nextGroup = savedGroups?.nextGroup ?? 3;
  const isolation=MetricsIsolation.create();let isolationKey=null,isolationDataset=null,latestFlags=new Map();
  let perEpochFlags = new Map();
  let selectedPair = null;
  const manualOutliers = new Map();
  const outlierMenu = $('pointOutlierMenu');
  let outlierMenuTarget = null;
  let statsExclusions = new Set();
  let previousSettings = null;
  let sampleRecords = [];
  let sampleSelection = new Set();
  let isolatedOutlierIds = null;
  let assignments=new Map(savedGroups?.assignments);
  let mixedEpochSelection = Array.isArray(savedGroups?.mixedEpochs) ? savedGroups.mixedEpochs : null;
  const colors=['#514691','#248d92','#c17b40','#b55488','#608a4a'];
  const el=(tag,text,cls)=>{const e=document.createElement(tag);if(tag==='button')e.type='button';if(tag==='th')e.setAttribute('scope','col');if(text!==undefined)e.textContent=text;if(cls)e.className=cls;return e;};
  const fmt=x=>C.finite(x)?Number(x.toPrecision(6)).toString():x===Infinity?'∞':x===-Infinity?'−∞':'—';
  const designs={series:'one',summary:'within'};let designMode='series';
  const significantOnlyByMode = { series: true, summary: false };
  function syncDesign(){
    if (designMode !== currentMode) {
      designs[designMode] = $('design').value;
      designMode = currentMode;
      $('design').value = designs[currentMode];
      $('significantOnly').checked = significantOnlyByMode[currentMode];
    }
    $('temporalCorrectionControl').hidden = currentMode !== 'series';
    for (const value of ['within', 'mixed', 'between']) {
      const option = $('design').querySelector('[value="' + value + '"]');
      option.hidden = currentMode !== 'summary';
      option.disabled = currentMode !== 'summary';
    }
  }
  function methodDescription(){
    if (previousSettings) return;
    const within=$('design').value==='within',summary=currentMode==='summary';
    if ($('design').value === 'between') {
      $('statsMethod').textContent = 'Confronto indipendente a permutazioni fra stimoli presentati a soggetti diversi. Ogni soggetto contribuisce con il riepilogo dello stimolo visto. I gruppi sono definiti dallo stimolo. I post-hoc usano tutte le coppie di stimoli e correzione max-|T|. Con due stimoli viene riportato il test t a due code.';
      return;
    }
    if ($('design').value === 'mixed') {
      $('statsMethod').textContent = 'ANOVA mista a permutazioni con permuco::aovperm. Fattori gruppo ed epoca, con misure ripetute per soggetto. Metodo Rd_kheradPajouh_renaud. Le osservazioni complete nelle epoche ripetute definiscono il campione. I tre effetti omnibus sono corretti con Holm. Tutti i confronti semplici tra epoche entro gruppo e tra gruppi per epoca sono corretti insieme con Holm. In caso di gruppi sbilanciati il test di permuco è approssimato.';
      return;
    }
    if (!summary && $('temporalCorrection').value === 'cluster') {
      $('statsMethod').textContent = 'Test per massa dei cluster. Soglie di formazione a α = 0,05, bilaterale per t e a coda superiore per F. Il p-value valuta l’intero cluster. Le lacune separano i cluster.';
      return;
    }
    $('statsMethod').textContent=within?'Confronto entro soggetto sulle epoche selezionate: con 2 epoche, t appaiato a due code (prima meno seconda); con 3 o più, F a misure ripetute con permutazione delle epoche entro ciascun soggetto e post-hoc t appaiati su tutte le coppie, corretti max-|T| tramite cambi di segno congiunti per soggetto. Si usano gli stessi soggetti completi per omnibus e post-hoc. Gli IC delle barre descrivono le medie delle epoche, non le differenze appaiate.':summary?'Test per ciascuna epoca contro un valore nullo o tra gruppi indipendenti. Correzione max-|T| / max-F su tutte le epoche selezionate; soggetti con dati completi. Per i gruppi indipendenti: post-hoc a permutazioni tra tutte le coppie, corretti max-|T| congiunto su coppie × epoche. Per confrontare le epoche tra loro scegli il disegno entro soggetto.':'Test di permutazione: t contro un valore nullo o F tra gruppi indipendenti. Correzione max-|T| / max-F su tutti gli istanti analizzati; stessi soggetti a ogni istante.';
  }
  const panels = {
    view: ['viewTab', 'visualPanel'],
    stats: ['statsTab', 'statsPanel']
  };
  function subview() {
    syncDesign();
    $('modeNavigation').setAttribute('aria-labelledby', currentMode === 'series' ? 'seriesTab' : 'summaryTab');
    $('seriesModeControls').hidden = currentMode !== 'series';
    $('summaryModeControls').hidden = $('aggregationControl').hidden = currentMode !== 'summary';
    for (const [view, [tabId, panelId]] of Object.entries(panels)) {
      const active = subviews[currentMode] === view;
      $(panelId).hidden = !active;
      $(tabId).classList.toggle('is-active', active);
      $(tabId).setAttribute('aria-pressed', String(active));
    }
    $('statsTitle').textContent = `Analisi statistiche · ${currentMode === 'series' ? 'Serie temporali' : 'Riepilogo temporale'}`;
  }
  let activeAnalysis;
  const statsDetails = $('statsDetails');
  const showStatsDetails = $('showStatsDetails');
  statsDetails.addEventListener('toggle', () => {
    showStatsDetails.setAttribute('aria-expanded', String(statsDetails.open));
  });
  showStatsDetails.onclick = () => {
    if (!report) return;
    statsDetails.open = true;
    statsDetails.querySelector('summary').focus({ preventScroll: true });
    statsDetails.scrollIntoView({ block: 'start' });
  };
  function clearResults(message='Impostazioni aggiornate: esegui nuovamente l’analisi.'){
    activeAnalysis?.abort();
    activeAnalysis = null;
    report = null;
    $('exportStatsInput').disabled = true;
    globalThis.MetricsSignificantMedia?.clear();
    statsDetails.open = false;
    showStatsDetails.disabled = true;
    version++;results=[];resultMeta=null;$('statsResults').replaceChildren();$('statsGroupPlot').replaceChildren();$('statsPPlot').replaceChildren();$('exportStats').disabled=true;$('runStats').disabled=!context;$('statsStatus').textContent=message;
  }
  function loadGroupSettings() {
    try {
      const saved = JSON.parse(sessionStorage.getItem(groupSettingsKey));
      if (saved?.groups?.length >= 2 && Array.isArray(saved.groups) &&
        saved.groups.every(group => typeof group?.id === 'string' && typeof group.name === 'string') &&
        Number.isSafeInteger(saved.nextGroup) && Array.isArray(saved.assignments) &&
        saved.assignments.every(pair => Array.isArray(pair) && pair.length === 2)) return saved;
    } catch { /* Assignments still work in memory if session storage is unavailable. */ }
    return null;
  }

  function saveGroupSettings() {
    if (previousSettings) return;
    try {
      sessionStorage.setItem(groupSettingsKey, JSON.stringify({groups,nextGroup,assignments:[...assignments],pThresholds,mixedEpochs:mixedEpochSelection}));
    } catch { /* Keep the current in-memory assignments. */ }
  }

  function updateStatsOptionsSummary() {
    if (previousSettings) return;
    const design = $('design').value;
    const type = {one:'Un campione',within:'Confronto tra epoche',multi:'Gruppi indipendenti',mixed:'Disegno misto',between:'Stimoli di soggetti diversi'}[design];
    const permutations = Number($('permutations').value).toLocaleString('it-IT');
    const correction = currentMode === 'series' ? ($('temporalCorrection').value === 'cluster' ? 'Massa dei cluster' : 'Max-T') : null;
    const parts = [type, correction, design === 'one' ? `Valore nullo ${$('nullValue').value}` : null,
      `${permutations} permutazioni`, `Seed ${$('seed').value}`];
    $('statsOptionsSummary').textContent = parts.filter(Boolean).join(' · ');
  }

  function groupFor(recordId) {
    return assignments.get(recordId) ?? groups[0].id;
  }

  function groupSelect(record) {
    const select = el('select');
    select.setAttribute('aria-label', `Gruppo di ${record.subject}`);
    for (const group of groups) {
      const option = el('option', group.name);
      option.value = group.id;
      select.append(option);
    }
    select.value = groupFor(record.id);
    select.onchange = () => {
      assignGroup(record.id, select.value);
      if (!previousSettings) { saveGroupSettings(); clearResults(); }
    };
    return select;
  }

  function assignGroup(recordId, groupId) {
    if (groupId === groups[0].id) assignments.delete(recordId);
    else assignments.set(recordId, groupId);
  }

  function groupSettingsChanged() {
    if (!previousSettings) { saveGroupSettings(); clearResults(); }
    groupEditor();
    updateStatsSample();
  }

  function groupEditor() {
    methodDescription();
    updateStatsOptionsSummary();
    const design = $('design').value;
    $('groupEditor').hidden = !['multi', 'mixed'].includes(design);
    $('mixedDesignControls').hidden = design !== 'mixed';
    $('nullValue').disabled = design !== 'one';
    $('groupNames').replaceChildren();
    if (!['multi', 'mixed'].includes(design)) return;
    for (const group of groups) {
      const row = el('div', undefined, 'group-name');
      const label = el('label', 'Nome del gruppo');
      const input = el('input');
      input.value = group.name;
      input.onchange = () => {
        group.name = input.value.trim() || group.name;
        input.value = group.name;
        for (const option of $('statsSampleList').querySelectorAll('option')) {
          if (option.value === group.id) option.textContent = group.name;
        }
        for (const button of $('statsGroupQuickButtons').children) {
          if (button.dataset.group === group.id) button.textContent = group.name;
        }
        if (!previousSettings) { saveGroupSettings(); clearResults(); }
      };
      label.append(input);
      row.append(label);
      if (groups.length > 2) {
        const remove = el('button', '×');
        remove.setAttribute('aria-label', `Rimuovi gruppo ${group.name}`);
        remove.onclick = () => {
          groups = groups.filter(item => item.id !== group.id);
          for (const [id, assigned] of assignments) {
            if (assigned === group.id) assignments.delete(id);
          }
          groupSettingsChanged();
        };
        row.append(remove);
      }
      $('groupNames').append(row);
    }
  }
  function table(target, headers, rows, caption) {
    const t = el('table'), head = el('thead'), headings = el('tr'), body = el('tbody');
    if (caption) t.append(el('caption', caption));
    headings.append(...headers.map(value => el('th', value)));
    head.append(headings);
    for (const row of rows.slice(0, 1000)) {
      const tr = el('tr');
      tr.append(...row.map(value => el('td', value)));
      body.append(tr);
    }
    t.append(head, body);
    $(target).append(t);
    if (rows.length > 1000) $(target).append(el('p', 'Anteprima limitata a 1.000 righe. Il CSV contiene tutti i risultati.', 'panel-note'));
  }
  function flagLabel(flag){return flag?.status==='flagged'?(flag.flaggedEpochs?`Sì (${flag.flaggedEpochs.length})`:'Sì'):flag?.status==='within'?'No':flag?.status==='disabled'?'Off':'N/D';}
  function flagDescription(flag,summary){
    if (flag?.manual) return 'Scelta manuale · ' + (flag.status === 'flagged' ? 'Outlier' : 'Non outlier') + '.';

    if(flag?.flaggedEpochs && flag.status!=='disabled'){
      const evaluated=`${flag.evaluatedEpochs.length}/${flag.totalEpochs} epoche valutabili`,missing=flag.unavailableEpochs.length?` Non valutabili: ${flag.unavailableEpochs.join(', ')}.`:'';
      return (flag.status==='flagged'?`Outlier in: ${flag.flaggedEpochs.join(', ')}. `:flag.status==='within'?'Nessun outlier nelle epoche valutabili. ':'Nessuna epoca valutabile. ')+evaluated+missing+(flag.manualEpochs?.length?' Scelte manuali per '+flag.manualEpochs.join(', ')+'.':'')+' Nessuna esclusione automatica.';
    }
    if(!flag||flag.status==='insufficient')return summary?'Servono almeno 5 riepiloghi validi per questa metrica ed epoca.':'Servono almeno 5 soggetti confrontabili e almeno 3 istanti valutabili (oppure 5 medie temporali valide).';
    if(flag.status==='disabled')return 'Rilevamento disattivato.';
    if(flag.tested!==undefined)return `${flag.deviating}/${flag.tested} istanti oltre soglia. Nessuna esclusione automatica.`;
    return `Valore: ${fmt(flag.value)}; limiti IQR: ${fmt(flag.lowerFence)} / ${fmt(flag.upperFence)}; z robusto: ${fmt(flag.robustZ)}. Nessuna esclusione automatica.`;
  }
  function updateIsolationControls(ctx, revealSubject = false){
    const drawable=ctx.records.filter(r=>ctx.mode==='series'?ctx.analysisInput.items.some((item,i)=>item.r.id===r.id&&ctx.analysisInput.alignment.values[i].some(C.finite)):ctx.analysisInput.rows.some(row=>row.subject===r.subject&&C.finite(row.value)));
    const scopedFlags = subjectFilterFlags(ctx);
    const ids=isolation.resolve(drawable,scopedFlags),target=isolation.target;
    const count=drawable.filter(r=>scopedFlags.get(r.id)?.status==='flagged').length;
    const outliersOnly = target?.type === 'outliers';
    const button = $('isolateOutliers');
    button.disabled = count === 0;
    button.textContent = outliersOnly ? 'Ripristina vista' : `Solo outlier (${count})`;
    button.setAttribute('aria-pressed', String(outliersOnly));
    $('restoreIsolation').hidden = target?.type !== 'subject';
    $('isolationStatus').textContent = target ? ids.length + (ids.length === 1 ? ' soggetto evidenziato.' : ' soggetti evidenziati.') : '';
    const list = $('subjects');
    isolatedOutlierIds = outliersOnly ? new Set(ids) : null;
    filterSubjects();
    for(const row of list.children){
      let button=row.querySelector('.trace-isolate-button');
      if(!button){button=el('button','◎','trace-isolate-button');button.type='button';button.onclick=()=>{isolation.toggleSubject(row.dataset.recordingId);subviews[currentMode]='view';subview();updateIsolationControls(context);};row.insertBefore(button,row.lastElementChild);}
      const record=ctx.dataset.recordings.find(r=>r.id===row.dataset.recordingId),selected=drawable.some(r=>r.id===row.dataset.recordingId),active=target?.type==='subject'&&target.id===row.dataset.recordingId;
      button.disabled=!selected;button.setAttribute('aria-pressed',String(active));button.setAttribute('aria-label',`${active?'Ripristina':'Isola'} traccia ${record.subject}`);button.title=selected?`${active?'Ripristina':'Isola'} la traccia di ${record.subject}`:'Seleziona un soggetto con valori visualizzabili per isolare la traccia';
      row.classList.toggle('is-highlighted', active);
      if (active && revealSubject && !row.hidden) {
        const scroller = $('subjectList');
        const viewport = scroller.getBoundingClientRect();
        const item = row.getBoundingClientRect();
        if (item.top < viewport.top) scroller.scrollTop += item.top - viewport.top;
        else if (item.bottom > viewport.bottom) scroller.scrollTop += item.bottom - viewport.bottom;
      }
    }
    ctx.setVisualIsolation(ids);
    if (target?.type !== 'subject') selectedPair = null;
    paintSelectedPair();
    if (selectedPair) $('isolationStatus').textContent = ctx.dataset.recordings.find(record => record.id === selectedPair.id)?.subject +
      ' · ' + selectedPair.epoch;
  }

  function manualOutlierKey(id, epoch, metric) {
    return JSON.stringify([id, epoch, metric]);
  }

  function applyManualOutliers(ctx, epoch, flags, available) {
    const updated = new Map(flags);
    for (const id of available) {
      const key = manualOutlierKey(id, epoch, ctx.metric);
      if (!manualOutliers.has(key)) continue;
      const automatic = flags.get(id);
      updated.set(id, { ...automatic, status: manualOutliers.get(key) ? 'flagged' : 'within',
        manual: true, automaticStatus: automatic?.status ?? 'insufficient' });
    }
    return updated;
  }

  function manualOutlierAnnotations(ctx, epochs) {
    const allowed = new Set(epochs), records = new Map(ctx.dataset.recordings.map(record => [record.id, record]));
    return [...manualOutliers].flatMap(([key, outlier]) => {
      const [id, epoch, metric] = JSON.parse(key), record = records.get(id);
      return record && metric === ctx.metric && allowed.has(epoch)
        ? [{ subject_id: id, subject: record.subject, epoch, metric, outlier }] : [];
    });
  }

  function menuIsOpen() {
    return outlierMenu.matches?.(':popover-open') ?? false;
  }

  function currentOutlierAnchor() {
    if (!outlierMenuTarget) return null;
    const { id, epoch, source } = outlierMenuTarget;
    if (source === 'plot') {
      return [...(document.querySelectorAll?.('#chart [data-subject-id]') ?? [])].find(point =>
        point.dataset.subjectId === id && point.dataset.subjectEpoch === epoch);
    }
    const row = [...$('subjects').children].find(row => row.dataset.recordingId === id);
    return [...(row?.querySelectorAll('[data-subject-epoch]') ?? [])].find(chip => chip.dataset.subjectEpoch === epoch);
  }

  function positionOutlierMenu() {
    if (!outlierMenuTarget) return;
    const bounds = currentOutlierAnchor()?.getBoundingClientRect?.() ?? outlierMenuTarget.bounds;
    if (!bounds) return;
    const margin = 8, gap = 10, width = outlierMenu.offsetWidth || 238, height = outlierMenu.offsetHeight || 180;
    const viewportWidth = globalThis.innerWidth ?? 1024, viewportHeight = globalThis.innerHeight ?? 768;
    const right = bounds.right + gap;
    const left = right + width <= viewportWidth - margin ? right : bounds.left - width - gap;
    outlierMenu.style.left = Math.max(margin, Math.min(left, viewportWidth - width - margin)) + 'px';
    outlierMenu.style.top = Math.max(margin, Math.min(bounds.top, viewportHeight - height - margin)) + 'px';
  }

  function closeOutlierMenu(restoreFocus = false) {
    const anchor = restoreFocus ? currentOutlierAnchor() : null;
    if (menuIsOpen()) outlierMenu.hidePopover();
    outlierMenuTarget = null;
    anchor?.focus({ preventScroll: true });
  }

  function openOutlierMenu(anchor, bounds) {
    if (!context || !selectedPair) return;
    closeOutlierMenu();
    const { id, epoch } = selectedPair;
    const record = context.dataset.recordings.find(record => record.id === id);
    if (!record) return;
    outlierMenuTarget = { id, epoch, metric: context.metric, source: anchor.dataset.subjectId ? 'plot' : 'list', bounds };
    const flags = context.mode === 'summary' ? perEpochFlags.get(epoch) : latestFlags;
    const flagged = flags?.get(id)?.status === 'flagged';
    $('pointOutlierIdentity').textContent = record.subject + ' · ' + stimulusLabel(epoch);
    $('pointOutlierIdentity').title = record.subject + ' · ' + epoch + ' · ' + context.metric;
    for (const [button, checked] of [[$('markPointOutlier'), flagged], [$('markPointNormal'), !flagged]]) {
      button.setAttribute('aria-checked', String(checked));
      button.querySelector('.point-outlier-menu__check').textContent = checked ? '✓' : '';
    }
    $('resetPointOutlier').hidden = !manualOutliers.has(manualOutlierKey(id, epoch, context.metric));
    outlierMenu.showPopover();
    positionOutlierMenu();
    $('markPointOutlier').focus({ preventScroll: true });
  }

  function setManualOutlier(value) {
    const target = outlierMenuTarget;
    if (!target || !context || target.metric !== context.metric) return;
    const key = manualOutlierKey(target.id, target.epoch, target.metric);
    if (value === null) manualOutliers.delete(key);
    else manualOutliers.set(key, value);
    closeOutlierMenu();
    updateOutliers(context);
    if (resultMeta) resultMeta.manual_outlier_flags = JSON.stringify(
      manualOutlierAnnotations(context, JSON.parse(resultMeta.selected_epochs)));
    outlierMenuTarget = target;
    const anchor = currentOutlierAnchor();
    outlierMenuTarget = null;
    anchor?.focus({ preventScroll: true });
  }

  $('markPointOutlier').onclick = () => setManualOutlier(true);
  $('markPointNormal').onclick = () => setManualOutlier(false);
  $('resetPointOutlier').onclick = () => setManualOutlier(null);
  $('closePointOutlierMenu').onclick = () => closeOutlierMenu(true);
  outlierMenu.addEventListener('keydown', event => {
    if (!['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const choices = [$('markPointOutlier'), $('markPointNormal')];
    const index = choices.indexOf(document.activeElement);
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? choices.length - 1
      : (index + (event.key === 'ArrowDown' ? 1 : choices.length - 1)) % choices.length;
    choices[next].focus({ preventScroll: true });
  });
  outlierMenu.addEventListener('toggle', event => {
    if (event.newState === 'closed' && !menuIsOpen()) outlierMenuTarget = null;
  });
  globalThis.addEventListener?.('resize', () => { if (menuIsOpen()) positionOutlierMenu(); });
  document.addEventListener('scroll', () => { if (menuIsOpen()) positionOutlierMenu(); }, true);

  function paintSelectedPair() {
    for (const chip of $('subjects').querySelectorAll('[data-subject-epoch]')) {
      const selected = selectedPair?.id === chip.closest('.subject-row').dataset.recordingId && selectedPair.epoch === chip.dataset.subjectEpoch;
      chip.classList.toggle('is-selected-pair', selected);
      chip.setAttribute('aria-pressed', String(selected));
    }
    for (const point of document.querySelectorAll?.('#chart [data-subject-id]') ?? []) {
      const selected = selectedPair?.id === point.dataset.subjectId && selectedPair.epoch === point.dataset.subjectEpoch;
      point.classList.toggle('is-selected-pair', selected);
      point.setAttribute('aria-pressed', String(selected));
      const flags = context?.mode === 'summary' ? perEpochFlags.get(point.dataset.subjectEpoch) : latestFlags;
      const flag = flags?.get(point.dataset.subjectId);
      point.classList.toggle('is-outlier', flag?.status === 'flagged');
      if (flag?.manual) point.dataset.manualOutlier = flag.status === 'flagged' ? 'outlier' : 'non-outlier';
      else delete point.dataset.manualOutlier;
    }
  }
  document.addEventListener('metrics-subject-points-rendered', () => {
    paintSelectedPair();
    if (outlierMenu.matches?.(':popover-open')) positionOutlierMenu();
  });

  const subjectSearch = $('subjectSearch');
  const normalizeSubject = text => text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLocaleLowerCase();

  function subjectFilterFlags(ctx) {
    const epoch = $('subjectEpochFilter').value;
    return ctx?.mode === 'summary' && epoch ? perEpochFlags.get(epoch) ?? new Map() : latestFlags;
  }

  function refreshSubjectFilters(ctx) {
    const summary = ctx.mode === 'summary';
    const choices = summary ? ctx.analysisInput.epochs : [];
    const epochFilter = $('subjectEpochFilter'), previous = epochFilter.value;
    epochFilter.replaceChildren(el('option', 'Tutti quelli nel grafico'), ...choices.map(epoch => {
      const option = el('option', epoch);
      option.value = epoch;
      return option;
    }));
    epochFilter.children[0].value = '';
    epochFilter.value = choices.includes(previous) ? previous : '';
    $('subjectEpochFilterControl').hidden = !summary;
    const groupFilter = $('subjectGroupFilter'), priorGroup = groupFilter.value;
    groupFilter.replaceChildren(el('option', 'Tutti i gruppi'), ...groups.map(group => {
      const option = el('option', group.name);
      option.value = group.id;
      return option;
    }));
    groupFilter.children[0].value = '';
    groupFilter.value = !summary && groups.some(group => group.id === priorGroup) ? priorGroup : '';
    $('subjectGroupFilterControl').hidden = summary || !assignments.size;
  }

  function stimulusLabel(epoch) {
    const epochs = context?.analysisInput.epochs ?? [epoch];
    let prefix = epochs[0] ?? '';
    for (const value of epochs) while (prefix && !value.startsWith(prefix)) prefix = prefix.slice(0, -1);
    prefix = epochs.length > 1 ? prefix.slice(0, prefix.lastIndexOf('_') + 1) : '';
    return (prefix && epoch.length > prefix.length ? epoch.slice(prefix.length) : epoch.replace(/^STIM_/i, '')).replaceAll('_', ' ').trim();
  }

  function filterSubjects() {
    const query = normalizeSubject(subjectSearch.value.trim());
    const epoch = $('subjectEpochFilter').value, group = $('subjectGroupFilter').value;
    let found = 0;
    for (const row of $('subjects').children) {
      const { subject, recordingId } = row.dataset;
      const matches = !query || normalizeSubject(subject).includes(query) ||
        normalizeSubject(recordingId).includes(query);
      const epochs = JSON.parse(row.dataset.epochs || '[]');
      row.hidden = !matches || (epoch && !epochs.includes(epoch)) ||
        (group && groupFor(recordingId) !== group) ||
        (isolatedOutlierIds !== null && !isolatedOutlierIds.has(recordingId));
      for (const chip of row.querySelectorAll('[data-subject-epoch]')) {
        chip.hidden = Boolean(epoch && chip.dataset.subjectEpoch !== epoch);
      }
      if (!row.hidden) found++;
    }
    $('subjectFilterCount').textContent = found + (found === 1 ? ' soggetto nella lista' : ' soggetti nella lista');
    $('subjectSearchEmpty').hidden = found > 0;
    $('subjectSearchEmpty').textContent = context ? 'Nessun soggetto corrisponde ai filtri.' : 'Seleziona dati utilizzabili.';
    updateVisibleOutlierAction();
  }

  for (const id of ['subjectEpochFilter', 'subjectGroupFilter']) $(id).addEventListener('change', () => {
    if (context) updateIsolationControls(context);
    else filterSubjects();
    $('subjectList').scrollTop = 0;
  });

  subjectSearch.addEventListener('input', () => {
    filterSubjects();
    $('subjectList').scrollTop = 0;
  });

  function visibleOutliersToExclude() {
    if (!context || !isolatedOutlierIds) return [];
    return Array.from($('subjects').children)
      .filter(row => !row.hidden && isolatedOutlierIds.has(row.dataset.recordingId) &&
        !statsExclusions.has(row.dataset.recordingId))
      .map(row => row.dataset.recordingId);
  }

  function updateVisibleOutlierAction() {
    if (previousSettings) return;
    const button = $('excludeVisibleOutliers');
    const count = visibleOutliersToExclude().length;
    button.hidden = !context || !isolatedOutlierIds;
    button.disabled = count === 0;
    button.textContent = count ? `Escludi dai test (${count})` : 'Escludi dai test';
  }
  const sampleSearch = $('statsSampleSearch');
  sampleSearch.addEventListener('input', () => {
    updateStatsSample();
    $('statsSampleList').scrollTop = 0;
  });

  function updateStatsSample() {
    const list = $('statsSampleList');
    const hasGroups = ['multi', 'mixed'].includes($('design').value);
    list.classList.toggle('has-groups', hasGroups);
    const selectedIds = $('design').value === 'mixed' && context?.selectedRecords
      ? new Set(context.selectedRecords.map(record => record.id)) : sampleSelection;
    const excludedCount = sampleRecords.filter(record =>
      !selectedIds.has(record.id) || statsExclusions.has(record.id)).length;
    $('statsExcludedCount').textContent = excludedCount ? '· ' + excludedCount + ' esclusi' : '';
    $('includeAllStats').disabled = !statsExclusions.size;

    const terms = sampleSearch.value.split(',')
      .map(term => normalizeSubject(term.trim()))
      .filter(Boolean);
    const textTerms = [];
    const ranges = [];
    for (const term of terms) {
      const match = /^(\d+)(?:\s*[-–]\s*(\d+))?$/.exec(term);
      if (!match) {
        textTerms.push(term);
        continue;
      }
      const first = BigInt(match[1]);
      const last = BigInt(match[2] ?? match[1]);
      ranges.push(first <= last ? [first, last] : [last, first]);
    }

    const isFiltered = terms.length > 0;
    const visible = isFiltered ? sampleRecords.filter(({subject, id}) => {
      const name = normalizeSubject(subject);
      const recordingId = normalizeSubject(id);
      if (textTerms.some(term => name.includes(term) || recordingId.includes(term))) return true;
      if (!ranges.length) return false;
      const numbers = (name + ' ' + recordingId).match(/\d+/g) ?? [];
      return numbers.some(digits => {
        const number = BigInt(digits);
        return ranges.some(([first, last]) => number >= first && number <= last);
      });
    }) : sampleRecords;
    $('statsSampleEmpty').hidden = !isFiltered || visible.length > 0;
    const canAssign = hasGroups && isFiltered && visible.length > 0;
    $('statsGroupQuickAssign').hidden = !canAssign;
    const quickButtons = $('statsGroupQuickButtons');
    $('statsGroupQuickLabel').textContent = visible.length === 1
      ? 'Assegna il soggetto trovato a' : 'Assegna i ' + visible.length + ' soggetti trovati a';
    quickButtons.replaceChildren(...(canAssign ? groups.map(group => {
      const button = el('button', group.name);
      button.dataset.group = group.id;
      button.onclick = () => {
        for (const record of visible) assignGroup(record.id, group.id);
        if (!previousSettings) { saveGroupSettings(); clearResults(); }
        updateStatsSample();
        [...quickButtons.children].find(item => item.dataset.group === group.id)?.focus();
      };
      return button;
    }) : []));

    list.replaceChildren(...visible.map((record, index) => {
      const unselected = !selectedIds.has(record.id);
      const flagged = context && latestFlags.get(record.id)?.status === 'flagged';
      const label = el('label', undefined, flagged ? 'check-option outlier-flagged' : 'check-option');
      const checkbox = el('input');
      checkbox.type = 'checkbox';
      checkbox.checked = unselected || statsExclusions.has(record.id);
      checkbox.disabled = unselected;
      const flag = flagged ? ' · Outlier' : '';
      const selection = unselected ? ' · Deselezionato in Soggetti' : '';
      checkbox.onchange = () => {
        if (checkbox.checked) statsExclusions.add(record.id);
        else statsExclusions.delete(record.id);
        statsSampleChanged();
        list.querySelectorAll('input[type="checkbox"]')[index]?.focus();
      };
      label.append(checkbox, el('span', record.subject + flag + selection));
      if (!hasGroups) return label;
      const row = el('div', undefined, 'stats-sample-row');
      row.append(label, groupSelect(record));
      return row;
    }));
  }

  function statsSampleChanged() {
    if (!previousSettings) clearResults('Campione aggiornato. Esegui l’analisi per applicare le esclusioni.');
    updateStatsSample();
    updateVisibleOutlierAction();
  }

  $('excludeVisibleOutliers').onclick = () => {
    const ids = visibleOutliersToExclude();
    if (!ids.length) return;
    for (const id of ids) statsExclusions.add(id);
    statsSampleChanged();
    $('isolationStatus').textContent = ids.length === 1
      ? '1 outlier escluso dai test.'
      : `${ids.length} outlier esclusi dai test.`;
    $('isolateOutliers').focus();
  };

  $('includeAllStats').onclick = () => {
    statsExclusions.clear();
    statsSampleChanged();
  };

  document.addEventListener('metrics-dataset-replaced', () => {
    manualOutliers.clear();
    closeOutlierMenu();
    statsExclusions.clear();
    subjectSearch.value = '';
    $('subjectEpochFilter').value = $('subjectGroupFilter').value = '';
  });
  function updateOutliers(ctx){
    const summary=ctx.mode==='summary',method=$(summary?'outlierSummary':'outlierSeries').value;
    $('outlierSeries').closest('.control-block').hidden=summary;$('summaryOutlierControl').hidden=!summary;
    $('outlierContext').textContent = '';
    let flags=new Map();const epochFlags=new Map();
    try{
      if(summary){
        for(const epoch of ctx.analysisInput.epochs){
          const items=ctx.prepared(ctx.dataset.recordings,epoch,ctx.metric,ctx.o,[]);
          const values = items.map(item => ({id: item.r.id, value: C.aggregate(item.series, $('aggregation').value, ctx.o.from, ctx.o.to, C.gapLimit(item.series, ctx.o.maxGap)).value}));
          epochFlags.set(epoch, applyManualOutliers(ctx, epoch, A.scalarFlags(values, method), new Set(values.filter(item => C.finite(item.value)).map(item => item.id))));
        }
        flags=A.summaryFlags(ctx.dataset.recordings,ctx.analysisInput.epochs,epochFlags,method);
        for (const row of ctx.exportRows) {
          if (row.row_type !== 'subject') continue;
          const flag = epochFlags.get(row.epoch)?.get(ctx.records.find(record => record.subject === row.subject)?.id);
          row.outlier_method = method;
          row.outlier_status = flag?.status || 'insufficient';
          row.outlier_source = flag?.manual ? 'manual' : 'automatic';
          row.outlier_automatic_status = flag?.automaticStatus ?? row.outlier_status;
        }
      }else{
        const items=ctx.prepared(ctx.dataset.recordings,ctx.epoch,ctx.metric,ctx.o,[]);
        flags=A.temporalFlags(items,{from:ctx.o.from,to:ctx.o.to,step:ctx.o.step,maxGap:ctx.o.maxGap,method:$('interpolation').value},method);
        const available = new Set(items.filter(item => item.series.values.some((value, i) => C.finite(value) && item.series.time[i] >= ctx.o.from && item.series.time[i] <= ctx.o.to)).map(item => item.r.id));
        flags = applyManualOutliers(ctx, ctx.epoch, flags, available);
        const flagged=ctx.records.filter(r=>flags.get(r.id)?.status==='flagged').map(r=>r.subject).join('; ');
        for(const row of ctx.exportRows){row.outlier_method=method;row.flagged_subjects=flagged;row.manual_outlier_flags=JSON.stringify(manualOutlierAnnotations(ctx,[ctx.epoch]));}
      }
    }catch(e){$('outlierContext').textContent+=` · Non valutabile: ${e.message}`;}
    latestFlags=flags;
    perEpochFlags = epochFlags;
    refreshSubjectFilters(ctx);
    updateStatsSample();
    for (const row of $('subjects').children) {
      row.querySelector('.outlier-badge')?.remove();
      row.querySelector('.subject-epoch-chips')?.remove();
      row.querySelector('.subject-group-label')?.remove();
      if (summary) {
        const chips = el('div', undefined, 'subject-epoch-chips');
        chips.setAttribute('role', 'group');
        chips.setAttribute('aria-label', 'Stimoli con dati per ' + row.dataset.subject);
        const epochs = JSON.parse(row.dataset.epochs || '[]');
        for (const epoch of epochs) {
          const flagged = epochFlags.get(epoch)?.get(row.dataset.recordingId)?.status === 'flagged';
          const chip = el('button', stimulusLabel(epoch) + (flagged ? ' · Outlier' : ''), 'subject-epoch-chip' + (flagged ? ' is-outlier' : ''));
          chip.dataset.subjectEpoch = epoch;
          const flag = epochFlags.get(epoch)?.get(row.dataset.recordingId);
          chip.title = epoch + (flag?.manual ? ' · Scelta manuale' : '');
          if (flag?.manual) chip.dataset.manualOutlier = flag.status === 'flagged' ? 'outlier' : 'non-outlier';
          chip.setAttribute('aria-label', row.dataset.subject + ' · ' + epoch + (flagged ? ' · Outlier' : ''));
          chip.setAttribute('aria-pressed', 'false');
          chip.setAttribute('aria-haspopup', 'dialog');
          chip.onclick = event => identifySubject(row.dataset.recordingId, epoch, event.currentTarget);
          chips.append(chip);
        }
        row.insertBefore(chips, row.lastElementChild);
      } else {
        const flag = flags.get(row.dataset.recordingId), badge = el('button', flagLabel(flag), 'outlier-badge outlier-' + (flag?.status || 'insufficient'));
        badge.title = flagDescription(flag, false);
        badge.setAttribute('aria-label', 'Outlier ' + flagLabel(flag) + '. ' + badge.title);
        badge.setAttribute('aria-haspopup', 'dialog');
        badge.dataset.subjectEpoch = ctx.epoch;
        if (flag?.manual) badge.dataset.manualOutlier = flag.status === 'flagged' ? 'outlier' : 'non-outlier';
        badge.onclick = event => identifySubject(row.dataset.recordingId, ctx.epoch, event.currentTarget);
        row.insertBefore(badge, row.lastElementChild);
      }
      if (!summary && assignments.size) row.insertBefore(el('span', groups.find(group => group.id === groupFor(row.dataset.recordingId))?.name, 'subject-group-label'), row.lastElementChild);
    }
    updateIsolationControls(ctx);
  }
  document.addEventListener('metrics-invalidated',e=>{closeOutlierMenu();currentMode=e.detail?.mode||currentMode;context=null;selectedPair=null;
    if ('dataset' in (e.detail || {})) {
      sampleRecords = e.detail.dataset?.recordings ?? [];
      sampleSelection = new Set(e.detail.selectedIds);
      const loaded = new Set(sampleRecords.map(record => record.id));
      for (const id of statsExclusions) if (!loaded.has(id)) statsExclusions.delete(id);
      for (const key of manualOutliers.keys()) if (!loaded.has(JSON.parse(key)[0])) manualOutliers.delete(key);
    }
    updateStatsSample();
    const isolate = $('isolateOutliers');
    isolate.disabled = true;
    isolate.textContent = 'Solo outlier (0)';
    isolate.setAttribute('aria-pressed', 'false');
    if ('dataset' in (e.detail || {}) && !e.detail.dataset) subjectSearch.value = '';
    isolatedOutlierIds = null;
    filterSubjects();
    $('restoreIsolation').hidden=true;$('isolationStatus').textContent='';for(const button of $('subjects').querySelectorAll('.trace-isolate-button'))button.disabled=true;clearResults('Seleziona dati utilizzabili nella visualizzazione.');for(const badge of $('subjects').querySelectorAll('.outlier-badge'))badge.remove();
    for (const row of $('subjects').children) {
      row.classList.remove('is-highlighted');
    }
    subview();
  });
  document.addEventListener('metrics-ready',e=>{
    context=e.detail;currentMode=context.mode;
    sampleRecords = context.dataset.recordings;
    sampleSelection = new Set(context.records.map(record => record.id));
    const key=JSON.stringify([context.mode,context.metric,context.mode==='series'?context.epoch:null,context.o,$('aggregation').value,context.dataset.recordings.map(r=>r.id),context.analysisInput.epochs,context.analysisInput.alignmentOptions?.range,context.analysisInput.alignmentOptions?.method]);if(key!==isolationKey||isolationDataset!==context.dataset){isolation.reset();isolationKey=key;isolationDataset=context.dataset;}subview();groupEditor();updateOutliers(context);$('runStats').disabled=false;
    populateMixedOptions();
    methodDescription();
    $('statsStatus').textContent = '';
  });
  for (const [view, [tabId]] of Object.entries(panels)) {
    $(tabId).onclick = () => {
      subviews[currentMode] = view;
      subview();
      if (view === 'stats') globalThis.MetricsWebR?.prepare?.().catch(() => {});
    };
  }
  $('isolateOutliers').onclick=()=>{if(!context)return;isolation.toggleOutliers();subviews[currentMode]='view';subview();updateIsolationControls(context);};
  function identifySubject(id, epoch, anchor) {
    if (!context) return;
    const anchorBounds = anchor?.getBoundingClientRect?.();
    subjectSearch.value = '';
    $('subjectGroupFilter').value = '';
    if ($('subjectEpochFilter').value !== epoch) $('subjectEpochFilter').value = '';
    if (isolation.target?.type !== 'subject' || isolation.target.id !== id) isolation.toggleSubject(id);
    selectedPair = {id, epoch};
    updateIsolationControls(context, true);
    if (anchor) openOutlierMenu(anchor, anchorBounds);
  }
  document.addEventListener('metrics-isolate-subject', e => {
    identifySubject(e.detail.id, e.detail.epoch ?? context?.epoch, e.detail.anchor);
  });
  function dismissIsolation(){if(!context||!isolation.target)return;isolation.reset();updateIsolationControls(context);}
  document.addEventListener('click',e=>{
    if (isolation.target?.type !== 'subject') return;
    if(e.target?.closest?.('.trace-isolate-button, #isolateOutliers, #restoreIsolation, .chart-panner, .chart-zoom-tools, #chart [role="button"], .subject-epoch-chip, #pointOutlierMenu, dialog, [aria-haspopup="dialog"]'))return;
    dismissIsolation();
  });
  document.addEventListener('keydown',e=>{if(e.key==='Escape'&&!outlierMenu.matches?.(':popover-open')&&!document.querySelector?.('dialog[open]'))dismissIsolation();});
  $('restoreIsolation').onclick=()=>{isolation.reset();if(context)updateIsolationControls(context);};
  function refreshOutlierFeedback(){if(!context)return;const ctx=context;return MetricsBusy.run('Ricerca degli outlier in corso…',async()=>{if(context===ctx)updateOutliers(ctx);}).catch(error=>{$('outlierContext').textContent=error.message;});}
  $('outlierSeries').onchange=refreshOutlierFeedback;$('outlierSummary').onchange=refreshOutlierFeedback;
  const statsSettingsIds = ['design', 'nullValue', 'permutations', 'seed', 'temporalCorrection'];
  function validThresholds(thresholds) {
    if (!thresholds) return false;
    const { single, double, triple } = thresholds;
    return [single, double, triple].every(Number.isFinite) && 0 < triple && triple < double && double < single && single < 1;
  }

  const formatThreshold = value => String(value).replace('.', ',');
  function updateThresholdNote() {
    const value = Number($('pThresholdSingle').value);
    $('pThresholdNonSignificant').textContent = value > 0 && value < 1
      ? 'n.s. · p > ' + formatThreshold(value) : 'n.s. · p sopra la soglia di *';
    $('pThresholdError').hidden = true;
  }

  function restoreThresholdFields() {
    for (const [key, id] of Object.entries(thresholdFields)) $(id).value = String(pThresholds[key]);
    updateThresholdNote();
  }

  for (const id of Object.values(thresholdFields)) $(id).addEventListener('input', updateThresholdNote);
  restoreThresholdFields();

  function updateResultThresholds() {
    resultMeta = { ...resultMeta, alpha: pThresholds.single,
      p_threshold_single: pThresholds.single, p_threshold_double: pThresholds.double, p_threshold_triple: pThresholds.triple };
  }
  const readStatsSettings = () => ({
    values: statsSettingsIds.map(id => $(id).value),
    groups: groups.map(group => ({...group})), nextGroup,
    assignments: [...assignments], exclusions: [...statsExclusions],
    mixedEpochs: Array.from($('mixedEpochs').selectedOptions, option => option.value).filter(Boolean)
  });
  connectMetricsSettings({
    trigger: $('openStatsSettings'), dialog: $('statsSettingsDialog'),
    begin: () => { populateMixedOptions(); previousSettings = readStatsSettings(); restoreThresholdFields(); },
    accept: () => {
      if (statsSettingsIds.some(id => $(id).reportValidity?.() === false)) return false;
      const nextThresholds = Object.fromEntries(Object.entries(thresholdFields).map(([key, id]) => [key, Number($(id).value)]));
      if (!validThresholds(nextThresholds)) {
        $('pThresholdError').hidden = false;
        return false;
      }
      const alphaChanged = pThresholds.single !== nextThresholds.single;
      const thresholdsChanged = alphaChanged || pThresholds.double !== nextThresholds.double || pThresholds.triple !== nextThresholds.triple;
      const next = readStatsSettings();
      const changed = JSON.stringify(previousSettings) !== JSON.stringify(next);
      previousSettings = null;
      pThresholds = nextThresholds;
      mixedEpochSelection = next.mixedEpochs;
      if (changed || thresholdsChanged) saveGroupSettings();
      if (changed) clearResults();
      else if (report && thresholdsChanged) {
        updateResultThresholds();
        if (currentMode === 'summary' || alphaChanged) report.render();
      }
      groupEditor();
      updateStatsSample();
      updateVisibleOutlierAction();
      if (context) updateOutliers(context);
    },
    discard: () => {
      const saved = previousSettings;
      previousSettings = null;
      statsSettingsIds.forEach((id, index) => { $(id).value = saved.values[index]; });
      groups = saved.groups;
      nextGroup = saved.nextGroup;
      assignments = new Map(saved.assignments);
      statsExclusions = new Set(saved.exclusions);
      for (const option of $('mixedEpochs').options) option.selected = saved.mixedEpochs.includes(option.value);
      restoreThresholdFields();
      groupEditor();
      updateStatsSample();
      if (document.dispatchEvent) document.dispatchEvent(new Event('metrics-settings-restored'));
    }
  });
  function populateMixedOptions() {
    if (!context || context.mode !== 'summary') return;
    const epochs = [...new Set(context.dataset.recordings.flatMap(record => record.epochs.map(epoch => epoch.id)))];
    const select = $('mixedEpochs');
    const previous = mixedEpochSelection ?? context.analysisInput.epochs;
    select.replaceChildren(...epochs.map(epoch => {
      const option = el('option', epoch);
      option.value = epoch;
      option.selected = previous.includes(epoch);
      return option;
    }));
    for (const id of ['mixedGroupEpochA', 'mixedGroupEpochB']) {
      const control = $(id), previous = control.value;
      control.replaceChildren(el('option', 'Scegli uno stimolo'), ...epochs.map(epoch => {
        const option = el('option', epoch);
        option.value = epoch;
        return option;
      }));
      control.children[0].value = '';
      control.value = epochs.includes(previous) ? previous : '';
    }
  }

  $('assignGroupsFromEpochs').onclick = () => {
    if (!context) return;
    const a = $('mixedGroupEpochA').value, b = $('mixedGroupEpochB').value;
    const records = context.dataset.recordings;
    const has = (record, epoch) => record.epochs.some(item => item.id === epoch && item.metrics[context.metric]?.values.some(C.finite));
    if (!a || !b || a === b || records.some(record => has(record, a) === has(record, b))) {
      $('mixedAssignmentStatus').textContent = 'Scegli due stimoli esclusivi. Ogni soggetto deve avere dati per uno solo dei due.';
      return;
    }
    groups = [{id: 'g1', name: a}, {id: 'g2', name: b}];
    assignments = new Map(records.map(record => [record.id, has(record, a) ? 'g1' : 'g2']));
    nextGroup = 3;
    $('mixedAssignmentStatus').textContent = 'Assegnazioni proposte. Conferma con OK.';
    groupEditor();
    updateStatsSample();
  };

  $('design').onchange=()=>{if (!previousSettings) clearResults();groupEditor();updateStatsSample();};
  $('addGroup').onclick=()=>{groups.push({id:`g${nextGroup}`,name:`Gruppo ${nextGroup++}`});groupSettingsChanged();};
  function clusterDirection(direction) {
    return direction > 0 ? 'Positiva' : direction < 0 ? 'Negativa' : 'Omnibus';
  }

  const inferentialSettings = {
    one: ['t a un campione · due code', 'Cambi di segno per soggetto'],
    repeated: ['F a misure ripetute', 'Permutazione delle epoche entro ogni soggetto'],
    paired: ['t appaiato · due code', 'Cambi di segno congiunti per soggetto'],
    groups: ['F omnibus tra gruppi', 'Permutazione delle etichette di gruppo'],
    mixed: ['ANOVA mista · gruppi × epoche', 'Rd_kheradPajouh_renaud'],
    mixedPaired: ['Confronti appaiati entro ciascun gruppo', 'Cambi di segno per soggetto'],
    posthoc: ['t post-hoc tra gruppi · due code', 'Permutazione congiunta delle etichette di gruppo'],
    cluster: ['Test per massa dei cluster', 'Massima massa per permutazione']
  };

  function displayResults() {
    const output = $('statsResults');
    output.replaceChildren();
    showStatsDetails.disabled = !report;
    if (!report) return;
    const visible = $('significantOnly').checked ? results.filter(row => Number.isFinite(row.pAdjusted) && row.pAdjusted <= resultMeta.alpha) : results;
    const type = resultMeta.view === 'series' ? 'Tempo [s]' : 'Epoca';
    const clusterMode = resultMeta.correction === 'cluster-mass';
    const alpha = formatThreshold(resultMeta.alpha);
    $('significantOnlyLabel').textContent = clusterMode
      ? 'Mostra solo cluster con p ≤ ' + alpha : 'Mostra solo risultati con p finale ≤ ' + alpha;
    const adjusted = ['p grezzo', 'p finale', 'Correzione', 'Ricampionamenti'];
    const pValues = row => [fmt(row.pUncorrected), fmt(row.pAdjusted), row.correction || resultMeta.correction, row.resamples ?? resultMeta.resamples];
    const interval = (lo, hi) => Number.isFinite(lo) && Number.isFinite(hi) ? '[' + fmt(lo) + ', ' + fmt(hi) + ']' : '—';
    for (const [kind, [caption]] of Object.entries(inferentialSettings)) {
      const rows = visible.filter(row => row.kind === kind);
      if (!rows.length) continue;
      if (kind === 'cluster') {
        table('statsResults', ['Inizio [s]', 'Fine [s]', 'Campioni', 'Direzione', 'N', 'Soglia', 'Massa', 'Picco [s]',
          resultMeta.design === 'one' ? 't al picco' : 'F al picco', 'p del cluster', 'Ricampionamenti'],
          rows.map(row => [fmt(row.start), fmt(row.end), row.samples, clusterDirection(row.direction), row.n, fmt(row.threshold),
            fmt(row.statistic), fmt(report.times[row.peakIndex]), fmt(row.peakStatistic), fmt(row.pAdjusted), resultMeta.resamples]), caption);
      } else if (kind === 'repeated' || kind === 'groups' || kind === 'mixed') {
        const heading = kind === 'mixed' ? 'Effetto' : kind === 'repeated' ? 'Epoche' : type;
        table('statsResults', [heading, 'N', 'gdl 1', 'gdl 2', 'QM effetto', 'QM errore', 'F', 'η² parziale', ...adjusted],
          rows.map(row => [row.label, row.n, row.df1, row.df2, fmt(row.msEffect), fmt(row.msError),
            fmt(row.statistic), fmt(row.eta), ...pValues(row)]), caption);
      } else {
        const independent = kind === 'posthoc';
        const target = ['paired', 'mixedPaired'].includes(kind) ? 'Coppia di epoche' : independent ? 'Epoca · confronto' : type;
        table('statsResults', [target, ...(independent ? ['N A', 'N B'] : ['N']), 'gdl', 't', 'Δ media', 'Errore standard',
          'IC 95% di Δ', ['paired', 'mixedPaired'].includes(kind) ? 'Cohen d_z' : 'Cohen d', ...adjusted],
          rows.map(row => [row.label, ...(independent ? [row.nA, row.nB] : [row.n]), row.df1, fmt(row.statistic), fmt(row.meanDifference),
            fmt(row.se), interval(row.ciLow, row.ciHigh), fmt(row.d), ...pValues(row)]), caption);
      }
    }
    if (!visible.length) output.append(el('p', results.length ? 'Nessun risultato con il filtro selezionato.' : 'Nessun cluster ha superato la soglia di formazione.', 'panel-note'));
    const selected = new Set(visible.map(row => row.index));
    for (const row of visible) {
      if (row.kind !== 'cluster') continue;
      for (let i = row.startIndex; i <= row.endIndex; i++) selected.add(i);
    }
    const seriesFiltered = resultMeta.view === 'series' && $('significantOnly').checked;
    const times = report.labels;
    const descriptives = report.summaries.flatMap((cells, group) => cells.flatMap((cell, index) => {
      if (seriesFiltered && !selected.has(index)) return [];
      return [[times[index], report.groupNames[group], report.groupSizes[group],
        fmt(cell.mean), fmt(cell.sd), interval(cell.mean - cell.margin, cell.mean + cell.margin)]];
    }));
    if (descriptives.length) table('statsResults', [type, 'Campione', 'N', 'Media', 'DS', 'IC 95% della media'], descriptives, 'Statistiche descrittive');
    output.append(el('p', 'Gli IC 95% sono puntuali e usano la distribuzione t. I p-value usano le permutazioni e la correzione riportata.', 'panel-note'));
    const { software } = report;
    const settings = ['N = ' + report.subjects.length, resultMeta.metric,
      'Seed ' + resultMeta.seed, 'Permutazioni richieste ' + resultMeta.permutations,
      'Soglia * = ' + formatThreshold(resultMeta.alpha), 'webR ' + software.webR, software.R, 'permuco ' + software.permuco];
    if (clusterMode) settings.push('Soglia di formazione ' + fmt(resultMeta.cluster_threshold));
    if (resultMeta.dropped_times) settings.push(resultMeta.dropped_times + ' istanti incompleti omessi');
    output.append(el('p', settings.join(' · '), 'panel-note'));
    if (resultMeta.warnings) output.append(el('p', resultMeta.warnings, 'panel-note'));
  }
  $('significantOnly').onchange = () => {
    significantOnlyByMode[currentMode] = $('significantOnly').checked;
    displayResults();
  };
  $('runStats').onclick=async()=>{
    if(!context)return;const ctx=context;clearResults('Preparazione dei test…');const ticket=version,design=$('design').value,permutations=Number($('permutations').value),nullValue=Number($('nullValue').value),seed=Number($('seed').value);
    const controller = new AbortController();
    activeAnalysis = controller;
    const job = MetricsBusy.start('Preparazione dell’analisi statistica…', {onCancel: () => {
      if (activeAnalysis === controller) clearResults('Analisi annullata.');
    }});
    try{
      await job.step('Preparazione dei dati per i test…');if(ticket!==version)return;
      if(!Number.isInteger(permutations)||permutations<100||permutations>50000||(design==='one'&&!Number.isFinite(nullValue))||!Number.isInteger(seed)||seed<0||seed>4294967295)throw new Error('Controlla valore nullo, seed e numero di permutazioni (100–50.000).');
      const analysisRecords = design === 'mixed' ? ctx.selectedRecords ?? ctx.records : ctx.records;
      const eligible = analysisRecords.filter(record => !statsExclusions.has(record.id));
      const manuallyExcluded = analysisRecords.filter(record => statsExclusions.has(record.id));
      if (eligible.length < 2) throw new Error('Seleziona almeno 2 soggetti per il campione statistico.');
      let matrix;
      let testAlignment = ctx.analysisInput.alignment;
      if (ctx.mode === 'series') {
        const items = ctx.analysisInput.items.filter(item => !statsExclusions.has(item.r.id));
        if (items.length < 2) throw new Error('Servono almeno 2 soggetti con serie utilizzabili.');
        if (items.length !== ctx.analysisInput.items.length) {
          testAlignment = C.align(items.map(item => item.series), ctx.analysisInput.alignmentOptions);
        }
        matrix = A.completeTimeMatrix(items, testAlignment);
      } else {
        if (design === 'mixed') {
          const epochs = mixedEpochSelection ?? ctx.analysisInput.epochs;
          if (epochs.length < 2) throw new Error('Seleziona almeno due epoche ripetute nelle Opzioni del disegno misto.');
          const rows = epochs.flatMap(epoch => ctx.prepared(eligible, epoch, ctx.metric, ctx.o, []).map(item => ({
            subject: item.r.subject, epoch,
            value: C.aggregate(item.series, $('aggregation').value, ctx.o.from, ctx.o.to, C.gapLimit(item.series, ctx.o.maxGap)).value
          })));
          matrix = A.completeSummaryMatrix(eligible, epochs, rows);
          matrix.epochs = epochs;
        } else if (design === 'between') {
          matrix = A.independentStimuliMatrix(eligible, ctx.analysisInput.epochs, ctx.analysisInput.rows);
        } else matrix = A.completeSummaryMatrix(eligible, ctx.analysisInput.epochs, ctx.analysisInput.rows);
      }
      if(matrix.subjects.length<2)throw new Error('Servono almeno 2 soggetti con dati completi.');
      if(matrix.times.length*matrix.subjects.length*permutations>300000000)throw new Error('Analisi troppo estesa: riduci permutazioni, intervallo o risoluzione temporale.');
      const independent = design === 'between';
      const analysisGroups = independent ? matrix.stimuli.map((epoch, i) => ({id: 'stimulus-' + i, name: epoch})) : groups;
      const subjects=matrix.subjects.map(s=>({...s,groupIndex:independent?s.groupIndex:groups.findIndex(g=>g.id===groupFor(s.id))}));
      if(['multi','mixed'].includes(design)&&groups.some((_,i)=>subjects.filter(s=>s.groupIndex===i).length<2))throw new Error('Assegna almeno 2 soggetti utilizzabili a ciascun gruppo.');
      $('runStats').disabled=true;
      const within=design==='within', mixed=design==='mixed';
      if ((mixed || independent) && ctx.mode !== 'summary') throw new Error('Il disegno misto è disponibile nel riepilogo temporale.');
      if(within&&ctx.mode!=='summary')throw new Error('Il confronto tra epoche è disponibile nel riepilogo temporale.');
      const clusterMode = ctx.mode === 'series' && $('temporalCorrection').value === 'cluster';
      const breaks = matrix.times.map((time, index) => clusterMode && index > 0 &&
        Number.isFinite(testAlignment?.step) && time - matrix.times[index - 1] > 1.5 * testAlignment.step);
      const computed = await MetricsWebR.run({
        subjects, times: matrix.times, breaks, seed, mode: independent ? 'multi' : design, nullValue, permutations,
        correction: clusterMode ? 'cluster' : 'maxT',
        epochs: mixed ? matrix.epochs : within ? ctx.analysisInput.epochs : [],
        groupNames: ['multi', 'mixed', 'between'].includes(design) && ctx.mode === 'summary' ? analysisGroups.map(group => group.name) : [],
        signal: controller.signal, onStatus: message => job.update(message),
        onProgress: (done, total, phase) => {
          if (ticket === version) job.update(phase + ' in corso…', {value: done, max: total});
        }
      });
      let { points } = computed;
      if(ticket!==version)return;
      await job.step('Preparazione dei risultati statistici…');if(ticket!==version)return;
      const labels=ctx.mode==='summary'?(matrix.epochs ?? ctx.analysisInput.epochs):matrix.times.map(fmt);
      const summaryGroups=!['multi','mixed','between'].includes(design)?[{name:'Campione statistico',subjects}]:analysisGroups.map((g,i)=>({name:g.name,subjects:subjects.filter(s=>s.groupIndex===i)}));
      const traces = summaryGroups.map((group, index) => {
        const summary = computed.groups[index];
        return {
          name: group.name + ' (N=' + group.subjects.length + ') · IC 95%',
          color: colors[index % colors.length], bold: true, x: matrix.times,
          y: summary.map(point => point.mean),
          band: summary.map(point => point.margin)
        };
      });
      if(ctx.mode==='series'){
        points=points.map((point,index)=>{
          const means=traces.map(trace=>trace.y[index]);
          const magnitude=design==='one'?Math.abs(means[0]-nullValue):Math.max(...means)-Math.min(...means);
          return {...point,magnitude};
        });
      }
      results = clusterMode
        ? computed.clusters.map(cluster => ({ ...cluster, kind: 'cluster', n: subjects.length }))
        : points.map((p, index) => ({
          ...p, n: subjects.length, index: within || mixed ? null : index, label: within || mixed ? p.label : labels[index],
          kind: mixed ? 'mixed' : within ? (p.epochA ? 'paired' : 'repeated') : design === 'one' ? 'one' : 'groups'
        }));
      const posthoc = (computed.posthoc ?? []).map(p => ({
        ...p, kind: p.kind ?? 'posthoc', index: p.epochIndex ?? null,
        epochA: p.epochA ?? labels[p.epochIndex], epochB: p.epochB ?? labels[p.epochIndex],
        label: p.label ?? labels[p.epochIndex] + ' · ' + p.groupA + ' − ' + p.groupB
      }));
      if (independent) {
        for (const point of posthoc) {
          point.epochA = matrix.stimuli[point.groupIndexA];
          point.epochB = matrix.stimuli[point.groupIndexB];
          point.label = point.epochA + ' − ' + point.epochB;
          if (matrix.stimuli.length === 2) point.correction = 'nessuna (un confronto indipendente)';
        }
        if (matrix.stimuli.length === 2) results = [];
      }
      results.push(...posthoc);
      resultMeta={view:ctx.mode,metric:ctx.metric,epoch:ctx.mode==='series'?ctx.epoch:'',aggregation:ctx.mode==='summary'?$('aggregation').value:'',normalization:ctx.o.norm,baseline:ctx.o.norm==='none'?'':ctx.o.baseline,baseline_from:Number.isFinite(ctx.o.baseFrom)?ctx.o.baseFrom:'',baseline_to:Number.isFinite(ctx.o.baseTo)?ctx.o.baseTo:'',mad_scale:ctx.o.scaled?1.4826:1,analysis_from:Number.isFinite(ctx.o.from)?ctx.o.from:'',analysis_to:Number.isFinite(ctx.o.to)?ctx.o.to:'',design,null_value:within?'':nullValue,permutations,seed,engine:'webR / permuco',resamples:computed.resamples,correction:clusterMode?'cluster-mass':within?'max-|T| (post-hoc only)':design==='one'?'max-abs-T':'max-F',family:within?'all epoch pairs for selected metric':ctx.mode==='series'?'all tested times':'all tested epochs',included_subjects:subjects.map(s=>s.subject).join('; '),manually_excluded_subjects:manuallyExcluded.map(r=>r.subject).join('; '),excluded_subjects:analysisRecords.filter(r=>!subjects.some(s=>s.id===r.id)).map(r=>r.subject).join('; '),group_assignments:['multi','mixed','between'].includes(design)?subjects.map(s=>`${s.subject}:${analysisGroups[s.groupIndex].name}`).join('; '):'',grid_step:ctx.mode==='series'?testAlignment.step:'',max_gap:ctx.o.maxGap??'auto:3*native_median_step',interpolation:ctx.mode==='series'?(ctx.analysisInput.alignmentOptions?.method ?? ''):'',outlier_method:$(ctx.mode==='series'?'outlierSeries':'outlierSummary').value};
      if (mixed) Object.assign(resultMeta, {correction: 'Holm', family: 'three mixed-design omnibus effects',
        formula: 'value ~ group * epoch + Error(subject/epoch)', permutation_method: 'Rd_kheradPajouh_renaud'});
      if (independent) Object.assign(resultMeta, {correction: matrix.stimuli.length === 2 ? 'none (one independent comparison)' : 'max-|T|',
        family: 'all independent stimulus pairs', assignment: 'stimulus observed for each subject'});
      const categories=ctx.mode==='summary'?(matrix.stimuli ?? labels):null;
      Object.assign(resultMeta, {
        confidence_level: 0.95, ci_method: 'pointwise Student t',
        analysis_samples: matrix.times.length, dropped_times: matrix.dropped ?? '',
        selected_epochs: JSON.stringify(categories ?? [ctx.epoch]),
        cluster_threshold: computed.threshold ?? '', webr_version: computed.software.webR,
        r_version: computed.software.R, permuco_version: computed.software.permuco,
        rng: 'Mersenne-Twister / Inversion / Rejection', warnings: (computed.warnings ?? []).join(' | '),
        manual_outlier_flags: JSON.stringify(manualOutlierAnnotations(ctx, categories ?? [ctx.epoch]))
      });
      report = {
        labels, times: matrix.times, subjects, breaks, summaries: computed.groups, software: computed.software,
        groupNames: summaryGroups.map(group => group.name), groupSizes: summaryGroups.map(group => group.subjects.length),
        render: renderStatPlot
      };
      updateResultThresholds();
      renderStatPlot();
      $('exportStats').disabled = false;
      $('exportStatsInput').disabled = false;
      $('statsStatus').textContent = '';
      function renderStatPlot() {
        const clusterRanges = clusterMode
          ? globalThis.MetricsSignificantMedia.rankIntervals(results.filter(cluster => cluster.pAdjusted <= resultMeta.alpha).map(cluster => {
            let peak = cluster.startIndex, magnitude = -1;
            for (let index = cluster.startIndex; index <= cluster.endIndex; index++) {
              const means = traces.map(trace => trace.y[index]);
              const difference = design === 'one' ? Math.abs(means[0] - nullValue) : Math.max(...means) - Math.min(...means);
              if (difference > magnitude) { peak = index; magnitude = difference; }
            }
            const pad = (testAlignment?.step || 0) / 2;
            return { ...cluster, peak: matrix.times[peak], magnitude, cluster: true,
              left: cluster.start - pad, right: cluster.end + pad,
              label: fmt(cluster.start) + '–' + fmt(cluster.end) + ' s · p cluster ' + fmt(cluster.pAdjusted),
              summary: describePreview(peak, cluster.pAdjusted, true)
            };
          }))
          : null;
        $('statsGroupPlot').replaceChildren();
        const plotTraces = independent ? [{
          name: 'Media ± IC 95%', color: colors[0], bold: true,
          x: categories.map((_, i) => i), y: computed.groups.map(group => group[0].mean),
          band: computed.groups.map(group => group[0].margin), n: summaryGroups.map(group => group.subjects.length)
        }] : traces;
        ctx.plot(plotTraces, {
          target: 'statsGroupPlot', significancePoints: categories ? [] : points,
          significanceRanges: clusterRanges, significanceStep: testAlignment?.step, pThresholds,
          title: 'Medie dei gruppi e intervalli di confidenza al 95%', categories, bars: !!categories,
          comparisons: independent ? posthoc.map(point => ({...point, groupIndexA: undefined, groupIndexB: undefined}))
            : within ? computed.paired : ['multi', 'mixed'].includes(design) ? posthoc : points.map((point, i) => ({
            ...point, epochA: labels[i], epochB: labels[i], single: true,
            label: labels[i] + ' contro ' + nullValue, correction: 'max-|T| sulle epoche'
          })),
          xLabel: categories ? 'Epoca / stimolo' : 'Tempo [s]'
        });
        displayResults();
        if (clusterMode) globalThis.MetricsSignificantMedia.showRanges(clusterRanges, resultMeta);
        else globalThis.MetricsSignificantMedia?.show(results, resultMeta, index => describePreview(index, points[index].pAdjusted));
      }

      function describePreview(index, pAdjusted, cluster = false) {
        const estimates = traces.map((trace, groupIndex) => {
          const difference = design === 'one' && nullValue !== 0;
          return {
            label: design === 'multi' ? summaryGroups[groupIndex].name + ' · Media'
              : difference ? 'ΔM vs ' + fmt(nullValue) : 'Media',
            mean: trace.y[index] - (difference ? nullValue : 0),
            halfWidth: trace.band[index]
          };
        });
        return { time: matrix.times[index], estimates, pAdjusted, cluster, omnibus: design === 'multi' };
      }
    }catch(e){if(ticket===version)$('statsStatus').textContent=e.message;}
    finally {
      job.end();
      if (activeAnalysis === controller) activeAnalysis = null;
      if (ticket === version) $('runStats').disabled = !context;
    }
  };
  function downloadCsv(filename, headers, rows) {
    const quote = value => {
      let string = value == null ? '' : String(value);
      if (typeof value === 'string' && /^[=+@\-\t\r]/.test(string)) string = "'" + string;
      return '"' + string.replaceAll('"', '""') + '"';
    };
    const csv = '\uFEFF' + [headers, ...rows].map(row => row.map(quote).join(',')).join('\r\n');
    const url = URL.createObjectURL(new Blob([csv], {type: 'text/csv;charset=utf-8'})), link = el('a');
    link.href = url;
    link.download = filename;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }

  $('exportStats').onclick = () => {
    if (!report) return;
    const metadata = resultMeta, run = report, output = results;
    return MetricsBusy.run('Preparazione del CSV delle analisi…', async () => {
      const clusterMode = metadata.correction === 'cluster-mass';
      const source = output.length ? output : [{ kind: 'cluster' }];
      const rows = source.map(row => {
        if (clusterMode) return {
          ...metadata, test: row.n ? inferentialSettings.cluster[0] : 'Nessun cluster',
          resampling: metadata.design === 'one' ? 'sign flips by subject' : 'group-label permutations',
          formation_alpha: .05, mass_function: metadata.design === 'one' ? 'sum(t^2)' : 'sum(F)',
          start_s: row.start, end_s: row.end, samples: row.samples,
          direction: row.n ? clusterDirection(row.direction) : '', df1: row.df1, df2: row.df2,
          cluster_mass: row.statistic, peak_time_s: run.times[row.peakIndex], peak_statistic: row.peakStatistic,
          p_cluster: row.pAdjusted, n: row.n ?? run.subjects.length
        };
        const { kind, index } = row;
        const indices = index === null ? run.labels.map((_, i) => i)
          .filter(i => !['paired', 'mixedPaired'].includes(kind) || [row.epochA, row.epochB].includes(run.labels[i])) : [index];
        const groups = kind === 'posthoc' ? [row.groupIndexA, row.groupIndexB]
          : kind === 'mixedPaired' ? [row.groupIndexA] : run.groupNames.map((_, i) => i);
        const descriptives = indices.flatMap(i => groups.map(group => {
          const { mean, sd, margin } = run.summaries[group][i];
          return { target: metadata.design === 'between' ? run.groupNames[group] : metadata.view === 'series' ? run.times[i] : run.labels[i],
            group: run.groupNames[group], n: run.groupSizes[group], mean, sd,
            ci_low: mean - margin, ci_high: mean + margin };
        }));
        return {
          ...metadata, resamples: row.resamples ?? metadata.resamples, target: row.label,
          time_s: metadata.view === 'series' ? run.times[index] : '',
          family: metadata.design === 'between' ? 'all independent stimulus pairs' : metadata.design === 'mixed' ? kind === 'mixed' ? 'three mixed-design omnibus effects' : 'all simple effects: paired and independent' : kind === 'posthoc' ? 'all group pairs × selected epochs'
            : kind === 'repeated' ? 'all selected epochs (single omnibus)' : metadata.family,
          test: row.test || inferentialSettings[kind][0], resampling: inferentialSettings[kind][1],
          epoch_a: row.epochA, epoch_b: row.epochB, mean_difference: row.meanDifference,
          std_error: row.se, contrast_ci_low: row.ciLow, contrast_ci_high: row.ciHigh,
          effect_measure: ['paired', 'mixedPaired'].includes(kind) ? 'Cohen dz' : kind === 'one' || kind === 'posthoc' ? 'Cohen d' : 'partial eta squared',
          effect_size: row.d ?? row.eta, ms_effect: row.msEffect, ms_error: row.msError, df1: row.df1, df2: row.df2,
          group_a: row.groupA, group_b: row.groupB, n_a: row.nA, n_b: row.nB,
          statistic: row.statistic, p_uncorrected: row.pUncorrected, p_adjusted: row.pAdjusted,
          correction: row.correction || metadata.correction, n: row.n, descriptives_json: JSON.stringify(descriptives)
        };
      });
      const headers = Object.keys(rows[0]);
      downloadCsv('metrics-' + metadata.view + '-permutation.csv', headers, rows.map(row => headers.map(key => row[key])));
    }).catch(error => { $('statsStatus').textContent = error.message; });
  };

  $('exportStatsInput').onclick = () => {
    if (!report) return;
    const run = report, metadata = resultMeta;
    return MetricsBusy.run('Preparazione dei dati del test…', async () => {
      const series = metadata.view === 'series';
      const headers = ['subject_index', 'subject_id', 'subject', 'group_index', 'group',
        'sample_index', series ? 'time_s' : 'epoch', 'break_before', 'value'];
      const rows = run.subjects.flatMap((subject, subjectIndex) => subject.values.map((value, index) => {
        const group = ['multi', 'mixed', 'between'].includes(metadata.design) ? subject.groupIndex : 0;
        return [subjectIndex + 1, subject.id, subject.subject, group + 1, run.groupNames[group],
          index + 1, series ? run.times[index] : subject.sourceEpoch ?? run.labels[index], run.breaks[index], value];
      }));
      downloadCsv('metrics-' + metadata.view + '-test-input.csv', headers, rows);
    }).catch(error => { $('statsStatus').textContent = error.message; });
  };
})();
