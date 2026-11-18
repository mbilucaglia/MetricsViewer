(function(root) {
  'use strict';
  function wrap(text,width,measure = value => value.length * 6.5) {
    const lines = [];
    for (const word of text.split(/\s+/).filter(Boolean)) {
      if (measure(word) > width) {
        let part='';
        for (const char of word) {
          if (part && measure(part+char)>width) { lines.push(part);part=''; }
          part+=char;
        }
        if(part)lines.push(part);
      } else if (!lines.length || measure(lines.at(-1) + ' ' + word) > width) lines.push(word);
      else lines[lines.length-1] += ' ' + word;
    }
    return lines.length ? lines : [''];
  }
  function compose(width,chartHeight,previews,{measure}={}) {
    const header = 38, gap = 14, margin = Math.min(22,width*.06);
    const count = previews.length;
    const columns = Math.min(count,Math.max(1,Math.floor((width-2*margin+gap)/234)));
    const cardWidth = count ? Math.min(300,(width-2*margin-(columns-1)*gap)/columns) : 0;
    const left = (width - columns*cardWidth - Math.max(0,columns-1)*gap)/2;
    const imageHeight = Math.min(165,cardWidth*9/16);
    const sorted = previews.slice().sort((a,b)=>a.time-b.time||a.index-b.index);
    const rows = [];
    const cards = sorted.map((preview,index)=>{
      const row = Math.floor(index/columns);
      const lines = wrap(preview.caption,cardWidth-44,measure);
      const captionHeight = Math.max(38,lines.length*17+12);
      rows[row] = Math.max(rows[row]??0,captionHeight+imageHeight+10);
      return {...preview,row,column:index%columns,lines,captionHeight,width:cardWidth};
    });
    let y = header+chartHeight+62;
    rows.forEach((height,row)=>{
      for(const card of cards.filter(card=>card.row===row)) {
        card.x = left+card.column*(cardWidth+gap);card.y=y;card.height=height;
        card.image={x:card.x+6,y:y+card.captionHeight,width:cardWidth-12,height:height-card.captionHeight-6};
        const from={x:card.source.x,y:card.source.y+header+card.source.radius};
        const to={x:card.x+cardWidth/2,y};
        card.connector = row === 0 && columns>1 ? [from,to] : [
          from,{x:from.x,y:header+chartHeight+19+card.column*7},
          {x:margin/2+card.column*4,y:header+chartHeight+19+card.column*7},
          {x:margin/2+card.column*4,y:y+20},{x:card.x,y:y+20}];
      }
      y += height+22;
    });
    return {width,height:count?y:header+chartHeight,header,chart:{x:0,y:header,width,height:chartHeight},cards};
  }
  const api={wrap,compose};
  if(typeof module==='object'&&module.exports)module.exports=api;
  else root.MetricsExportLayout=api;
})(globalThis);
