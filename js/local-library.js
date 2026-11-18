(function(root) {
  'use strict';
  const pending=new Map();
  function load(name,fallback) {
    if(root[name])return Promise.resolve(root[name]);
    if(pending.has(name))return pending.get(name);
    const promise=new Promise((resolve,reject)=>{
      const declaration=[...document.querySelectorAll('script[data-metrics-library]')].find(node=>node.dataset.metricsLibrary===name);
      const element=document.createElement('script');
      const complete=()=>root[name]?resolve(root[name]):reject(new Error('Libreria locale non disponibile: '+name));
      if(declaration?.textContent.trim()) {
        element.textContent=declaration.textContent;
        document.head.append(element);
        complete();
      } else {
        element.src=declaration?.src||fallback;
        element.onload=complete;
        element.onerror=()=>{element.remove();reject(new Error('Impossibile caricare la libreria locale: '+name));};
        document.head.append(element);
      }
    }).catch(error=>{pending.delete(name);throw error;});
    pending.set(name,promise);
    return promise;
  }
  root.MetricsLocalLibrary={load};
})(window);
