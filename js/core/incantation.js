
export function makeIncantation(container, {parts, author}){
  const wrap = document.createElement('div'); wrap.className='incant-wrap';
  const top = document.createElement('div'); top.className='divider';
  const bottom = document.createElement('div'); bottom.className='divider bottom';
  const line = document.createElement('div'); line.className='spell';

  parts.forEach((p,i)=>{
    const span=document.createElement('span'); span.textContent=p.text;
    if(p.hot){ span.className='hot'; if(typeof p.onClick==='function'){ span.addEventListener('click',e=>{ e.stopPropagation(); p.onClick(); }); } }
    line.appendChild(span); if(i!==parts.length-1) line.append(' ');
  });

  if(author){ const au=document.createElement('span'); au.className='author'; au.textContent=`— ${author}`; line.appendChild(au); }

  wrap.appendChild(top); wrap.appendChild(line); wrap.appendChild(bottom);
  container.appendChild(wrap);
  return wrap;
}
