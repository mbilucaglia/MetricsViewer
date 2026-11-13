(function(){
  'use strict';
  const dialog=document.getElementById('busyDialog'),message=document.getElementById('busyMessage'),progress=document.getElementById('busyProgress'),detail=document.getElementById('busyDetail'),cancel=document.getElementById('busyCancel');
  const jobs=new Map();let nextId=0,previousFocus=null;
  function paint(){return new Promise(resolve=>{const timer=setTimeout(resolve,100);requestAnimationFrame(()=>requestAnimationFrame(()=>{clearTimeout(timer);resolve();}));});}
  function refresh(){
    const active=[...jobs.values()].at(-1);
    if(!active){if(dialog.open)dialog.close();document.querySelector('main').removeAttribute('aria-busy');if(previousFocus?.isConnected)previousFocus.focus({preventScroll:true});previousFocus=null;return;}
    message.textContent=active.message;
    if(Number.isFinite(active.value)&&active.max>0){progress.max=active.max;progress.value=active.value;detail.textContent=`${active.value.toLocaleString('it-IT')} / ${active.max.toLocaleString('it-IT')}`;}else{progress.removeAttribute('value');detail.textContent='Attendi il completamento dell’operazione.';}
    cancel.hidden=!active.onCancel;cancel.disabled=active.cancelled;
    document.querySelector('main').setAttribute('aria-busy','true');
    if(!dialog.open){previousFocus=document.activeElement;dialog.showModal();}
  }
  function cancelActive(){const active=[...jobs.values()].at(-1);if(active?.onCancel&&!active.cancelled){active.cancelled=true;active.message='Annullamento dell’analisi in corso…';active.onCancel();refresh();}}
  cancel.onclick=cancelActive;dialog.addEventListener('cancel',event=>{event.preventDefault();cancelActive();});
  function start(text,{onCancel=null}={}){
    const id=++nextId,job={message:text,onCancel,cancelled:false};jobs.set(id,job);refresh();
    return {
      update(text,{value=null,max=null}={}){if(!jobs.has(id)||job.cancelled)return;Object.assign(job,{message:text,value,max});refresh();},
      async step(text,counts){this.update(text,counts);await paint();},
      end(){if(jobs.delete(id))refresh();}
    };
  }
  async function run(text,work,options){const job=start(text,options);try{await job.step(text);return await work(job);}finally{job.end();}}
  window.MetricsBusy={start,run};
})();
