import {icon} from './icons.js';
import {loadWidgetData} from './data.js';
import {initTheatreMotion} from './theatre-motion.js';
import {initBoxHinge} from './box-hinge.js';

const dialog=document.querySelector('#tool-dialog');
const content=document.querySelector('#tool-content');
let mounted=null, generation=0, lastTrigger=null, theatreMotion=null;
const cache=new Map();
const labels={recipe:'菜谱',movie:'电影',inspiration:'生活灵感',city:'四小时城市',reader:'阅读',tarot:'塔罗',directory:'全部工具'};
const SOURCE_ROOT='https://raw.githubusercontent.com/StellaWQL/recipes-widget/practice/';
const BOOK_CATALOG='https://api.github.com/repos/StellaWQL/recipes-widget/contents/data/books?ref=practice';
const stored=(key,fallback=null)=>{try{return JSON.parse(localStorage.getItem(key))??fallback;}catch{return fallback;}};
const save=(key,value)=>{try{localStorage.setItem(key,JSON.stringify(value));}catch{}};

function button(name,label,callback){
  const node=document.createElement('button');node.className='paper-control';node.type='button';node.setAttribute('aria-label',label);node.innerHTML=icon(name);node.addEventListener('click',callback);return node;
}
function safeURL(value){try{const u=new URL(value,location.href);return /^https?:$/.test(u.protocol)?u.href:null;}catch{return null;}}
function randomIndex(length,last=-1){if(length<2)return 0;let n;do{const a=new Uint32Array(1);crypto.getRandomValues(a);n=a[0]%length;}while(n===last);return n;}
function loader(){content.innerHTML='<div class="quiet-loader" role="status" aria-label="正在打开"></div>';}
function showError(retry){
  content.replaceChildren();const box=document.createElement('div');box.className='quiet-error';
  box.append(button('refresh','重试',retry));content.append(box);
}
async function jsonData(name){
  if(!cache.has(name))cache.set(name,loadWidgetData(name).catch(e=>{cache.delete(name);throw e;}));
  return cache.get(name);
}
function closeTool(){
  ++generation;mounted?.destroy?.();mounted=null;
  if(dialog.open)dialog.close();content.replaceChildren();
  history.replaceState(null,'',location.pathname+location.search);
  lastTrigger?.focus({preventScroll:true});
}
dialog.addEventListener('cancel',e=>{e.preventDefault();closeTool();});
dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();if(e.clientX<r.left||e.clientX>r.right||e.clientY<r.top||e.clientY>r.bottom)closeTool();}});
document.querySelector('#close-tool').addEventListener('click',closeTool);

function openReaderPage({replace=false}={}){
  const next=new URL('../reader-room/index.html',import.meta.url);
  const query=new URLSearchParams(location.search);
  for(const name of ['book','catalog']){
    if(!query.has(name))continue;
    const raw=query.get(name)||'';
    try{next.searchParams.set(name,raw?new URL(raw,location.href).href:'');}
    catch{next.searchParams.set(name,raw);}
  }
  if(replace)location.replace(next.href);
  else location.assign(next.href);
}

async function openTool(type,trigger=null){
  if(!labels[type])return;
  if(type==='reader'){openReaderPage();return;}
  theatreMotion?.reset();
  const run=++generation;mounted?.destroy?.();mounted=null;
  if(trigger)lastTrigger=trigger;
  dialog.dataset.tool=type;dialog.setAttribute('aria-label',labels[type]);loader();
  if(!dialog.open)dialog.showModal();
  history.replaceState(null,'',location.pathname+location.search+'#'+type);
  try{
    if(type==='tarot'){
      const {mountTarot}=await import('./tarot.js');if(run!==generation)return;
      content.replaceChildren();mounted=mountTarot(content,{onClose:closeTool});
    }else if(type==='reader'){
      const {mountReader}=await import('./reader.js');if(run!==generation)return;
      content.replaceChildren();mounted=mountReader(content,{onClose:closeTool,catalogUrl:BOOK_CATALOG,bookUrl:new URLSearchParams(location.search).get('book')||undefined});
    }else if(type==='recipe'||type==='movie'){
      const rows=await jsonData(type==='recipe'?'recipes':'movies');if(run!==generation)return;
      mountSelection(type,rows);
    }else if(type==='inspiration')mountInspiration();
    else if(type==='city'){
      const {mountCity}=await import('./city.js?v=6');if(run!==generation)return;
      content.replaceChildren();mounted=await mountCity(content);
    }else mountDirectory();
  }catch(e){console.error(e);if(run===generation)showError(()=>openTool(type));}
}

function mountSelection(type,rows){
  content.replaceChildren();
  const key='raven.paper.'+type;let selected=stored(key,-1);
  if(!Number.isInteger(selected)||selected<0||selected>=rows.length)selected=randomIndex(rows.length);
  const sheet=document.createElement('section');sheet.className='content-sheet '+(type==='movie'?'movie-sheet':'');
  const link=document.createElement('a');link.className='content-picture '+(type==='movie'?'poster-picture':'');link.target='_blank';link.rel='noopener noreferrer';link.setAttribute('aria-label',type==='movie'?'打开电影页面':'打开菜谱');
  const img=document.createElement('img');img.alt='';img.referrerPolicy='no-referrer';img.addEventListener('error',()=>link.classList.add('broken'));img.addEventListener('load',()=>link.classList.remove('broken'));link.append(img);
  const copy=document.createElement('div');copy.className='content-copy';
  const title=document.createElement('h1');const meta=document.createElement('div');meta.className='content-meta';
  const actions=document.createElement('div');actions.className='content-actions';
  const redraw=button('refresh',type==='movie'?'换一部电影':'换一道菜谱',()=>{selected=randomIndex(rows.length,selected);render();});
  const external=document.createElement('a');external.className='paper-control';external.target='_blank';external.rel='noopener noreferrer';external.setAttribute('aria-label',type==='movie'?'打开电影页面':'打开菜谱');external.innerHTML=icon('external');
  actions.append(redraw,external);copy.append(title,meta,actions);sheet.append(link,copy);content.append(sheet);
  function render(){
    const item=rows[selected];save(key,selected);title.textContent=item.title||'';
    const imageURL=safeURL(type==='movie'?item.poster_url:item.image_url);const url=safeURL(type==='movie'?item.url:item.recipe_url);
    link.classList.remove('broken');img.removeAttribute('src');if(imageURL)img.src=imageURL;else link.classList.add('broken');
    if(url){link.href=url;external.href=url;}else{link.removeAttribute('href');external.removeAttribute('href');}
    meta.textContent=type==='movie'?[item.release_date,item.metascore?`${item.metascore} / 100`:''].filter(Boolean).join(' · '):(/\d/.test(item.time||'')?item.time:'');
  }
  render();
}

function mountInspiration(){
  const deck=[{title:'今日惊喜',desc:'试一道从未做过的菜'},{title:'健康打卡',desc:'今晚 20 分钟快步走'},{title:'电影之夜',desc:'看一部 2010 年前的电影'},{title:'整理时间',desc:'清理冰箱和补货清单'},{title:'放松一下',desc:'泡个脚，听一张唱片'}];
  const key='raven.paper.inspiration';let last=stored(key,-1);
  content.replaceChildren();const sheet=document.createElement('section');sheet.className='inspiration-sheet';
  const card=document.createElement('article');card.className='inspiration-card';const h=document.createElement('h1'),p=document.createElement('p');card.append(h,p);
  function draw(){last=randomIndex(deck.length,last);save(key,last);h.textContent=deck[last].title;p.textContent=deck[last].desc;}
  sheet.append(card,button('refresh','抽取生活灵感',draw));content.append(sheet);
  if(Number.isInteger(last)&&deck[last]){h.textContent=deck[last].title;p.textContent=deck[last].desc;}else draw();
}

function mountDirectory(){
  content.replaceChildren();const sheet=document.createElement('section');sheet.className='directory-sheet';const tools=document.createElement('div');tools.className='directory-tools';
  for(const type of ['recipe','movie','inspiration','city','reader','tarot']){
    const b=document.createElement('button');b.type='button';b.className='directory-button';b.setAttribute('aria-label',labels[type]);b.innerHTML=icon(type==='reader'?'book':type);b.addEventListener('click',()=>openTool(type));tools.append(b);
  }
  sheet.append(tools);content.append(sheet);
}

document.querySelectorAll('[data-tool]').forEach(b=>b.addEventListener('click',()=>openTool(b.dataset.tool,b)));
const stage=document.querySelector('.stage-frame');
theatreMotion=initTheatreMotion(stage,{onActivate:openTool});
initBoxHinge(stage);
// Reveal the layered scene only after every painted component has decoded.
Promise.all(['paper-theatre-original-muted.png','paper-theatre-local-clean-v10.png','paper-theatre-micro-clean-v10.png','paper-props-scene-v8.png','paper-theatre-box-open.png','paper-theatre-box-closed.png','paper-props.png','tarot-back.png','paper-theatre-bird-flowers-v11.png','paper-flower-left-v11.png','paper-theatre-local-repairs-v12.png','paper-theatre-architecture-v13.png', 'paper-theatre-local-repairs-v14.png', 'paper-theatre-stair-trim-v15.png', 'paper-pear-v14.png','city-light-second-painted.png','curtain-pair.png'].map(name=>{
  const image=new Image();image.src=new URL('../assets/art/'+name,import.meta.url).href;
  return image.decode();
})).then(()=>stage.classList.add('is-art-ready')).catch(()=>{});
const initial=location.hash.slice(1);
if(new URLSearchParams(location.search).has('book')||initial==='reader')openReaderPage({replace:true});
else if(labels[initial])openTool(initial);

export {openTool,closeTool,SOURCE_ROOT};
