(function(root){
  'use strict';
  const $=id=>document.getElementById(id);
  let records=[],draft=null;
  const node=(tag,text)=>{const e=document.createElement(tag);if(text!==undefined)e.textContent=text;if(tag==='button')e.type='button';return e;};
  function visible(){
    const terms=$('viewerGroupSearch').value.toLowerCase().split(',').map(s=>s.trim()).filter(Boolean);
    return records.filter(record=>!terms.length||terms.some(term=>{
      const match=/^(\d+)\s*[-–]\s*(\d+)$/.exec(term),name=(record.subject+' '+record.id).toLowerCase();
      if(!match)return name.includes(term);
      const min=Math.min(Number(match[1]),Number(match[2])),max=Math.max(Number(match[1]),Number(match[2]));
      return (name.match(/\d+/g)||[]).some(d=>Number(d)>=min&&Number(d)<=max);
    }));
  }
  function paintSubjects(){
    const assignments=new Map(draft.assignments),filtered=visible();
    $('viewerQuickGroups').replaceChildren(...draft.groups.map(group=>{
      const button=node('button','Assegna a '+group.name);button.disabled=!filtered.length;
      button.onclick=()=>{for(const record of filtered)assignments.set(record.id,group.id);draft.assignments=[...assignments];paintSubjects();};return button;
    }));
    $('viewerGroupSubjects').replaceChildren(...filtered.map(record=>{
      const row=node('label');row.className='viewer-group-subject';row.append(node('span',record.subject));
      const select=node('select');select.setAttribute('aria-label','Gruppo di '+record.subject);
      select.append(...draft.groups.map(group=>{const option=node('option',group.name);option.value=group.id;return option;}));
      select.value=assignments.get(record.id)||draft.groups[0].id;
      select.onchange=()=>{assignments.set(record.id,select.value);draft.assignments=[...assignments];};
      row.append(select);return row;
    }));
  }
  function paintNames(){
    $('viewerGroupNames').replaceChildren(...draft.groups.map(group=>{
      const label=node('label');label.className='viewer-group-name';
      const input=node('input');input.value=group.name;input.setAttribute('aria-label','Nome del gruppo '+group.name);
      input.onchange=()=>{group.name=input.value.trim();paintSubjects();};label.append(input);
      if(draft.groups.length>2){const remove=node('button','×');remove.setAttribute('aria-label','Rimuovi '+group.name);remove.onclick=()=>{draft.groups=draft.groups.filter(g=>g.id!==group.id);draft.assignments=draft.assignments.filter(([,id])=>id!==group.id);paintNames();paintSubjects();};label.append(remove);}return label;
    }));
  }
  connectMetricsSettings({
    trigger:$('openViewerGroups'),dialog:$('viewerGroupsDialog'),
    begin:()=>{draft=root.MetricsGroups.snapshot();$('viewerGroupSearch').value='';$('viewerGroupError').textContent='';paintNames();paintSubjects();},
    accept:()=>{try{root.MetricsGroups.apply(draft);$('groupAverages').checked=true;return true;}catch(error){$('viewerGroupError').textContent=error.message;return false;}},
    discard:()=>{draft=null;},
    applied:()=>{draft=null;document.dispatchEvent(new Event('metrics-view-groups-applied'));}
  });
  $('viewerGroupSearch').oninput=paintSubjects;
  $('viewerAddGroup').onclick=()=>{const id='g'+draft.nextGroup++;draft.groups.push({id,name:'Gruppo '+(draft.nextGroup-1)});paintNames();paintSubjects();};
  document.addEventListener('metrics-invalidated',event=>{if(event.detail?.dataset)records=event.detail.dataset.recordings;});
  document.addEventListener('metrics-ready',event=>{records=event.detail.dataset.recordings;});
  const menu=node('div');menu.id='subjectGroupMenu';menu.className='subject-group-menu';
  menu.setAttribute('popover','auto');menu.setAttribute('role','dialog');menu.setAttribute('aria-labelledby','subjectGroupMenuTitle');
  const header=node('header'),title=node('h3');title.id='subjectGroupMenuTitle';
  const dismiss=node('button','×');dismiss.setAttribute('aria-label','Chiudi menu gruppo');
  header.append(title,dismiss);
  const choices=node('div');choices.setAttribute('role','menu');choices.setAttribute('aria-label','Seleziona gruppo');
  const error=node('p');error.className='danger';error.setAttribute('role','alert');
  const manage=node('button','Gestisci gruppi…');manage.className='subject-group-menu__manage';
  menu.append(header,choices,error,manage);document.body.append(menu);
  let target=null;
  const isOpen=()=>menu.matches(':popover-open');
  function restoreFocus(id){
    const badge=[...document.querySelectorAll('[data-edit-subject-group]')].find(button=>button.dataset.editSubjectGroup===id);
    if(badge?.getClientRects().length)badge.focus({preventScroll:true});else $('subjectSearch').focus({preventScroll:true});
  }
  function closeMenu(focus=false){
    const id=target?.id,anchor=target?.anchor;target=null;anchor?.setAttribute('aria-expanded','false');
    if(isOpen())menu.hidePopover();
    if(focus&&id)restoreFocus(id);
  }
  function position(){
    if(!target)return;
    const bounds=target.anchor.getBoundingClientRect(),margin=8;
    if(!target.anchor.isConnected||bounds.bottom<0||bounds.top>innerHeight){closeMenu();return;}
    menu.style.left=Math.max(margin,Math.min(bounds.left,innerWidth-menu.offsetWidth-margin))+'px';
    menu.style.top=Math.max(margin,Math.min(bounds.bottom+5,innerHeight-menu.offsetHeight-margin))+'px';
  }
  function openMenu(anchor){
    if(target?.anchor===anchor&&isOpen()){closeMenu(true);return;}
    closeMenu();
    const id=anchor.dataset.editSubjectGroup,record=records.find(item=>item.id===id);if(!record)return;
    const state=root.MetricsGroups.snapshot(),current=new Map(state.assignments).get(id)||state.groups[0].id;
    title.textContent='Gruppo di '+record.subject;error.textContent='';
    choices.replaceChildren(...state.groups.map(group=>{
      const button=node('button',(group.id===current?'✓ ':'')+group.name);
      button.dataset.groupValue=group.id;button.setAttribute('role','menuitemradio');button.setAttribute('aria-checked',String(group.id===current));
      button.onclick=()=>{
        if(group.id===current){closeMenu(true);return;}
        const latest=root.MetricsGroups.snapshot(),assignments=new Map(latest.assignments);
        assignments.set(id,group.id);latest.assignments=[...assignments];
        try{root.MetricsGroups.apply(latest);closeMenu();restoreFocus(id);}catch(e){error.textContent=e.message;}
      };
      return button;
    }));
    target={id,anchor};anchor.setAttribute('aria-expanded','true');menu.showPopover();position();
    choices.querySelector('[aria-checked="true"]')?.focus({preventScroll:true});
  }
  dismiss.onclick=()=>closeMenu(true);
  manage.onclick=()=>{closeMenu();$('openViewerGroups').click();};
  document.addEventListener('click',event=>{
    const anchor=event.target.closest?.('[data-edit-subject-group]');
    if(anchor){event.preventDefault();event.stopPropagation();openMenu(anchor);}
  });
  menu.addEventListener('toggle',event=>{if(event.newState==='closed'&&!isOpen()){target?.anchor.setAttribute('aria-expanded','false');target=null;}});
  menu.addEventListener('keydown',event=>{
    if(event.key==='Escape'){event.preventDefault();closeMenu(true);return;}
    if(!['ArrowUp','ArrowDown','Home','End'].includes(event.key))return;
    event.preventDefault();const buttons=[...choices.children],index=buttons.indexOf(document.activeElement);
    const next=event.key==='Home'?0:event.key==='End'?buttons.length-1:(index+(event.key==='ArrowDown'?1:buttons.length-1))%buttons.length;
    buttons[next]?.focus();
  });
  document.addEventListener('metrics-invalidated',()=>closeMenu());
  document.addEventListener('scroll',event=>{if(target&&!menu.contains(event.target))position();},true);
  window.addEventListener('resize',()=>{if(isOpen())position();});
})(window);
