/* Interactive design prototype. Data lives only in this page; no API requests. */
'use strict';
const $ = id => document.getElementById(id);
const SVG = 'http://www.w3.org/2000/svg';
const icons = {
  chevron:'<path d="m6 9 6 6 6-6"/>', cursor:'<path d="m4 3 6 18 3-8 8-3Z"/>',
  hand:'<path d="M8 13V6a2 2 0 0 1 4 0v6-8a2 2 0 0 1 4 0v8-5a2 2 0 0 1 4 0v9c0 4-3 6-7 6-3 0-5-2-7-5l-3-5a2 2 0 0 1 3-2l2 3Z"/>',
  brush:'<path d="m12 13 8-9a2 2 0 0 0-3-3l-8 9m-1 3c-5-1-2 6-6 6 7 4 11-2 6-6Z"/>',
  river:'<path d="M7 2c12 5-6 7 4 12s7 6 5 8M12 2c12 5-6 7 4 12s7 6 5 8"/>',
  selection:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5M11 3h2M3 11v2m18-2v2m-10 8h2"/>',
  layers:'<path d="m12 3 10 6-10 6L2 9Zm-9 11 9 6 9-6M3 18l9 5 9-5"/>',
  history:'<path d="M3 11a9 9 0 1 1 2 7M3 4v7h7m2-5v7l4 2"/>',
  undo:'<path d="m3 10 5-5m-5 5 5 5M4 10h10a6 6 0 0 1 0 12"/>',
  redo:'<path d="m21 10-5-5m5 5-5 5m4-5H10a6 6 0 0 0 0 12"/>',
  moon:'<path d="M20 15A9 9 0 0 1 9 4a9 9 0 1 0 11 11Z"/>',
  sun:'<circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/>',
  maximize:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/>',
  export:'<path d="M12 15V2m-5 5 5-5 5 5M4 13v8h16v-8"/>',
  edit:'<path d="m15 3 6 6M4 20l5-1L21 7a2 2 0 0 0-4-4L5 15Z"/>',
  refresh:'<path d="M20 9a8 8 0 1 0 0 7m1-13v7h-7"/>',
  panelLeft:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M9 4v16m7-11-3 3 3 3"/>',
  panelRight:'<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M15 4v16m-7-11 3 3-3 3"/>',
  map:'<path d="m3 6 6-3 6 3 6-3v15l-6 3-6-3-6 3Zm6-3v15m6-12v15"/>',
  mountain:'<path d="m2 21 8-17 9 17Zm10-14 3-4 8 18h-4M7 10l3 2 3-2"/>',
  hill:'<path d="M2 20c3-14 8-14 13 0m-4-7c4-9 8-7 11 7"/>',
  plain:'<path d="M2 17c7-4 9 3 20-1M5 11l2-3 2 3m-2-3v9m7-8 2-3 2 3m-2-3v10"/>',
  tree:'<path d="m12 2-5 7h3l-5 7h5v6h4v-6h5l-5-7h3Z"/>',
  water:'<path d="M2 8c4-6 7 6 11 0s7 5 9 0M2 14c4-6 7 6 11 0s7 5 9 0M2 20c4-6 7 6 11 0s7 5 9 0"/>',
  hex:'<path d="m12 2 9 5v10l-9 5-9-5V7Z"/>',
  type:'<path d="M4 4h16M12 4v17M8 21h8M4 4v4m16-4v4"/>',
  minus:'<path d="M5 12h14"/>', plus:'<path d="M5 12h14m-7-7v14"/>',
  fit:'<path d="M8 3H3v5m13-5h5v5M3 16v5h5m13-5v5h-5"/><rect x="8" y="8" width="8" height="8" rx="1"/>',
  sliders:'<path d="M4 7h5m5 0h6M4 17h10m5 0h1"/><circle cx="11" cy="7" r="3"/><circle cx="16" cy="17" r="3"/>',
  close:'<path d="m6 6 12 12M6 18 18 6"/>', help:'<circle cx="12" cy="12" r="9"/><path d="M9 9a3 3 0 0 1 6 0c0 2-3 2-3 5m0 3h.01"/>', check:'<path d="m4 12 5 5L20 6"/>'
};
function icon(name) { return '<svg viewBox="0 0 24 24" aria-hidden="true">'+(icons[name] || icons.hex)+'</svg>'; }
function hydrateIcons(scope = document) { scope.querySelectorAll('i[data-icon]').forEach(el => { el.innerHTML = icon(el.dataset.icon); }); }
function esc(value) { return String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&#39;'); }
const palette = { plain:{name:'平原',color:'#bec5a0',icon:'plain'}, hill:{name:'丘陵',color:'#b5b28c',icon:'hill'}, mountain:{name:'山地',color:'#b8b7a4',icon:'mountain'}, water:{name:'水域',color:'#abc6c4',icon:'water'} };
const biomeNames = {grassland:'草原',mixed_forest:'温带混交林',alpine:'高山生态',marine:'海洋生态',none:'无生态覆盖'};
const state = { tool:'select', cells:new Map(), rivers:[], selected:null, selectionKind:'cell', batch:new Set(), draft:null, dirty:false, brush:'plain', brushSize:1, batchTerrain:'keep', batchBiome:'keep', riverPoints:[], riverName:'新河流', riverWidth:4, selectedRiver:null, past:[], future:[], zoom:1, pan:{x:0,y:0}, space:false, showHistory:false, filter:null, busy:false };
const editor = $('editor');
let toastTimer, pointer = null;
function notify(message) { clearTimeout(toastTimer); $('toast').textContent = message; $('toast').hidden = false; toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3600); }
function pointString(x,y,size=15) { return Array.from({length:6},(_,i)=>[x+size*Math.cos(i*Math.PI/3),y+size*Math.sin(i*Math.PI/3)].map(n=>n.toFixed(2)).join(',')).join(' '); }
const coord = cell => 'R'+String(cell.row).padStart(2,'0')+' C'+String(cell.col).padStart(2,'0');
function generateMap() {
  for(let col=0;col<47;col++) for(let row=0;row<32;row++) {
    const x=32+col*23.1, y=26+row*26.67+(col%2)*13.335;
    const n=Math.sin(x*.041+y*.023)*.055+Math.sin(y*.056-x*.019)*.045;
    const main=1-((x-497)/234)**2-((y-408)/282)**2+n;
    const north=1-((x-446)/111)**2-((y-203)/126)**2+n;
    const east=1-((x-862)/85)**2-((y-239)/125)**2+n*2;
    const south=1-((x-810)/112)**2-((y-611)/69)**2+n*3;
    const west=1-((x-235)/62)**2-((y-257)/61)**2+n*2;
    const land=Math.max(main,north,east,south,west);
    if(land < -.20) continue;
    let terrain='plain', biome='grassland', color=palette.plain.color;
    if(land<0){terrain='water';biome='marine';color=land<-.1?'#c7d8d2':'#b6cec4';}
    else if(land<.15){color='#d0d4b0';}
    else if((y<365&&x>360&&x<565&&Math.abs(x-(466+Math.sin(y/65)*40))<68) || (east>.35&&y<250)){terrain='mountain';biome='alpine';color=y<210?'#d1d3c1':'#b8b7a4';}
    else if((x>500&&y>280&&y<470)||(x<440&&y>430&&y<610)||east>.5){biome='mixed_forest';color='#829a7b';}
    else if(Math.sin(y*.025+x*.024)>.60&&land>.22){terrain='hill';color='#b5b28c';}
    const tags=terrain==='mountain'?['peak']:east>0||south>0||west>0?['island']:land<.13?['bay']:[];
    const id=row+','+col;
    state.cells.set(id,{id,row,col,x,y,terrain,biome,tags,note:'',color});
  }
  state.rivers=[{id:'mist',name:'雾松河',width:4,points:[{x:503,y:289},{x:523,y:344},{x:501,y:409},{x:540,y:464},{x:568,y:519},{x:620,y:553},{x:646,y:596}]},{id:'glacier',name:'冰川溪',width:2.5,points:[{x:445,y:265},{x:417,y:320},{x:384,y:360},{x:371,y:414},{x:349,y:448}]}];
  const initial=[...state.cells.values()].reduce((a,b)=>Math.hypot(a.x-521,a.y-480)<Math.hypot(b.x-521,b.y-480)?a:b);
  state.selected=initial.id; state.draft=structuredClone(initial);
}
function texture(cell) { return cell.terrain==='mountain'?'mountainTexture':cell.terrain==='hill'?'hillTexture':cell.biome==='mixed_forest'?'forestTexture':null; }
function cellColor(cell) { return cell.color || (cell.biome==='mixed_forest'&&cell.terrain==='plain'?'#829a7b':palette[cell.terrain].color); }
function renderCells() {
  $('hexCells').innerHTML=[...state.cells.values()].map(c=>'<polygon class="hex'+(state.filter&&!c.tags.includes(state.filter)?' filter-dim':'')+'" data-cell="'+c.id+'" points="'+pointString(c.x,c.y)+'" fill="'+cellColor(c)+'" role="button" tabindex="-1" aria-label="'+coord(c)+' '+palette[c.terrain].name+'"/>').join('');
  $('biomeLayer').innerHTML=[...state.cells.values()].filter(c=>texture(c)).map(c=>'<polygon points="'+pointString(c.x,c.y)+'" fill="url(#'+texture(c)+')" opacity="'+(state.filter&&!c.tags.includes(state.filter)?'.2':'1')+'"/>').join('');
  $('cellCount').textContent=state.cells.size.toLocaleString('zh-CN');
  renderSelection();
}
function riverPath(points) {
  if(!points.length)return '';
  let d='M'+points[0].x+' '+points[0].y;
  for(let i=1;i<points.length-1;i++) d+='Q'+points[i].x+' '+points[i].y+' '+((points[i].x+points[i+1].x)/2)+' '+((points[i].y+points[i+1].y)/2);
  if(points.length>1)d+='L'+points.at(-1).x+' '+points.at(-1).y;
  return d;
}
function renderRivers() {
  $('riverLayer').innerHTML=state.rivers.map(r=>'<path d="'+riverPath(r.points)+'" stroke="#d6e8dc" stroke-width="'+(r.width+3)+'" fill="none" stroke-linecap="round"/><path d="'+riverPath(r.points)+'" stroke="#508e98" stroke-width="'+r.width+'" fill="none" stroke-linecap="round"/><path d="'+riverPath(r.points)+'" stroke="transparent" stroke-width="18" fill="none" pointer-events="stroke" data-river="'+r.id+'" style="cursor:pointer"/>').join('');
  $('riverCount').textContent=String(state.rivers.length).padStart(2,'0');
  $('riverList').innerHTML=state.rivers.map(r=>'<button class="river-entry" data-select-river="'+r.id+'"><i data-icon="river"></i>'+esc(r.name)+'<span class="subcount">'+r.points.length+' 点</span></button>').join('');
  hydrateIcons($('riverList'));
  $('riverList').querySelectorAll('[data-select-river]').forEach(b=>b.onclick=()=>chooseRiver(b.dataset.selectRiver));
}
function renderSelection() {
  const ids=state.tool==='batch'?[...state.batch]:state.selectionKind==='cell'&&state.selected?[state.selected]:[];
  $('selectionLayer').innerHTML=ids.map(id=>{const c=state.cells.get(id);return c?'<polygon points="'+pointString(c.x,c.y,15.8)+'" fill="#f5e4a1" fill-opacity=".23" stroke="#2f6549" stroke-width="2.6"/><polygon points="'+pointString(c.x,c.y,13)+'" fill="none" stroke="#ffffed" stroke-width="1.2"/>':'';}).join('');
  const points=state.riverPoints;
  $('draftRiverLayer').innerHTML=points.length?'<path d="'+riverPath(points)+'" stroke="#367889" stroke-width="4" fill="none" stroke-dasharray="6 4"/>'+points.map((p,i)=>'<circle cx="'+p.x+'" cy="'+p.y+'" r="5" fill="#fffef4" stroke="#367889" stroke-width="2"/><text x="'+(p.x+9)+'" y="'+(p.y-6)+'" font-size="11" fill="#2f6170">'+(i+1)+'</text>').join(''):'';
}
function updateStatus() {
  const dirty=state.dirty||state.riverPoints.length>0;
  document.querySelector('.document-status').classList.toggle('dirty',dirty);
  $('saveStatus').textContent=dirty?'有未应用修改':state.past.length?'预览已更新':'示例已载入';
  $('undo').disabled=!state.past.length; $('redo').disabled=!state.future.length;
}
function cloneData(){return {cells:[...state.cells.entries()].map(([id,c])=>[id,structuredClone(c)]),rivers:structuredClone(state.rivers),name:$('mapName').textContent};}
function commit(label,before) { state.past.push({label,before,after:cloneData()}); state.future=[]; updateStatus(); renderCells(); renderRivers(); }
function restore(data) { state.cells=new Map(structuredClone(data.cells));state.rivers=structuredClone(data.rivers);setMapName(data.name);state.dirty=false;state.riverPoints=[];if(state.selected)state.draft=structuredClone(state.cells.get(state.selected));renderAll(); }
function moveHistory(direction) { requestAction(()=>{const source=direction==='undo'?state.past:state.future;const target=direction==='undo'?state.future:state.past;const item=source.pop();if(!item)return;target.push(item);restore(direction==='undo'?item.before:item.after);notify((direction==='undo'?'已撤销：':'已重做：')+item.label);}); }
function terrainChoices(value){return '<div class="terrain-grid">'+Object.entries(palette).map(([key,p])=>'<button class="terrain-option" data-terrain="'+key+'" aria-pressed="'+(key===value)+'"><i data-icon="'+p.icon+'" style="--terrain-color:'+p.color+'"></i>'+p.name+'</button>').join('')+'</div>';}
function biomeOptions(value,keep=false){return (keep?'<option value="keep">保持原值</option>':'')+Object.entries(biomeNames).map(([v,n])=>'<option value="'+v+'"'+(v===value?' selected':'')+'>'+n+'</option>').join('');}
function cellDirty(){const current=state.cells.get(state.selected);state.dirty=!!current&&['terrain','biome','note','tags'].some(k=>JSON.stringify(current[k])!==JSON.stringify(state.draft[k]));updateStatus();const apply=$('applyCell');if(apply)apply.disabled=!state.dirty;const revert=$('revertCell');if(revert)revert.disabled=!state.dirty;}
function editTerrain(terrain){state.draft.terrain=terrain;delete state.draft.color;cellDirty();renderInspector();}
function applyCell(){if(!state.dirty||state.busy)return;state.busy=true;const before=cloneData();state.cells.set(state.selected,structuredClone(state.draft));state.dirty=false;commit('修改 '+coord(state.draft),before);state.busy=false;renderInspector();notify('单元格修改已应用，可撤销');}
function renderInspector() {
  const body=$('inspectorBody'), actions=$('inspectorActions');actions.innerHTML='';
  if(state.showHistory){
    $('inspectorTitle').textContent='编辑历史';body.innerHTML='<p class="field-help">每次应用、每次笔刷拖动各记为一步。</p><div class="history-list">'+(state.past.length?[...state.past].reverse().map((item,i)=>'<div class="history-item"><i data-icon="'+(i===0?'check':'history')+'"></i><div>'+esc(item.label)+'<small>'+(i===0?'当前位置':'此前操作')+'</small></div></div>').join(''):'<div class="empty-inspector"><i data-icon="history"></i><h3>从一次修改开始</h3><p>应用属性、绘制或批量修改后，<br>这里会记录你的每一步。</p></div>')+'</div>';
  }else if(state.tool==='paint'){
    $('inspectorTitle').textContent='地形笔刷';body.innerHTML='<div class="selection-identity"><strong>绘制地形</strong><span class="badge">B</span></div><p class="field-help">在地图上拖动，为经过的单元格设置地形。</p><section class="field-section"><div class="field-heading"><h3>笔刷地形</h3></div>'+terrainChoices(state.brush)+'</section><label class="field"><span>笔刷范围</span><select id="brushSize"><option value="1">单格</option><option value="2">中心格与相邻格</option></select></label><div class="brush-row"><span>修改字段</span><b>地形</b></div><p class="field-help">一次拖动记为一步，松开后可撤销。<br>按住空格，随时平移地图。</p>';body.querySelectorAll('[data-terrain]').forEach(b=>b.onclick=()=>{state.brush=b.dataset.terrain;renderInspector();});$('brushSize').value=state.brushSize;$('brushSize').onchange=e=>{state.brushSize=Number(e.target.value);};
  }else if(state.tool==='batch'){
    $('inspectorTitle').textContent='批量修改';body.innerHTML='<div class="selection-identity"><strong>'+state.batch.size+' <small>格</small></strong><span class="badge">多选</span></div><p class="field-help">点选单元格加入或移出选区。平移、缩放时保留选择。</p><section class="field-section"><h3>选择要修改的字段</h3><label class="field"><span>地形</span><select id="batchTerrain"><option value="keep">保持原值</option>'+Object.entries(palette).map(([v,p])=>'<option value="'+v+'">'+p.name+'</option>').join('')+'</select></label><label class="field"><span>生态</span><select id="batchBiome">'+biomeOptions(state.batchBiome,true)+'</select></label><p class="field-help">仅修改已指定的字段。提交前可核对影响范围。</p></section>';actions.innerHTML='<div class="action-buttons"><button class="secondary" id="clearBatch">清空选择</button><button class="primary" id="applyBatch" '+(!state.batch.size||(state.batchTerrain==='keep'&&state.batchBiome==='keep')?'disabled':'')+'>应用到 '+state.batch.size+' 格</button></div><p>当前范围：选中单元格</p>';$('batchTerrain').value=state.batchTerrain;$('batchBiome').value=state.batchBiome;$('batchTerrain').onchange=e=>{state.batchTerrain=e.target.value;renderInspector();};$('batchBiome').onchange=e=>{state.batchBiome=e.target.value;renderInspector();};$('clearBatch').onclick=()=>{state.batch.clear();renderAll();};$('applyBatch').onclick=applyBatch;
  }else if(state.tool==='river'||state.selectionKind==='river'){
    $('inspectorTitle').textContent=state.tool==='river'?'绘制河流':'河流属性';const existing=state.rivers.find(r=>r.id===state.selectedRiver);const points=state.tool==='river'?state.riverPoints:existing?.points||[];
    body.innerHTML='<div class="selection-identity"><strong>'+(state.tool==='river'?'新河流':esc(existing?.name||'河流'))+'</strong><span class="badge">'+points.length+' 个点</span></div><label class="field"><span>名称</span><input id="riverNameInput" value="'+esc(state.riverName)+'" maxlength="80"></label><label class="field"><span>宽度 <output id="riverWidthValue">'+state.riverWidth+'</output></span><input id="riverWidth" type="range" min="1" max="10" step=".5" value="'+state.riverWidth+'"></label><section class="field-section"><div class="field-heading"><h3>路径点</h3><span>'+(state.tool==='river'?'在画布上添加':'按路径顺序')+'</span></div>'+(points.length?'<div class="river-points">'+points.map((p,i)=>'<div class="river-point"><span>'+(i+1)+'</span><b>'+(p.row!==undefined?coord(p):'控制点 '+(i+1))+'</b>'+(i===0?' · 河源':i===points.length-1?' · 终点':'')+(state.tool==='river'?'<button data-remove-point="'+i+'" aria-label="移除路径点 '+(i+1)+'">×</button>':'')+'</div>').join('')+'</div>':'<p class="field-help">点击河源，再沿流向添加路径点。<br>至少两个点即可完成绘制。</p>')+'</section>';
    actions.innerHTML='<div class="action-buttons"><button class="secondary" id="cancelRiver">'+(state.tool==='river'?'取消绘制':'还原')+'</button><button class="primary" id="finishRiver" '+(points.length<2?'disabled':'')+'>'+(state.tool==='river'?'完成河流':'应用修改')+'</button></div><p>'+(state.tool==='river'?'Enter 完成 · Escape 取消':'修改可以撤销')+'</p>';
    $('riverNameInput').oninput=e=>{state.riverName=e.target.value;if(state.tool!=='river')state.dirty=true;updateStatus();};$('riverWidth').oninput=e=>{state.riverWidth=Number(e.target.value);$('riverWidthValue').textContent=e.target.value;if(state.tool!=='river')state.dirty=true;updateStatus();};$('finishRiver').onclick=finishRiver;$('cancelRiver').onclick=()=>{if(state.tool==='river'){requestAction(()=>{state.riverPoints=[];setToolNow('select');});}else{const r=state.rivers.find(r=>r.id===state.selectedRiver);state.riverName=r.name;state.riverWidth=r.width;state.dirty=false;renderInspector();updateStatus();}};body.querySelectorAll('[data-remove-point]').forEach(b=>b.onclick=()=>{state.riverPoints.splice(Number(b.dataset.removePoint),1);renderAll();});
  }else if(state.selected&&state.draft){
    const c=state.draft; $('inspectorTitle').textContent='单元格属性';
    body.innerHTML='<div class="selection-identity"><strong>'+coord(c)+'</strong><span class="badge">已设计</span></div><div class="selection-preview"><svg viewBox="0 0 60 60"><polygon points="'+pointString(30,30,26)+'" fill="'+cellColor(c)+'" stroke="#78916b" stroke-width="1"/>'+ (texture(c)?'<polygon points="'+pointString(30,30,26)+'" fill="url(#'+texture(c)+')"/>':'')+'</svg><div><strong>'+palette[c.terrain].name+'</strong><span>'+biomeNames[c.biome]+'</span></div></div><section class="field-section"><div class="field-heading"><h3>地形</h3><span>选择基础地貌</span></div>'+terrainChoices(c.terrain)+'</section><label class="field"><span>生态覆盖</span><select id="cellBiome">'+biomeOptions(c.biome)+'</select></label><section class="field-section"><div class="field-heading"><h3>标记</h3><span>可多选</span></div><div class="tag-chips">'+[['peak','山峰'],['bay','海湾'],['island','岛屿']].map(([key,name])=>'<button data-tag="'+key+'" aria-pressed="'+c.tags.includes(key)+'">'+name+'</button>').join('')+'</div></section><label class="field"><span>创作备注</span><textarea id="cellNote" placeholder="记录这里的地貌、故事与设定…">'+esc(c.note)+'</textarea></label>';
    actions.innerHTML='<div class="action-buttons"><button class="secondary" id="revertCell" '+(!state.dirty?'disabled':'')+'>还原</button><button class="primary" id="applyCell" '+(!state.dirty?'disabled':'')+'>应用修改</button></div><p>⌘/Ctrl + Enter 应用 · 应用后可撤销</p>';
    body.querySelectorAll('[data-terrain]').forEach(b=>b.onclick=()=>editTerrain(b.dataset.terrain));$('cellBiome').onchange=e=>{state.draft.biome=e.target.value;delete state.draft.color;cellDirty();renderInspector();};body.querySelectorAll('[data-tag]').forEach(b=>b.onclick=()=>{const tag=b.dataset.tag;state.draft.tags=state.draft.tags.includes(tag)?state.draft.tags.filter(t=>t!==tag):[...state.draft.tags,tag];cellDirty();renderInspector();});$('cellNote').oninput=e=>{state.draft.note=e.target.value;cellDirty();};$('applyCell').onclick=applyCell;$('revertCell').onclick=()=>{state.draft=structuredClone(state.cells.get(state.selected));state.dirty=false;renderInspector();updateStatus();};
  }else{ $('inspectorTitle').textContent='属性';body.innerHTML='<div class="empty-inspector"><i data-icon="cursor"></i><h3>从地图中选择</h3><p>选择单元格或河流，<br>这里会显示相应的属性。</p></div>'; }
  hydrateIcons(body);hydrateIcons(actions);
}
function applyBatch(){if(!state.batch.size)return;const fields=[state.batchTerrain!=='keep'?'地形':'',state.batchBiome!=='keep'?'生态':''].filter(Boolean);showDialog('应用批量修改','<p>将修改 <strong>'+state.batch.size+' 个单元格</strong>的'+fields.join('、')+'。本次操作可整体撤销。</p>',[{label:'返回检查'},{label:'确认应用',primary:true,run:()=>{const before=cloneData();for(const id of state.batch){const c=state.cells.get(id);if(state.batchTerrain!=='keep')c.terrain=state.batchTerrain;if(state.batchBiome!=='keep')c.biome=state.batchBiome;delete c.color;}commit('批量修改 '+state.batch.size+' 格',before);renderInspector();notify('已应用到 '+state.batch.size+' 格，可整体撤销');}}]);}
function finishRiver(){const existing=state.rivers.find(r=>r.id===state.selectedRiver);const points=state.tool==='river'?state.riverPoints:existing?.points;if(!state.riverName.trim()){notify('请先填写河流名称');$('riverNameInput')?.focus();return false;}if(!points||points.length<2)return false;const before=cloneData();if(state.tool==='river'){state.rivers.push({id:'river-'+Date.now(),name:state.riverName.trim(),width:state.riverWidth,points:structuredClone(points)});}else if(existing){existing.name=state.riverName.trim();existing.width=state.riverWidth;}state.dirty=false;state.riverPoints=[];commit('编辑河流「'+state.riverName+'」',before);setToolNow('select');notify('河流已应用，可撤销');return true;}
function requestAction(action){if(!state.dirty&&!state.riverPoints.length){action();return;}const river=state.tool==='river'||state.selectionKind==='river';showDialog('当前修改尚未应用','<p>你可以先应用修改再继续，也可以放弃草稿或返回编辑。</p>',[{label:'继续编辑'},{label:'放弃草稿',run:()=>{discardDraft();action();}},{label:'应用并继续',primary:true,run:()=>{if(river){if(!finishRiver())return;}else applyCell();action();}}]);}
function discardDraft(){state.dirty=false;state.riverPoints=[];state.draft=state.selected?structuredClone(state.cells.get(state.selected)):null;updateStatus();}
const toolNames={select:'选择',pan:'平移',paint:'笔刷',river:'河流',batch:'多选'};
const hints={select:'点击选择 · 方向键移动选择 · 空格拖动平移',pan:'拖动地图 · 滚轮缩放',paint:'拖动绘制 · 一次拖动记为一步 · 空格平移',river:'点击添加路径点 · Enter 完成 · Escape 取消',batch:'点击加入或移出选区 · 空格平移'};
function setToolNow(tool){state.tool=tool;state.showHistory=false;state.selectionKind='cell';state.selectedRiver=null;if(tool==='river'){state.riverPoints=[];state.riverName='新河流';}state.draft=state.selected?structuredClone(state.cells.get(state.selected)):null;renderAll();if(innerWidth>900)openInspector();}
function chooseTool(tool){if(tool===state.tool&&!state.showHistory)return;if((tool==='pan'||tool==='select')&&(state.tool==='select'||state.tool==='pan')){state.tool=tool;state.showHistory=false;renderAll();return;}requestAction(()=>setToolNow(tool));}
function chooseCell(id){if(state.selected===id&&state.selectionKind==='cell')return;requestAction(()=>{state.selected=id;state.selectionKind='cell';state.draft=structuredClone(state.cells.get(id));state.dirty=false;state.showHistory=false;renderAll();if(innerWidth>900)openInspector();});}
function chooseRiver(id){requestAction(()=>{const r=state.rivers.find(r=>r.id===id);if(!r)return;state.tool='select';state.selectionKind='river';state.selectedRiver=id;state.riverName=r.name;state.riverWidth=r.width;state.dirty=false;state.showHistory=false;renderAll();openInspector();});}
function renderContext(){const bar=$('contextBar');bar.hidden=!(state.tool==='river'||state.tool==='batch');bar.innerHTML=state.tool==='river'?'<strong>绘制河流</strong><span>'+state.riverPoints.length+' 个路径点</span><button id="contextFinish" class="primary" '+(state.riverPoints.length<2?'disabled':'')+'>完成</button>':state.tool==='batch'?'<strong>已选 '+state.batch.size+' 格</strong><span>跨视口保留选择</span>':'';if($('contextFinish'))$('contextFinish').onclick=finishRiver;}
function renderAll(){renderCells();renderRivers();renderInspector();renderContext();updateStatus();document.querySelectorAll('.tool[data-tool]').forEach(b=>{const active=b.dataset.tool===state.tool;b.classList.toggle('active',active);b.setAttribute('aria-pressed',String(active));b.tabIndex=active?0:-1;});$('canvasArea').dataset.tool=state.tool;$('activeToolLabel').textContent=toolNames[state.tool];$('toolHint').textContent=hints[state.tool];if(state.selected){$('cursorCoord').textContent=coord(state.cells.get(state.selected));canvas.setAttribute('aria-label','地图画布，当前 '+coord(state.cells.get(state.selected))+'。方向键移动，Enter 操作当前单元格；绘制河流时 Shift Enter 添加路径点，Enter 完成。');}}
function syncDrawers(){const layers=!editor.classList.contains('layers-closed');const inspector=!editor.classList.contains('inspector-closed');$('layersButton').setAttribute('aria-expanded',String(layers));$('inspectorButton').setAttribute('aria-expanded',String(inspector));$('drawerScrim').hidden=!((innerWidth<=1100&&layers)||(innerWidth<=900&&inspector))||editor.classList.contains('focus-mode');}
function openInspector(){editor.classList.remove('inspector-closed','focus-mode');if(innerWidth<=1100)editor.classList.add('layers-closed');syncDrawers();}
function setMapName(name){$('mapName').textContent=name;document.querySelector('.canvas-heading h1').textContent=name;document.querySelector('.map-entry strong').textContent=name;}
function showDialog(title,body,actions){$('dialogTitle').textContent=title;$('dialogBody').innerHTML=body;$('dialogActions').innerHTML='';for(const action of actions){const button=document.createElement('button');button.type='button';button.textContent=action.label;button.className=action.primary?'primary':'secondary';button.onclick=()=>{ $('dialog').close();action.run?.(); };$('dialogActions').append(button);}hydrateIcons($('dialog'));if(!$('dialog').open)$('dialog').showModal();}
function updateCamera(){const w=1100/state.zoom,h=850/state.zoom;$('mapCanvas').setAttribute('viewBox',[(1100-w)/2+state.pan.x,(850-h)/2+state.pan.y,w,h].join(' '));$('zoomValue').textContent=Math.round(state.zoom*100)+'%';}
function zoomBy(factor){state.zoom=Math.max(.55,Math.min(4,state.zoom*factor));updateCamera();}
function worldPoint(event){const p=$('mapCanvas').createSVGPoint();p.x=event.clientX;p.y=event.clientY;return p.matrixTransform($('mapCanvas').getScreenCTM().inverse());}
function hitCell(event){const direct=event.target.closest?.('[data-cell]');if(direct)return state.cells.get(direct.dataset.cell);const point=worldPoint(event);let nearest=null,distance=18;for(const c of state.cells.values()){const d=Math.hypot(point.x-c.x,point.y-c.y);if(d<distance){distance=d;nearest=c;}}return nearest;}
function paint(cell){if(!cell)return;const targets=state.brushSize===1?[cell]:[...state.cells.values()].filter(c=>Math.hypot(c.x-cell.x,c.y-cell.y)<29);for(const c of targets){if(c.terrain===state.brush)continue;c.terrain=state.brush;delete c.color;pointer.changed=true;}renderCells();}
const canvas=$('mapCanvas');
canvas.addEventListener('pointerdown',e=>{if(pointer||(e.button!==0&&e.button!==1))return;const p=worldPoint(e);const cell=hitCell(e);pointer={id:e.pointerId,start:{x:e.clientX,y:e.clientY},worldStart:p,pan:{...state.pan},kind:e.button===1||state.space||state.tool==='pan'?'pan':state.tool==='paint'?'paint':'click',before:state.tool==='paint'?cloneData():null,changed:false,moved:false,cell,river:e.target.closest?.('[data-river]')?.dataset.river};canvas.setPointerCapture(e.pointerId);if(pointer.kind==='paint')paint(cell);if(pointer.kind==='pan')$('canvasArea').classList.add('dragging');});
canvas.addEventListener('pointermove',e=>{const cell=hitCell(e);if(cell)$('cursorCoord').textContent=coord(cell);if(!pointer||pointer.id!==e.pointerId)return;pointer.moved ||= Math.hypot(e.clientX-pointer.start.x,e.clientY-pointer.start.y)>4;if(pointer.kind==='pan'){const ctm=canvas.getScreenCTM();state.pan.x=pointer.pan.x-(e.clientX-pointer.start.x)/ctm.a;state.pan.y=pointer.pan.y-(e.clientY-pointer.start.y)/ctm.d;updateCamera();}else if(pointer.kind==='paint')paint(cell);});
function endPointer(e,cancelled=false){if(!pointer||pointer.id!==e.pointerId)return;const p=pointer;pointer=null;$('canvasArea').classList.remove('dragging');if(canvas.hasPointerCapture(e.pointerId))canvas.releasePointerCapture(e.pointerId);if(cancelled){if(p.kind==='paint'&&p.before)restore(p.before);return;}if(p.kind==='paint'&&p.changed){commit('笔刷绘制地形',p.before);notify('已完成一笔，可整体撤销');}else if(p.kind==='click'&&!p.moved){if(state.tool==='select'&&p.river){chooseRiver(p.river);return;}if(!p.cell)return;if(state.tool==='batch'){state.batch.has(p.cell.id)?state.batch.delete(p.cell.id):state.batch.add(p.cell.id);renderAll();}else if(state.tool==='river'){if(state.riverPoints.at(-1)?.id!==p.cell.id)state.riverPoints.push({...p.cell});renderAll();}else chooseCell(p.cell.id);}}
canvas.addEventListener('pointerup',e=>endPointer(e));canvas.addEventListener('pointercancel',e=>endPointer(e,true));canvas.addEventListener('wheel',e=>{e.preventDefault();const before=worldPoint(e);zoomBy(Math.exp(-e.deltaY*.001));const after=worldPoint(e);state.pan.x+=before.x-after.x;state.pan.y+=before.y-after.y;updateCamera();},{passive:false});
function showHelp(){showDialog('快捷键与原型说明','<p>这是 MapDesigner 的交互设计原型。编辑仅保留在当前页面；导出可以下载本次示例。</p><div class="shortcut-list"><span>选择 / 平移</span><span><kbd>V</kbd> <kbd>H</kbd></span><span>笔刷 / 河流 / 多选</span><span><kbd>B</kbd> <kbd>R</kbd> <kbd>M</kbd></span><span>临时平移</span><kbd>Space + 拖动</kbd><span>适合画布</span><kbd>F</kbd><span>应用单格属性</span><kbd>⌘/Ctrl Enter</kbd><span>画布操作 / 添加河流路径点</span><span><kbd>Enter</kbd> <kbd>Shift Enter</kbd></span><span>完成河流 / 返回编辑</span><span><kbd>Enter</kbd> <kbd>Esc</kbd></span><span>撤销 / 重做</span><span><kbd>⌘/Ctrl Z</kbd> <kbd>+ Shift</kbd></span></div><p>原型笔刷使用简化规则。正式版需接入地图校验、持久历史和异步提交。</p>',[{label:'开始体验',primary:true}]);}
function exportedSvg(transparent=false,zoom=1){const clone=canvas.cloneNode(true);clone.setAttribute('viewBox','0 0 1100 850');clone.setAttribute('width',1100*zoom);clone.setAttribute('height',850*zoom);clone.removeAttribute('tabindex');clone.querySelector('#selectionLayer')?.remove();clone.querySelector('#draftRiverLayer')?.remove();clone.querySelectorAll('[data-river]').forEach(n=>n.remove());clone.querySelectorAll('[data-cell]').forEach(n=>{n.setAttribute('stroke','#577460');n.setAttribute('stroke-opacity',$('showGrid').checked?'.17':'0');n.setAttribute('stroke-width','.65');n.removeAttribute('class');n.removeAttribute('role');n.removeAttribute('tabindex');});clone.querySelectorAll('.sea-label').forEach(n=>{n.setAttribute('fill','#5e7e7e');n.setAttribute('font-size','16');n.setAttribute('font-family','serif');n.setAttribute('letter-spacing','6');});clone.querySelectorAll('.land-label').forEach(n=>{n.setAttribute('fill','#3a503e');n.setAttribute('font-size',n.classList.contains('small')?'13':'17');n.setAttribute('font-family','serif');n.setAttribute('letter-spacing','3');});for(const [control,id] of [['showBiomes','biomeLayer'],['showRivers','riverLayer'],['showNames','labelLayer']]){if(!$(control).checked)clone.querySelector('#'+id)?.remove();}if(transparent)clone.querySelectorAll(':scope > rect').forEach(n=>n.remove());
  // Namespace the copy so the export preview never duplicates live editor IDs.
  for(const el of [clone,...clone.querySelectorAll('*')]){
    if(el.id)el.id='export-'+el.id;
    for(const attr of [...el.attributes]){
      if(attr.value.includes('url(#'))el.setAttribute(attr.name,attr.value.replaceAll('url(#','url(#export-'));
    }
    el.removeAttribute('data-cell');
  }
  clone.setAttribute('role','img');
  clone.setAttribute('aria-label','示例地图导出预览');
  return clone;
}
function download(blob,name){const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download=name;link.click();setTimeout(()=>URL.revokeObjectURL(url),1000);}
function openExport(){showDialog('导出示例地图','<div class="export-preview" id="exportPreview"></div><div class="two-fields"><label class="field"><span>文件格式</span><select id="exportFormat"><option value="png">PNG 图片</option><option value="svg">SVG 矢量图</option></select></label><label class="field"><span>输出尺寸</span><select id="exportScale"><option value="1">1100 × 850</option><option value="2">2200 × 1700</option></select></label></div><label class="checkbox-field"><input type="checkbox" id="transparentExport">透明背景</label><div class="export-facts"><span>范围：整个示例</span><span id="pixelBudget">0.94 百万像素</span></div><p class="field-help">按当前图层显示设置导出，预览选框不会出现在图片中。</p>',[{label:'取消'},{label:'下载示例',primary:true,run:exportMap}]);$('exportPreview').append(exportedSvg());$('exportScale').onchange=e=>{$('pixelBudget').textContent=(.935*Number(e.target.value)**2).toFixed(2)+' 百万像素';};}
async function exportMap(){const format=$('exportFormat').value,scale=Number($('exportScale').value),svg=exportedSvg($('transparentExport').checked,scale);const blob=new Blob([new XMLSerializer().serializeToString(svg)],{type:'image/svg+xml;charset=utf-8'});if(format==='svg'){download(blob,'北境群岛-示例.svg');notify('已下载示例 SVG');return;}notify('正在生成示例 PNG…');const url=URL.createObjectURL(blob);try{const image=new Image();await new Promise((resolve,reject)=>{image.onload=resolve;image.onerror=reject;image.src=url;});const output=document.createElement('canvas');output.width=1100*scale;output.height=850*scale;output.getContext('2d').drawImage(image,0,0,output.width,output.height);const png=await new Promise(resolve=>output.toBlob(resolve,'image/png'));if(!png)throw new Error('PNG encoding failed');download(png,'北境群岛-示例.png');notify('已下载示例 PNG');}catch{notify('导出失败，请尝试 SVG 格式');}finally{URL.revokeObjectURL(url);}}
document.querySelectorAll('.tool[data-tool]').forEach(b=>b.onclick=()=>chooseTool(b.dataset.tool));document.querySelector('[role=toolbar]').addEventListener('keydown',e=>{if(!['ArrowUp','ArrowDown','Home','End'].includes(e.key))return;e.preventDefault();const buttons=[...document.querySelectorAll('.tool[data-tool]')];let i=buttons.indexOf(document.activeElement);i=e.key==='Home'?0:e.key==='End'?buttons.length-1:(i+(e.key==='ArrowDown'?1:-1)+buttons.length)%buttons.length;buttons[i].focus();});
$('undo').onclick=()=>moveHistory('undo');$('redo').onclick=()=>moveHistory('redo');$('zoomIn').onclick=()=>zoomBy(1.25);$('zoomOut').onclick=()=>zoomBy(.8);$('fitMap').onclick=()=>{state.zoom=1;state.pan={x:0,y:0};updateCamera();};
$('layersButton').onclick=()=>{editor.classList.toggle('layers-closed');if(innerWidth<=900&&!editor.classList.contains('layers-closed'))editor.classList.add('inspector-closed');editor.classList.remove('focus-mode');syncDrawers();};$('closeLayers').onclick=()=>{editor.classList.add('layers-closed');syncDrawers();$('layersButton').focus();};$('inspectorButton').onclick=()=>{openInspector();$('closeInspector').focus();};$('closeInspector').onclick=()=>{editor.classList.add('inspector-closed');syncDrawers();$('inspectorButton').focus();};$('drawerScrim').onclick=()=>{editor.classList.add('layers-closed','inspector-closed');syncDrawers();};
$('historyButton').onclick=()=>{state.showHistory=!state.showHistory;openInspector();renderInspector();};$('helpButton').onclick=showHelp;$('themeButton').onclick=()=>{const dark=document.documentElement.dataset.theme!=='dark';document.documentElement.dataset.theme=dark?'dark':'light';$('themeButton').setAttribute('aria-label',dark?'切换浅色界面':'切换深色界面');$('themeButton').innerHTML='<i data-icon="'+(dark?'sun':'moon')+'"></i>';hydrateIcons($('themeButton'));};$('focusButton').onclick=()=>{editor.classList.toggle('focus-mode');$('focusButton').setAttribute('aria-pressed',String(editor.classList.contains('focus-mode')));syncDrawers();};
$('fileMenuButton').onclick=()=>{$('fileMenu').hidden=!$('fileMenu').hidden;$('fileMenuButton').setAttribute('aria-expanded',String(!$('fileMenu').hidden));};document.addEventListener('click',e=>{if(!e.target.closest('.document-title,.file-menu')){$('fileMenu').hidden=true;$('fileMenuButton').setAttribute('aria-expanded','false');}});
$('renameButton').onclick=()=>{$('fileMenu').hidden=true;showDialog('重命名地图','<label class="field"><span>地图名称</span><input id="newMapName" value="'+esc($('mapName').textContent)+'" maxlength="80"></label>',[{label:'取消'},{label:'应用名称',primary:true,run:()=>{const name=$('newMapName').value.trim();if(!name){notify('地图名称不能为空');return;}const before=cloneData();setMapName(name);commit('重命名地图',before);notify('名称已应用，可撤销');}}]);};$('resetButton').onclick=()=>{showDialog('重新载入示例','<p>这会清除本次预览中的修改，并恢复初始示例地图。</p>',[{label:'继续编辑'},{label:'重新载入',primary:true,run:()=>location.reload()}]);};
for(const [control,id] of [['showBiomes','biomeLayer'],['showRivers','riverLayer'],['showNames','labelLayer']])$(control).onchange=e=>{$(id).style.display=e.target.checked?'':'none';};$('showGrid').onchange=e=>canvas.classList.toggle('hide-grid',!e.target.checked);document.querySelectorAll('[data-filter]').forEach(b=>b.onclick=()=>{state.filter=state.filter===b.dataset.filter?null:b.dataset.filter;updateFilter();});$('clearFilter').onclick=()=>{state.filter=null;updateFilter();};function updateFilter(){document.querySelectorAll('[data-filter]').forEach(b=>b.setAttribute('aria-pressed',String(b.dataset.filter===state.filter)));renderCells();}
$('exportButton').onclick=()=>requestAction(openExport);$('dialogClose').onclick=()=>$('dialog').close();$('dialogForm').onsubmit=e=>{e.preventDefault();};
// Keep native button Space/Enter behavior and expose canvas navigation as one tab stop.
document.addEventListener('keydown', e => {
  const typing=e.target.matches('input,textarea,select,[contenteditable=true]');
  if($('dialog').open)return;
  if((e.metaKey||e.ctrlKey)&&e.key==='Enter'){
    e.preventDefault();
    if(state.selectionKind==='cell'&&['select','pan'].includes(state.tool))applyCell();
    return;
  }
  if(typing)return;
  const onCanvas=!!e.target.closest('#mapCanvas');
  if(e.code==='Space'&&onCanvas){
    e.preventDefault();state.space=true;$('canvasArea').classList.add('space-pan');return;
  }
  if((e.metaKey||e.ctrlKey)&&e.key.toLowerCase()==='z'){e.preventDefault();moveHistory(e.shiftKey?'redo':'undo');return;}
  if(e.metaKey||e.ctrlKey||e.altKey)return;
  const tool={v:'select',h:'pan',b:'paint',r:'river',m:'batch'}[e.key.toLowerCase()];
  if(tool){e.preventDefault();chooseTool(tool);return;}
  if(e.key==='f'||e.key==='F')$('fitMap').click();
  if(e.key==='?')showHelp();
  if(e.key==='Escape'){
    if(state.riverPoints.length||state.dirty){requestAction(()=>setToolNow('select'));}
    else if(innerWidth<=900){editor.classList.add('layers-closed','inspector-closed');syncDrawers();$('inspectorButton').focus();}
    else chooseTool('select');
  }
  if(!onCanvas||!state.selected)return;
  if(e.key==='Enter'){
    e.preventDefault();
    const cell=state.cells.get(state.selected);
    if(state.tool==='river'){
      if(e.shiftKey){if(state.riverPoints.at(-1)?.id!==cell.id)state.riverPoints.push({...cell});renderAll();}
      else finishRiver();
    }else if(state.tool==='batch'){state.batch.has(cell.id)?state.batch.delete(cell.id):state.batch.add(cell.id);renderAll();}
    else if(state.tool==='paint'){const before=cloneData();pointer={changed:false};paint(cell);const changed=pointer.changed;pointer=null;if(changed)commit('笔刷绘制地形',before);}
    else{openInspector();$('closeInspector').focus();}
    return;
  }
  if(['ArrowUp','ArrowDown','ArrowLeft','ArrowRight'].includes(e.key)){
    e.preventDefault();
    const c=state.cells.get(state.selected),d={ArrowUp:[-1,0],ArrowDown:[1,0],ArrowLeft:[0,-1],ArrowRight:[0,1]}[e.key];
    const id=(c.row+d[0])+','+(c.col+d[1]);
    if(!state.cells.has(id))return;
    if(['select','pan'].includes(state.tool))chooseCell(id);
    else{state.selected=id;renderAll();}
    if(!$('dialog').open)canvas.focus();
  }
});
document.addEventListener('keyup',e=>{if(e.code==='Space'){state.space=false;$('canvasArea').classList.remove('space-pan');}});window.addEventListener('blur',()=>{state.space=false;$('canvasArea').classList.remove('space-pan');});
const compact=matchMedia('(max-width:1100px)'),narrow=matchMedia('(max-width:900px)');function adapt(){editor.classList.toggle('layers-closed',compact.matches);editor.classList.toggle('inspector-closed',narrow.matches);syncDrawers();}compact.addEventListener('change',adapt);narrow.addEventListener('change',adapt);
generateMap();hydrateIcons();renderAll();adapt();updateCamera();
