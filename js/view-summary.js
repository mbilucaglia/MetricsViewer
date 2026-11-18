(function(root){
  'use strict';
  const C=typeof module==='object'&&module.exports?require('./core'):root.MetricsCore;
  const A=typeof module==='object'&&module.exports?require('./analysis'):root.MetricsAnalysis;
  function cell(values){const finite=values.filter(C.finite);return {mean:C.mean(finite),ci:A.ci95(finite),n:finite.length};}
  function series(aligned,items,groups){
    return groups.map(group=>({...group,time:aligned.time,
      summary:aligned.time.map((_,i)=>cell(items.flatMap((item,j)=>group.members.includes(item.r.id)?[aligned.values[j][i]]:[])))}));
  }
  function summary(epochs,rows,records,groups){
    return groups.map(group=>{
      const names=new Set(records.filter(record=>group.members.includes(record.id)).map(record=>record.subject));
      return {...group,time:epochs,summary:epochs.map(epoch=>cell(rows.filter(row=>row.epoch===epoch&&names.has(row.subject)).map(row=>row.value)))};
    });
  }
  function csvRows(groups,axis){
    const names=new Map();
    const prefixes=groups.map(group=>{
      const count=(names.get(group.name)||0)+1;names.set(group.name,count);
      return group.id==='all'?'':group.name+(count>1?' ('+count+')':'')+' · ';
    });
    return (groups[0]?.time??[]).map((time,index)=>{
      const row={[axis]:time};
      groups.forEach((group,j)=>{const sample=group.summary[index],prefix=prefixes[j];
        row[prefix+'Media']=sample.mean;
        row[prefix+'IC 95% inferiore']=C.finite(sample.ci)?sample.mean-sample.ci:null;
        row[prefix+'IC 95% superiore']=C.finite(sample.ci)?sample.mean+sample.ci:null;
      });return row;
    });
  }
  function symbol(shape,x,y,r=11){
    if(shape==='square')return {tag:'rect',attrs:{x:x-r,y:y-r,width:2*r,height:2*r,rx:2}};
    const vertices=shape==='triangle'?[[0,-1.25],[1.15,1],[-1.15,1]]:
      shape==='diamond'?[[0,-1.3],[1.3,0],[0,1.3],[-1.3,0]]:
      shape==='hexagon'?[[-.55,-1],[.55,-1],[1.15,0],[.55,1],[-.55,1],[-1.15,0]]:null;
    return vertices?{tag:'polygon',attrs:{points:vertices.map(([a,b])=>(x+a*r)+','+(y+b*r)).join(' ')}}:
      {tag:'circle',attrs:{cx:x,cy:y,r}};
  }
  const api={cell,series,summary,csvRows,symbol};
  if(typeof module==='object'&&module.exports)module.exports=api;else root.MetricsViewSummary=api;
})(globalThis);
