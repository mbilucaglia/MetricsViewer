(function(root){
  'use strict';
  function create(){
    let target=null;
    return {
      toggleSubject(id){target=target?.type==='subject'&&target.id===id?null:{type:'subject',id};},
      toggleOutliers(){target=target?.type==='outliers'?null:{type:'outliers'};},
      reset(){target=null;},
      get target(){return target;},
      resolve(records,flags){
        if(!target)return null;
        const ids=records.filter(r=>target.type==='subject'?r.id===target.id:flags.get(r.id)?.status==='flagged').map(r=>r.id);
        if(!ids.length){target=null;return null;}
        return ids;
      }
    };
  }
  const api={create};if(typeof module!=='undefined')module.exports=api;else root.MetricsIsolation=api;
})(globalThis);
