(function(){
  'use strict';
  for(const [id,searchId,title]of [['epoch','epochSearch','Seleziona epoca'],['baseline','baselineSearch','Seleziona baseline']]){
    const select=document.getElementById(id),search=document.getElementById(searchId),label=document.querySelector(`label[for="${id}"]`);
    const wrapper=document.createElement('div');wrapper.className='searchable-select';select.parentNode.insertBefore(wrapper,select);
    const button=document.createElement('button');button.type='button';button.id=id+'Picker';button.className='searchable-select-trigger';button.setAttribute('aria-haspopup','dialog');button.setAttribute('aria-expanded','false');button.setAttribute('aria-controls',id+'Popup');
    if(label){label.htmlFor=button.id;button.setAttribute('aria-labelledby',label.id||(label.id=id+'Label'));}
    const popup=document.createElement('div');popup.className='searchable-select-popup';popup.id=id+'Popup';popup.hidden=true;popup.setAttribute('role','dialog');popup.setAttribute('aria-label',title);
    const list=document.createElement('div');list.id=id+'List';list.className='searchable-select-list';list.setAttribute('role','listbox');list.setAttribute('aria-label',title);
    const empty=document.createElement('p');empty.className='panel-note';empty.textContent='Nessuna epoca trovata.';
    search.setAttribute('role','combobox');search.setAttribute('aria-autocomplete','list');search.setAttribute('aria-controls',list.id);search.setAttribute('aria-expanded','false');search.autocomplete='off';
    popup.append(search,list,empty);wrapper.append(button,popup,select);select.hidden=true;select.tabIndex=-1;
    let choices=[],active=-1;
    function setActive(index){active=index;for(const [i,option]of choices.entries())option.classList.toggle('is-keyboard-active',i===index);if(index>=0){search.setAttribute('aria-activedescendant',choices[index].id);choices[index].scrollIntoView({block:'nearest'});}else search.removeAttribute('aria-activedescendant');}
    function close(focus=false){popup.hidden=true;button.setAttribute('aria-expanded','false');search.setAttribute('aria-expanded','false');search.removeAttribute('aria-activedescendant');if(focus)button.focus();}
    function choose(value){select.value=value;close(true);select.dispatchEvent(new Event('change',{bubbles:true}));sync();}
    function renderList(){
      const query=search.value.toLocaleLowerCase();list.replaceChildren();choices=[];
      for(const [index,option]of Array.from(select.options).entries()){
        if(!option.textContent.toLocaleLowerCase().includes(query))continue;
        const item=document.createElement('div');item.id=id+'Option'+index;item.className='searchable-select-option';item.setAttribute('role','option');item.setAttribute('aria-selected',String(option.selected));item.textContent=option.textContent;item.addEventListener('mousedown',event=>event.preventDefault());item.onclick=()=>choose(option.value);list.append(item);choices.push(item);
      }
      empty.hidden=choices.length>0;setActive(-1);
    }
    function sync(){button.disabled=select.disabled;button.textContent=(select.selectedOptions[0]?.textContent||'Seleziona…')+' ▾';if(select.disabled)close();if(!popup.hidden)renderList();}
    button.onclick=()=>{
      if(!popup.hidden){close();return;}
      document.dispatchEvent(new CustomEvent('metrics-picker-open',{detail:{id}}));popup.hidden=false;button.setAttribute('aria-expanded','true');search.setAttribute('aria-expanded','true');search.value='';search.dispatchEvent(new Event('input',{bubbles:true}));renderList();search.focus();
    };
    search.addEventListener('input',renderList);
    search.addEventListener('keydown',event=>{
      if(event.key==='ArrowDown'||event.key==='ArrowUp'){event.preventDefault();if(choices.length)setActive(event.key==='ArrowDown'?(active+1)%choices.length:(active<=0?choices.length-1:active-1));}
      else if(event.key==='Enter'){event.preventDefault();if(active>=0)choices[active].click();else if(choices.length===1)choices[0].click();}
      else if(event.key==='Escape'){event.preventDefault();close(true);}
    });
    popup.addEventListener('keydown',event=>{if(event.key==='Escape'){event.preventDefault();close(true);}});
    wrapper.addEventListener('focusout',event=>{if(!wrapper.contains(event.relatedTarget))close();});
    document.addEventListener('pointerdown',event=>{if(!wrapper.contains(event.target))close();});
    document.addEventListener('metrics-picker-open',event=>{if(event.detail.id!==id)close();});
    select.addEventListener('change',sync);new MutationObserver(sync).observe(select,{childList:true,subtree:true,attributes:true,attributeFilter:['disabled','selected']});sync();
  }
})();
