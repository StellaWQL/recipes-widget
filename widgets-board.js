
class VintageWidgetsBoard extends HTMLElement {
  static get observedAttributes(){ return ["recipes-csv","movies-csv","save-key"]; }
  constructor(){
    super();
    this.attachShadow({mode:"open"});
    this._state = { widgets: {}, saveKey: this.getAttribute("save-key") || "widgets.layout.v1" };
    this.shadowRoot.innerHTML = `
      <style>
        :host{display:block;position:relative;min-height:400px}
        :root{ --bg:#1b1512; --bg-grad1:#201914; --panel:#2a211d; --panel-2:#231b17;
               --text:#f3eee7; --muted:#c6bfb3; --stroke:#3b2f28; --accent:#c6a969;
               --accent2:#8b5e34; --danger:#8b1e3f; --shadow:0 18px 40px rgba(0,0,0,.45);
               --shadow-sm:0 10px 28px rgba(0,0,0,.38); }
        .root{
          position:relative;
          background:
            radial-gradient(1200px 800px at 20% -10%,rgba(255,232,196,.06),#0000),
            linear-gradient(120deg,var(--bg),var(--bg-grad1));
          color:var(--text);
          font-family:"Iowan Old Style","Palatino Linotype","Book Antiqua",Georgia,
                       "Noto Serif","Noto Serif SC","Noto Serif TC",
                       "Source Han Serif SC","Source Han Serif TC",serif;
          letter-spacing:.2px;border-radius:14px;overflow:hidden;
        }
        .topbar{position:absolute;inset:12px 12px auto 12px;background:linear-gradient(180deg,var(--panel),var(--panel-2));
          border:1px solid var(--stroke);border-radius:14px;display:flex;align-items:center;gap:10px;
          padding:8px 10px;z-index:10000;box-shadow:var(--shadow-sm)}
        .btn{appearance:none;border:0;border-radius:12px;padding:8px 12px;cursor:pointer;font-weight:700;color:#1b1512;
          background:linear-gradient(180deg,var(--accent),#b49254);box-shadow:0 8px 20px rgba(198,169,105,.25)}
        .btn.secondary{background:linear-gradient(180deg,#3a3029,#2c241f);color:var(--text);border:1px solid var(--stroke);box-shadow:none}
        .btn.danger{background:linear-gradient(180deg,#a0274d,var(--danger));color:#fff}
        .hint{color:var(--muted);font-size:12px;margin-left:6px}
        .board{position:relative;min-height:520px;padding:64px 16px 16px 16px}
        .widget{position:absolute;top:100px;left:100px;width:360px;min-width:260px;max-width:560px;
          background:linear-gradient(180deg,var(--panel),#1f1916);border:1px solid var(--stroke);border-radius:16px;
          box-shadow:var(--shadow);overflow:hidden;resize:both}
        .w-header{position:relative;cursor:grab;user-select:none;background:linear-gradient(180deg,#2c241f,#221b17);
          padding:10px 12px;border-bottom:1px solid var(--stroke);display:flex;align-items:center}
        .w-title{position:absolute;left:52px;right:52px;text-align:center;font-size:15px;font-weight:800;letter-spacing:.3px}
        .w-controls{margin-left:auto;display:flex;gap:6px}
        .iconbtn{background:#322821;border:1px solid var(--stroke);color:#f7f2ea;border-radius:9px;padding:6px 8px;cursor:pointer}
        .w-body{padding:12px;display:grid;gap:10px}
        .w-footer{padding:10px 12px;border-top:1px solid var(--stroke);color:var(--muted);font-size:12px}
        .figure{position:relative;display:block;width:100%;border-radius:12px;border:1px solid var(--stroke);overflow:hidden;
          background:repeating-linear-gradient(45deg, rgba(255,245,230,.03) 0 6px, rgba(0,0,0,.02) 6px 12px), #15100e}
        .figure.poster{aspect-ratio:2/3}.figure.square{aspect-ratio:1/1}
        .figure>img{position:absolute;inset:0;width:100%;height:100%;object-fit:contain;display:block}
        .row{display:flex;gap:8px;align-items:center;flex-wrap:wrap}
        .badge{padding:4px 8px;border:1px solid var(--stroke);border-radius:999px;color:var(--muted);font-size:12px;background:#221b17}
        .hidden{display:none}
      </style>
      <div class="root">
        <div class="topbar">
          <button class="btn" id="addRecipe">＋ Recipe widget</button>
          <button class="btn" id="addMovie">＋ Movie widget</button>
          <button class="btn" id="addDrawer">＋ Card Drawer</button>
          <button class="btn secondary" id="saveLayout">💾 Save</button>
          <button class="btn secondary" id="loadLayout">📂 Load</button>
          <button class="btn danger" id="resetLayout">🗑 Reset</button>
          <span class="hint">拖拽标题栏移动；双击置顶；自动保存。</span>
        </div>
        <div class="board" id="board"></div>
      </div>
    `;
  }
  connectedCallback(){
    const $ = (sel)=>this.shadowRoot.querySelector(sel);
    this.board = $("#board");
    this.zTop = 10;
    this._storageKey = this.getAttribute("save-key") || "widgets.layout.v1";
    this._recipesCSV = this.getAttribute("recipes-csv") || "data/atk_recipes_all.csv";
    this._moviesCSVcandidates = (this.getAttribute("movies-csv") || "data/movies.csv,movies.csv")
      .split(",").map(s=>s.trim()).filter(Boolean);

    $("#addRecipe").addEventListener("click", ()=> this.addRecipe());
    $("#addMovie").addEventListener("click",  ()=> this.addMovie());
    $("#addDrawer").addEventListener("click", ()=> this.addDrawer());
    $("#saveLayout").addEventListener("click", ()=> this.save());
    $("#loadLayout").addEventListener("click", ()=> this.load());
    $("#resetLayout").addEventListener("click",()=> this.reset());

    this.load().then(ok=>{
      if(!ok){
        this.addRecipe({x:120,y:140});
        this.addMovie({x:520,y:120});
        this.addDrawer({x:820,y:160});
        this.save();
      }
    });
  }
  attributeChangedCallback(name, _oldVal, newVal){
    if(name==="save-key"){ this._storageKey = newVal || "widgets.layout.v1"; }
    if(name==="recipes-csv"){ this._recipesCSV = newVal || "data/atk_recipes_all.csv"; }
    if(name==="movies-csv"){ this._moviesCSVcandidates = (newVal||"data/movies.csv,movies.csv").split(",").map(s=>s.trim()).filter(Boolean); }
  }

  // Public API
  addRecipe(pos){ return this._createRecipeWidget(pos); }
  addMovie(pos){  return this._createMovieWidget(pos); }
  addDrawer(pos){ return this._createDrawerWidget(pos); }
  async save(){ localStorage.setItem(this._storageKey, JSON.stringify(this._serialize())); return true; }
  async load(){
    const raw = localStorage.getItem(this._storageKey);
    if(!raw) return false;
    this.board.querySelectorAll(".widget").forEach(n=>n.remove());
    const arr = JSON.parse(raw);
    for(const w of arr){
      let inst=null;
      if(w.type==="recipe") inst = this._createRecipeWidget(w);
      else if(w.type==="movie") inst = this._createMovieWidget(w);
      else if(w.type==="drawer") inst = this._createDrawerWidget(w);
      if(inst && w.minimized) inst.querySelector(".w-body")?.classList.add("hidden");
    }
    return true;
  }
  async reset(){ localStorage.removeItem(this._storageKey); this.board.querySelectorAll(".widget").forEach(n=>n.remove()); }

  // Internals
  _uid(){ return "w_"+Math.random().toString(36).slice(2,9); }
  _bump(el){ this.zTop+=1; el.style.zIndex=this.zTop; }
  _serialize(){
    const data=[];
    this.board.querySelectorAll(".widget").forEach(el=>{
      const minimized = el.querySelector(".w-body")?.classList.contains("hidden");
      data.push({ type: el.dataset.type, x: el.offsetLeft, y: el.offsetTop, w: el.offsetWidth, h: el.offsetHeight, minimized });
    });
    return data;
  }
  _makeShell({type,title,x=120,y=120,w=360,h=null}){
    const root = document.createElement("div");
    root.className = "widget"; root.dataset.type = type; root.style.left = x+"px"; root.style.top = y+"px";
    if(w) root.style.width = w+"px"; if(h) root.style.height = h+"px"; this._bump(root);
    root.innerHTML = `
      <div class="w-header" data-drag>
        <div class="w-title">${title}</div>
        <div class="w-controls">
          <button class="iconbtn" data-act="min">▾</button>
          <button class="iconbtn" data-act="top">⬆</button>
          <button class="iconbtn" data-act="close">✕</button>
        </div>
      </div>
      <div class="w-body"></div>
      <div class="w-footer"></div>
    `;
    this.board.appendChild(root);
    const header = root.querySelector("[data-drag]");
    let dragging=false, dx=0, dy=0;
    header.addEventListener("mousedown",(e)=>{ dragging=true; header.style.cursor="grabbing"; this._bump(root); dx=e.clientX-root.offsetLeft; dy=e.clientY-root.offsetTop; e.preventDefault(); });
    window.addEventListener("mousemove",(e)=>{ if(!dragging) return; const nx=Math.max(0,Math.min(this.board.clientWidth-root.offsetWidth,e.clientX-dx)); const ny=Math.max(48,Math.min(this.board.clientHeight-40,e.clientY-dy)); root.style.left=nx+"px"; root.style.top=ny+"px"; });
    window.addEventListener("mouseup",()=>{ if(dragging){ dragging=false; header.style.cursor="grab"; this.save(); }});
    header.addEventListener("dblclick",()=> this._bump(root));
    root.addEventListener("click",(e)=>{
      const btn = e.target.closest("[data-act]"); if(!btn) return;
      const a = btn.dataset.act;
      if(a==="close"){ root.remove(); this.save(); }
      if(a==="top"){ this._bump(root); }
      if(a==="min"){ root.querySelector(".w-body")?.classList.toggle("hidden"); this.save(); }
    });
    return root;
  }
  _parseCSV(text, header=true){
    const rows=[]; let cur="", row=[], q=false, i=0;
    const pushCell=()=>{ row.push(cur); cur=""; }
    const pushRow=()=>{ rows.push(row); row=[]; }
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
    if(!header) return rows.filter(r=>r.some(v=>v!==""));
    const head = rows.shift().map(h=>h.trim());
    return rows.map(r=>{const o={}; head.forEach((h,idx)=>o[h]=(r[idx]??"").trim()); return o;})
               .filter(o=>Object.values(o).some(v=>v!==""));
  }
  async _createRecipeWidget(pos={}){
    const w = this._makeShell({type:"recipe", title:"🍳 Recipe", ...pos});
    w.querySelector(".w-body").innerHTML = `
      <div class="row">
        <button class="btn" data-random>随机来一个</button>
        <span class="badge">数据: <code>${this._recipesCSV}</code></span>
      </div>
      <a class="figure square" data-link target="_blank" rel="noopener"><img data-img alt="recipe image"/></a>
      <div class="row"><strong data-title>准备中…</strong></div>
      <div class="row" data-issues></div>
    `;
    const els = { btn:w.querySelector("[data-random]"), img:w.querySelector("[data-img]"), link:w.querySelector("[data-link]"), title:w.querySelector("[data-title]"), issues:w.querySelector("[data-issues]") };
    const validUrl = u=>{ try{ new URL(u); return true;}catch{ return false; } };
    const showIssues = (arr=[])=>{ els.issues.innerHTML=""; arr.forEach(m=>{ const s=document.createElement("span"); s.className="badge"; s.textContent=m; els.issues.appendChild(s); }); };
    const ensure = async()=>{
      if(w._rows) return w._rows;
      const res = await fetch(`${this._recipesCSV}?t=${Date.now()}`, {cache:"no-store"});
      if(!res.ok) throw new Error("CSV 加载失败: "+res.status);
      const text = await res.text();
      const rows = this._parseCSV(text,true).map(r=>({
        title:(r.title||r.Title||r.name||"").trim(),
        image_url:(r.image_url||r.image||r.img||"").trim(),
        recipe_url:(r.recipe_url||r.url||r.link||"").trim()
      })).filter(r=>r.title && (r.image_url||r.recipe_url));
      if(!rows.length) throw new Error("CSV 没有有效行");
      w._rows = rows; return rows;
    };
    const render = (r)=>{
      els.title.textContent = r.title || "未命名";
      const imgOk = validUrl(r.image_url);
      els.img.src = imgOk ? r.image_url : "";
      els.link.href = validUrl(r.recipe_url) ? r.recipe_url : "#";
      showIssues([].concat(imgOk?[]:["图片无效"], validUrl(r.recipe_url)?[]:["链接无效"]));
      this.dispatchEvent(new CustomEvent("recipe:pick",{detail:r}));
    };
    const pick = ()=>{ const a=w._rows; if(!a?.length) return; let i; do{ i=Math.floor(Math.random()*a.length) }while(a.length>1 && i===w._last); w._last=i; render(a[i]); this.save(); };
    els.btn.addEventListener("click", async()=>{ try{ await ensure(); pick(); }catch(e){ showIssues([String(e.message||e)]) } });
    try{ await ensure(); pick(); }catch(e){ showIssues([String(e.message||e)]) }
    return w;
  }
  async _createMovieWidget(pos={}){
    const w = this._makeShell({type:"movie", title:"🎬 Movie", ...pos});
    w.querySelector(".w-body").innerHTML = `
      <div class="row">
        <button class="btn" data-random>随机电影</button>
        <span class="badge">数据: <code data-csv></code></span>
      </div>
      <a class="figure poster" data-link target="_blank" rel="noopener"><img data-img alt="movie poster"/></a>
      <div class="row">
        <strong data-title>准备中…</strong>
        <span class="badge" data-year></span>
        <span class="badge" data-score></span>
      </div>
      <div class="row" data-issues></div>
    `;
    const els = { btn:w.querySelector("[data-random]"), img:w.querySelector("[data-img]"), link:w.querySelector("[data-link]"),
      title:w.querySelector("[data-title]"), year:w.querySelector("[data-year]"), score:w.querySelector("[data-score]"),
      issues:w.querySelector("[data-issues]"), csv:w.querySelector("[data-csv]") };
    const validUrl = u=>{ try{ new URL(u); return true;}catch{ return false; } };
    const showIssues = (arr=[])=>{ els.issues.innerHTML=""; arr.forEach(m=>{ const s=document.createElement("span"); s.className="badge"; s.textContent=m; els.issues.appendChild(s); }); };
    const parseYear = d=>{ if(!d) return ""; const m4=String(d).match(/(19|20)\d{2}/); if(m4) return m4[0];
      const m2=String(d).match(/(\d{2})(?!.*\d)/); if(m2){ const yy=parseInt(m2[1],10); return String(yy>=30?1900+yy:2000+yy); } return ""; };
    const ensure = async()=>{
      if(w._rows) return w._rows;
      let used=null, rows=null;
      for(const p of this._moviesCSVcandidates){
        try{
          const res = await fetch(`${p}?t=${Date.now()}`, {cache:"no-store"});
          if(!res.ok) continue;
          const txt = await res.text();
          const arr = this._parseCSV(txt,true).map(r=>{
            const t=(r.title||r.name||"").trim();
            const rd=(r.release_date||r.date||"").trim();
            const ms=(r.metascore||r.score||r.metascore_w||"").toString().trim();
            const img=(r.poster_url||r.image_url||r.poster||"").trim();
            const url=(r.url||r.link||r.movie_url||"").trim();
            return {title:t, release_date:rd, metascore:ms, poster_url:img, url};
          }).filter(o=> o.title && (o.poster_url || o.url));
          if(arr.length){ used=p; rows=arr; break; }
        }catch{}
      }
      if(!rows) throw new Error("找不到可用的 movies CSV");
      w._rows=rows; w._used=used; if(els.csv) els.csv.textContent=used; return rows;
    };
    const render = (r)=>{
      els.title.textContent = r.title || "未命名";
      const y=parseYear(r.release_date); els.year.textContent = y ? y : "年份未知";
      const sc=parseInt(r.metascore,10); els.score.textContent = Number.isFinite(sc)?`Metascore ${sc}`:"无分数";
      const hasImg = !!(r.poster_url && validUrl(r.poster_url)); els.img.src = hasImg ? r.poster_url : "";
      const target = r.url && r.url.trim() ? r.url.trim() : `https://www.google.com/search?q=${encodeURIComponent('site:metacritic.com '+(r.title||''))}`;
      els.link.href = target;
      showIssues([].concat(hasImg?[]:["图片无效或缺失"], target?[]:["无可用链接"]));
      this.dispatchEvent(new CustomEvent("movie:pick",{detail:r}));
    };
    const pick = ()=>{ const a=w._rows; if(!a?.length) return; let i; do{ i=Math.floor(Math.random()*a.length) }while(a.length>1 && i===w._last); w._last=i; render(a[i]); this.save(); };
    els.btn.addEventListener("click", async()=>{ try{ await ensure(); pick(); }catch(e){ showIssues([String(e.message||e)]) } });
    try{ await ensure(); pick(); }catch(e){ showIssues([String(e.message||e)]) }
    return w;
  }
  _createDrawerWidget(pos={}){
    const w = this._makeShell({type:"drawer", title:"🃏 Card Drawer", ...pos});
    w._deck = (pos.state && pos.state.deck) || [
      {title:"今日惊喜", desc:"试一道从未做过的菜"},
      {title:"健康打卡", desc:"今晚 20 分钟快步走"},
      {title:"电影之夜", desc:"看一部 2010 年前的电影"},
      {title:"整理时间", desc:"清理冰箱和补货清单"},
      {title:"放松一下", desc:"泡个脚 + 播放黑胶"},
    ];
    w.querySelector(".w-body").innerHTML = `
      <div class="row">
        <button class="btn" data-draw>抽一张</button>
        <button class="btn secondary" data-peek>查看卡组(${w._deck.length})</button>
      </div>
      <div class="row" data-area><span class="badge">点“抽一张”随机出卡</span></div>
    `;
    const area = w.querySelector("[data-area]");
    const renderCard = (c)=>{ area.innerHTML=""; const card=document.createElement("div");
      card.style.border="1px solid var(--stroke)"; card.style.borderRadius="12px"; card.style.padding="10px"; card.style.background="#221b17";
      card.innerHTML = `<strong>${c.title}</strong><div class="muted">${c.desc||""}</div>`; area.appendChild(card);
    };
    w.querySelector("[data-draw]").addEventListener("click",()=>{ const d=w._deck; const i=Math.floor(Math.random()*d.length); renderCard(d[i]); this.save(); });
    w.querySelector("[data-peek]").addEventListener("click",()=>{ area.innerHTML=""; w._deck.forEach(c=>{ const row=document.createElement("div"); row.className="row"; row.innerHTML=`<span class="badge">${c.title}</span><span class="muted">${c.desc||""}</span>`; area.appendChild(row); }); });
    return w;
  }
}
customElements.define("vintage-widgets-board", VintageWidgetsBoard);

