
export function parseCSV(text, {header=true, skipEmptyLines=true}={}){
  const rows=[]; let cur=''; let row=[]; let q=false; let i=0;
  const pushCell=()=>{ row.push(cur); cur=''; };
  const pushRow =()=>{ rows.push(row); row=[]; };
  while(i<text.length){
    const ch=text[i];
    if(q){
      if(ch==='"'){ if(text[i+1]==='"'){ cur+='"'; i+=2; continue; } q=false; i++; }
      else { cur+=ch; i++; }
    }else{
      if(ch==='"'){ q=true; i++; }
      else if(ch===','){ pushCell(); i++; }
      else if(ch==='\n'){ pushCell(); pushRow(); i++; }
      else if(ch==='\r'){ if(text[i+1]==='\n') i++; pushCell(); pushRow(); i++; }
      else { cur+=ch; i++; }
    }
  }
  pushCell(); pushRow();
  if(rows.length && rows[rows.length-1].length===1 && rows[rows.length-1][0]==='') rows.pop();
  if(header){
    const head=rows.shift().map(h=>h.trim());
    const out=rows.map(r=>{const o={}; head.forEach((h,idx)=>o[h]=(r[idx]??'').trim()); return o;});
    return skipEmptyLines?out.filter(o=>Object.values(o).some(v=>v!=='')):out;
  }
  return skipEmptyLines?rows.filter(r=>r.some(v=>v!=='')):rows;
}
export const validUrl = (u)=>{ try{ new URL(u); return true; }catch{ return false; } };
export const qs = (k, fb=null)=>{ const v=new URLSearchParams(location.search).get(k); return v?decodeURIComponent(v):fb; };
export const sleep = (ms)=> new Promise(r=>setTimeout(r,ms));
