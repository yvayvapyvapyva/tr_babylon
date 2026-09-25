/*
 * editor.js — модуль редактирования площадки: установка, перемещение и удаление
 * конусов и разметки, режимы, палитра объектов (галерея и живые 3D-превью),
 * джойстик перемещения камеры, окно настроек карты, сохранение и столкновения.
 *
 * Подключается классическим <script> ПОСЛЕ основного inline-скрипта index.html.
 * Классические скрипты делят глобальную лексическую область, поэтому:
 *   — читает из главного скрипта: scene, engine, BABYLON, canvas, camera, TERR,
 *     car, CAR, heading, speed, grid, axes, openSettings, rebuildTerritory,
 *     shadowGen, updateMirrorRenderList;
 *   — объявляет здесь общие состояния (coneNodes, occupied, mode, conesEnabled,
 *     editType, panState, THUMBS ...) и функции (setMode, setEditType, panApply,
 *     openMapEdit, openTypeWin, clearCones, checkCollisions ...), которые главный
 *     скрипт вызывает из цикла рендера и closeAllWindows.
 */

const STEP=0.25;
let HALFX=(typeof TERR!=='undefined'&&TERR)?TERR.w/2:50;
let HALFZ=(typeof TERR!=='undefined'&&TERR)?TERR.d/2:50;
const snapX=v=>Math.max(-HALFX,Math.min(HALFX,Math.round(v/STEP)*STEP));
const snapZ=v=>Math.max(-HALFZ,Math.min(HALFZ,Math.round(v/STEP)*STEP));
function setTerritoryLimits(hw,hd){HALFX=hw;HALFZ=hd;}
const key=(x,z)=>`${x.toFixed(2)},${z.toFixed(2)}`;
const coneNodes=[];const occupied=new Set();const countEl=document.getElementById('count');
const baseMat=new BABYLON.StandardMaterial('bm',scene);baseMat.diffuseColor=new BABYLON.Color3(0.85,0.26,0.08);baseMat.specularColor=new BABYLON.Color3(0,0,0);
const coneBodyMat=new BABYLON.StandardMaterial('bdc',scene);coneBodyMat.diffuseColor=new BABYLON.Color3(1,0.43,0);coneBodyMat.specularColor=new BABYLON.Color3(0,0,0);
const stripeMat=new BABYLON.StandardMaterial('sm',scene);stripeMat.diffuseColor=new BABYLON.Color3(1,1,1);stripeMat.specularColor=new BABYLON.Color3(0,0,0);
function createCone(){const node=new BABYLON.TransformNode('cone',scene);node.rotationQuaternion=BABYLON.Quaternion.Identity();
  const base=BABYLON.MeshBuilder.CreateBox('cb',{width:0.25,depth:0.25,height:0.035},scene);
  base.parent=node;base.position.y=0.0175;base.material=baseMat;base.metadata={isCone:true};
  const body=BABYLON.MeshBuilder.CreateCylinder('cbd',{diameterTop:0.04,diameterBottom:0.19,height:0.45,tessellation:24},scene);
  body.parent=node;body.position.y=0.26;body.material=coneBodyMat;body.metadata={isCone:true};
  const stripe=BABYLON.MeshBuilder.CreateCylinder('cs',{diameterTop:0.10,diameterBottom:0.14,height:0.11,tessellation:24},scene);
  stripe.parent=node;stripe.position.y=0.255;stripe.material=stripeMat;stripe.metadata={isCone:true};
  [base,body,stripe].forEach(m=>shadowGen.addShadowCaster(m));
  coneNodes.push(node);return node;}
function addConeAt(x,z){const k=key(x,z);if(occupied.has(k))return;occupied.add(k);
  const n=createCone();n.position.set(x,0,z);n.userData={cellKey:k,knocked:false};updateCount();saveCones();
  if(typeof updateMirrorRenderList==='function')updateMirrorRenderList();}
function deleteCone(n){occupied.delete(n.userData.cellKey);
  n.getChildMeshes().forEach(m=>shadowGen.removeShadowCaster(m));
  const i=coneNodes.indexOf(n);if(i>=0)coneNodes.splice(i,1);n.dispose();updateCount();saveCones();
  if(typeof updateMirrorRenderList==='function')updateMirrorRenderList();}
function clearCones(){[...coneNodes].forEach(deleteCone);}
function updateCount(){countEl.textContent=coneNodes.length;}

// ── сохранение конусов в localStorage ─────────────
const STORE_KEY='tr_babylon_cones';
function saveCones(){try{localStorage.setItem(STORE_KEY,JSON.stringify(
  coneNodes.map(n=>[Math.round(n.position.x*1e4)/1e4,Math.round(n.position.z*1e4)/1e4])));}catch(e){}}
function loadCones(){try{const data=JSON.parse(localStorage.getItem(STORE_KEY)||'[]');
  if(Array.isArray(data))data.forEach(([x,z])=>{if(typeof x==='number'&&typeof z==='number')addConeAt(x,z);});}catch(e){}}

// ── белая разметка (линии) ──────────────────────────────────
const STORE_KEY_MARK='tr_babylon_markings';
const countLinesEl=document.getElementById('countLines');
const finishLineBtn=document.getElementById('finishLineBtn');
const lineWidth=0.1,lineH=0.006,lineY=lineH/2+0.0012;
const lineMat=new BABYLON.StandardMaterial('lm',scene);
lineMat.diffuseColor=new BABYLON.Color3(1,1,1);
lineMat.specularColor=new BABYLON.Color3(0.15,0.15,0.15);
const prevLineMat=new BABYLON.StandardMaterial('lpm',scene);
prevLineMat.diffuseColor=new BABYLON.Color3(1,1,1);
prevLineMat.alpha=0.55;
prevLineMat.specularColor=new BABYLON.Color3(0,0,0);
const previewSeg=BABYLON.MeshBuilder.CreateBox('linePrev',{width:lineWidth,height:lineH,depth:1},scene);
previewSeg.material=prevLineMat;previewSeg.isVisible=false;previewSeg.isPickable=false;
const markings=[];       // массивы точек [[x,z],...] по линиям
const linePolyMeshes=[]; // параллельно: меши сегментов каждой линии
let openLine=null;       // текущая открытая полилиния {pts,meshes}
function makeLineSegment(a,b){
  const ax=a[0],az=a[1],bx=b[0],bz=b[1];
  const dx=bx-ax,dz=bz-az;
  const L=Math.hypot(dx,dz);
  if(L<1e-4)return null;
  const seg=BABYLON.MeshBuilder.CreateBox('lineSeg',{width:lineWidth,height:lineH,depth:L},scene);
  seg.position.set((ax+bx)/2,lineY,(az+bz)/2);
  seg.rotation.y=Math.atan2(dx,dz);
  seg.material=lineMat;
  seg.isPickable=true;
  seg.receiveShadows=true;
  seg.metadata={isLine:true};
  return seg;
}
function updateLineCount(){if(countLinesEl)countLinesEl.textContent=markings.length;syncFinishBtn();}
function syncFinishBtn(){if(finishLineBtn)finishLineBtn.style.display=(editType==='lines'&&mode==='place'&&openLine)?'':'none';}
function updateLinePreview(){
  if(!openLine)return;
  const last=openLine.pts[openLine.pts.length-1];
  const p=pickGround();
  if(p.hit&&last){
    const sx=snapX(p.pickedPoint.x),sz=snapZ(p.pickedPoint.z);
    const dx=sx-last[0],dz=sz-last[1];
    const L=Math.hypot(dx,dz);
    if(L>1e-4){
      previewSeg.position.set((sx+last[0])/2,lineY,(sz+last[1])/2);
      previewSeg.scaling.set(1,1,L);
      previewSeg.rotation.y=Math.atan2(dx,dz);
      previewSeg.isVisible=true;
    }else previewSeg.isVisible=false;
  }else previewSeg.isVisible=false;
}
function hideLinePreview(){previewSeg.isVisible=false;}
function startOpenLine(){openLine={pts:[],meshes:[]};syncFinishBtn();}
function addLinePoint(x,z){
  if(!openLine)startOpenLine();
  const last=openLine.pts[openLine.pts.length-1];
  if(last&&last[0]===x&&last[1]===z)return;
  openLine.pts.push([x,z]);
  if(last){const s=makeLineSegment(last,[x,z]);if(s)openLine.meshes.push(s);}
  updateLinePreview();
}
function finishLine(){
  if(!openLine)return;
  if(openLine.pts.length>=2){
    markings.push(openLine.pts);
    linePolyMeshes.push(openLine.meshes);
    updateLineCount();
  }else{
    openLine.meshes.forEach(m=>{try{m.dispose();}catch(e){}});
  }
  openLine=null;
  hideLinePreview();
  syncFinishBtn();
  saveMarkings();
  if(typeof updateMirrorRenderList==='function')updateMirrorRenderList();
}
function saveMarkings(){try{localStorage.setItem(STORE_KEY_MARK,JSON.stringify(markings));}catch(e){}}
function pushPolyline(pts){
  const meshes=[];
  for(let i=1;i<pts.length;i++){const s=makeLineSegment(pts[i-1],pts[i]);if(s)meshes.push(s);}
  markings.push(pts);
  linePolyMeshes.push(meshes);
}
function loadMarkings(){try{const d=JSON.parse(localStorage.getItem(STORE_KEY_MARK)||'[]');
  if(Array.isArray(d))d.forEach(poly=>{
    if(!Array.isArray(poly)||poly.length<2)return;
    const pts=poly.filter(p=>Array.isArray(p)&&p.length===2&&typeof p[0]==='number'&&typeof p[1]==='number');
    if(pts.length>=2)pushPolyline(pts);
  });
  updateLineCount();}catch(e){}}
function deletePolylineFromMesh(mesh){
  for(let i=0;i<linePolyMeshes.length;i++){
    if(linePolyMeshes[i].includes(mesh)){
      linePolyMeshes[i].forEach(m=>{try{m.dispose();}catch(e){}});
      linePolyMeshes.splice(i,1);
      markings.splice(i,1);
      updateLineCount();saveMarkings();
      if(typeof updateMirrorRenderList==='function')updateMirrorRenderList();
      return;
    }
  }
}
function clearLines(){
  finishLine();
  markings.length=0;
  linePolyMeshes.forEach(arr=>arr.forEach(m=>{try{m.dispose();}catch(e){}}));
  linePolyMeshes.length=0;
  updateLineCount();saveMarkings();
  if(typeof updateMirrorRenderList==='function')updateMirrorRenderList();
}
if(finishLineBtn)finishLineBtn.addEventListener('click',finishLine);

const preview=BABYLON.MeshBuilder.CreateTorus('preview',{diameter:0.4,thickness:0.04,tessellation:28},scene);
const prevMat=new BABYLON.StandardMaterial('pm',scene);
prevMat.diffuseColor=new BABYLON.Color3(1,0.43,0);prevMat.emissiveColor=new BABYLON.Color3(1,0.43,0);
prevMat.alpha=0.85;prevMat.specularColor=new BABYLON.Color3(0,0,0);
preview.material=prevMat;preview.position.y=0.05;preview.isVisible=false;preview.isPickable=false;

let mode='place',dragging=null,dragOldKey=null,conesEnabled=false;
const hintline=document.getElementById('hintline');
const HINTS={place:'Клик по площадке — поставить конус (шаг 0,25 м)',
  move:'Зажми конус и перетащи в новый узел',delete:'Клик по конусу или линии — удалить'};
const HINTS_LINES={place:'Кликай по площадке: точки соединяются в белую линию. «Завершить линию» — начать новую',
  move:'Перемещение линий не поддерживается',delete:'Клик по линии — удалить'};
const CURSORS={place:'crosshair',move:'grab',delete:'pointer'};
let editType='cones';
const editTypeSel=document.getElementById('editTypeSel');
const typeIco=document.getElementById('typeIco');
const TYPE_ICONS={
  cones:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6 15.8 21H8.2Z" fill="#ff8c3b" stroke="#1a1200" stroke-width="1.1" stroke-linejoin="round"/><ellipse cx="12" cy="14.4" rx="2.4" ry="1.1" fill="#fff" stroke="#1a1200" stroke-width=".8"/></svg>',
  lines:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="10.3" width="4" height="1.7" rx=".85" fill="#fff"/><rect x="10" y="10.3" width="4" height="1.7" rx=".85" fill="#fff"/><rect x="17" y="10.3" width="4" height="1.7" rx=".85" fill="#fff"/></svg>'
};
function setEditType(t){
  if(editType==='lines'&&t!=='lines')finishLine();
  editType=t;
  if(editTypeSel)editTypeSel.value=t;
  if(typeIco)typeIco.innerHTML=(THUMBS[t]?'<img src="'+THUMBS[t]+'" alt="">':(TYPE_ICONS[t]||''));
  if(t==='lines'&&mode==='move')setMode('place');
  else setMode(mode);
  if(typeof updatePanelLive==='function'&&typeof panelLive!=='undefined'&&panelLive.started)updatePanelLive();
}
if(editTypeSel){editTypeSel.addEventListener('change',()=>{if(!conesEnabled)return;setEditType(editTypeSel.value);});}
function setMode(m){
  finishLine();
  mode=m;
  document.querySelectorAll('#editModes button').forEach(b=>b.classList.toggle('active',b.dataset.mode===m));
  hintline.textContent=editType==='lines'?HINTS_LINES[mode]:HINTS[mode];
  canvas.style.cursor=CURSORS[mode];preview.isVisible=false;
  document.getElementById('editModes').classList.toggle('lines',editType==='lines'&&mode==='move');
  syncFinishBtn();
}
document.querySelectorAll('#editModes button').forEach(b=>b.addEventListener('click',()=>{if(!conesEnabled)return;setMode(b.dataset.mode)}));
document.getElementById('mapClearAll').addEventListener('click',()=>{clearCones();clearLines();});

function carHits(px,pz){
  const dx=px-car.position.x,dz=pz-car.position.z;
  const c=Math.cos(heading),s=Math.sin(heading);
  const lx=dx*c-dz*s,lz=dx*s+dz*c;
  return Math.abs(lx)<=CAR.width/2 && Math.abs(lz)<=CAR.length/2;}
// Конусы, которые отлетают после удара (лёгкая физика снаряда)
const flying=[];
const fixRestY=0.4,lyingY=0.12;
function knockCone(node,carPos){
  const ud=node.userData;ud.knocked=true;
  const d=node.position.subtract(carPos);d.y=0;
  const dl=d.length();
  let dir;
  if(dl<1e-6)dir=new BABYLON.Vector3(Math.sin(heading),0,Math.cos(heading));
  else dir=d.scale(1/dl);
  // импульс от направления движения машины + разлёт вбок относительно удара
  const sign=Math.sign(speed)||1;
  const mv=new BABYLON.Vector3(Math.sin(heading),0,Math.cos(heading));
  const lat=new BABYLON.Vector3(Math.cos(heading),0,-Math.sin(heading));
  const power=1.6+Math.abs(speed)*0.9;
  const latDot=BABYLON.Vector3.Dot(lat,dir);
  ud.vel=mv.scale(power*0.75*sign)
    .add(lat.scale(latDot*power))
    .add(new BABYLON.Vector3(0,power*0.6+Math.random()*0.3,0));
  ud.ang=Math.random()*Math.PI*2;
  ud.spin=(Math.random()*8+5)*((Math.random()<0.5)?1:-1);
  node.position.y=fixRestY;
  flying.push(node);
}
function landCone(n){
  const ud=n.userData;ud.vel=null;
  const ra=Math.random()*Math.PI*2;
  n.rotationQuaternion=BABYLON.Quaternion.RotationAxis(
    new BABYLON.Vector3(Math.cos(ra),0,Math.sin(ra)),Math.PI/2*(0.9+Math.random()*0.2));
  n.position.y=lyingY;
}
function updateFlights(dt){
  if(!flying.length)return;
  for(let i=flying.length-1;i>=0;i--){
    const n=flying[i],ud=n.userData;if(!ud||!ud.vel)continue;
    const v=ud.vel;
    const drag=Math.max(0,1-0.9*dt);
    v.x*=drag;v.z*=drag;
    v.y-=9.8*dt;
    ud.ang+=ud.spin*dt;
    n.position.addInPlace(v.scale(dt));
    // кувыркание вокруг поперечной оси полёта + лёгкое вращение
    const hl=Math.sqrt(v.x*v.x+v.z*v.z);
    const axis=(hl>0.1)?new BABYLON.Vector3(-v.z/hl,0,v.x/hl):new BABYLON.Vector3(1,0,0);
    n.rotationQuaternion=BABYLON.Quaternion.RotationAxis(axis,ud.ang)
      .multiply(BABYLON.Quaternion.RotationAxis(BABYLON.Axis.Y,ud.ang*0.35));
    if(n.position.y<=0.1&&v.y<=0){
      n.position.y=0.1;
      if(v.y<-0.4){v.y=-v.y*0.35;v.x*=0.55;v.z*=0.55;}
      else{v.y=0;v.x*=0.7;v.z*=0.7;}
      if(Math.abs(v.x)<0.12&&Math.abs(v.z)<0.12&&Math.abs(v.y)<0.15){
        landCone(n);flying.splice(i,1);
      }
    }
  }
}
function checkCollisions(){for(const node of coneNodes){const ud=node.userData;
  if(!ud||ud.knocked||node===dragging)continue;
  if(carHits(node.position.x,node.position.z))knockCone(node,car.position);}}

const pickGround=()=>scene.pick(scene.pointerX,scene.pointerY,m=>m.name==='ground');
const pickCone=()=>scene.pick(scene.pointerX,scene.pointerY,m=>m.metadata&&m.metadata.isCone);
const pickLine=()=>scene.pick(scene.pointerX,scene.pointerY,m=>m.metadata&&m.metadata.isLine);
scene.onPointerObservable.add(pi=>{const t=pi.type;
  if(!conesEnabled)return;
  if(t===BABYLON.PointerEventTypes.POINTERMOVE){
    const p=pickGround();
    if(p.hit){
      const sx=snapX(p.pickedPoint.x),sz=snapZ(p.pickedPoint.z);
      preview.position.set(sx,0.05,sz);
      preview.isVisible=(mode==='place')||!!dragging;
      if(dragging)dragging.position.set(sx,0,sz);
      if(editType==='lines'&&mode==='place')updateLinePreview();else hideLinePreview();
    }else{
      preview.isVisible=false;
      hideLinePreview();
    }
  }
  else if(t===BABYLON.PointerEventTypes.POINTERDOWN){
    if(mode==='move'){const c=pickCone();
      if(c.hit){dragging=c.pickedMesh.parent;const ud=dragging.userData;
        const fi=flying.indexOf(dragging);if(fi>=0)flying.splice(fi,1);
        if(ud.vel)ud.vel=null;
        dragging.rotationQuaternion=BABYLON.Quaternion.Identity();ud.knocked=false;
        dragOldKey=ud.cellKey;occupied.delete(dragOldKey);
        camera.detachControl();canvas.style.cursor='grabbing';}}
  }
  else if(t===BABYLON.PointerEventTypes.POINTERUP){
    if(dragging){const x=snapX(dragging.position.x),z=snapZ(dragging.position.z),k=key(x,z);
      const ud=dragging.userData;
      if(occupied.has(k)){const[ox,oz]=dragOldKey.split(',').map(Number);
        dragging.position.set(ox,0,oz);occupied.add(dragOldKey);ud.cellKey=dragOldKey;}
      else{dragging.position.set(x,0,z);occupied.add(k);ud.cellKey=k;}
      updateCount();saveCones();
      dragging=null;camera.attachControl(canvas,true);canvas.style.cursor=CURSORS[mode];}}
  else if(t===BABYLON.PointerEventTypes.POINTERTAP){
    if(dragging)return;
    if(mode==='delete'){
      const c=pickCone();if(c.hit)deleteCone(c.pickedMesh.parent);
      else{const l=pickLine();if(l.hit)deletePolylineFromMesh(l.pickedMesh);}
    }
    else if(mode==='place'){const p=pickGround();if(p.hit){
      const px=snapX(p.pickedPoint.x),pz=snapZ(p.pickedPoint.z);
      if(editType==='lines')addLinePoint(px,pz);else addConeAt(px,pz);}}
  }
});

function setConesEnabled(on){
  if(!on)finishLine();
  conesEnabled=on;
  document.querySelectorAll('.modes').forEach(el=>el.classList.toggle('disabled',!on));
  if(editTypeSel){editTypeSel.disabled=!on;}
  if(document.getElementById('editType'))document.getElementById('editType').classList.toggle('disabled',!on);
  preview.isVisible=false;
  hintline.textContent=on?(editType==='lines'?HINTS_LINES[mode]:HINTS[mode]):'Режим редактирования карты выключен';
  if(on)setMode(mode);
}
document.querySelectorAll('.modes').forEach(el=>el.classList.add('disabled'));
document.getElementById('editType').classList.add('disabled');
hintline.textContent='Режим редактирования карты выключен';

// ════════════════════════════════════════════════════════════════════════════
// Модуль редактора: окна, джойстик, миниатюры и живые 3D-превью.
// Перенесено сюда из главного inline-скрипта index.html.
// ════════════════════════════════════════════════════════════════════════════

// ── Окно настроек карты ─────────────────────────────
const mapWin=document.getElementById('mapWin');
const mapBackdrop=document.getElementById('mapBackdrop');
function openMapWin(o){mapWin.classList.toggle('open',o);mapBackdrop.classList.toggle('open',o);}
document.getElementById('mapCfgBtn').addEventListener('click',()=>openMapWin(true));
document.getElementById('mapCfgClose').addEventListener('click',()=>openMapWin(false));
mapBackdrop.addEventListener('click',()=>openMapWin(false));

// ── Включение/выключение режима редактирования ──────
const mapBtn=document.getElementById('mapBtn');
const mapEdit=document.getElementById('mapEdit');
function openMapEdit(o){
  document.body.classList.toggle('edit-mode',o);
  mapEdit.classList.toggle('open',o);
  setConesEnabled(o);
  grid.isVisible=o;axes.isVisible=o;
  if(o){updatePanelLive();}
  else{stopPanelLive();}
}
mapBtn.addEventListener('click',()=>{
  openSettings(false);
  openMapEdit(true);
});
document.getElementById('mapDone').addEventListener('click',()=>openMapEdit(false));

// ── Применение нового размера площадки ──────────────
const terrWEl=document.getElementById('terrW'),terrDEl=document.getElementById('terrD');
function syncTerrInputs(){if(terrWEl)terrWEl.value=TERR.w;if(terrDEl)terrDEl.value=TERR.d;}
syncTerrInputs();
if(document.getElementById('applyTerr'))document.getElementById('applyTerr').addEventListener('click',()=>{
  rebuildTerritory(parseFloat(terrWEl.value),parseFloat(terrDEl.value));
  syncTerrInputs();
  openMapWin(false);
});

// ── Джойстик перемещения по карте (панорамирование камеры) ─────
const PAN_SPEED=32;
const panState={x:0,z:0};
const joyBase=document.getElementById('joyBase'),joyKnob=document.getElementById('joyKnob');
const JOY_R=30,JOY_RM=32;
let joyActive=false,joyId=-1;
function joySet(px,py){
  const r=joyBase.getBoundingClientRect();
  let dx=(px-(r.left+r.width/2))/JOY_RM,dy=(py-(r.top+r.height/2))/JOY_RM;
  const L=Math.hypot(dx,dy);
  if(L>1){dx/=L;dy/=L;}
  panState.x=dx;panState.z=-dy;
  joyKnob.style.transform='translate(calc(-50% + '+dx*JOY_R+'px),calc(-50% + '+dy*JOY_R+'px))';
}
function joyReset(){panState.x=0;panState.z=0;joyActive=false;joyId=-1;joyKnob.style.transform='translate(-50%,-50%)';joyBase.classList.remove('on');}
if(joyBase){
  joyBase.addEventListener('pointerdown',e=>{e.preventDefault();joyBase.setPointerCapture(e.pointerId);joyActive=true;joyId=e.pointerId;joyBase.classList.add('on');joySet(e.clientX,e.clientY);});
  joyBase.addEventListener('pointermove',e=>{if(joyActive&&e.pointerId===joyId)joySet(e.clientX,e.clientY);});
  joyBase.addEventListener('pointerup',e=>{if(e.pointerId===joyId)joyReset();});
  joyBase.addEventListener('pointercancel',e=>{if(e.pointerId===joyId)joyReset();});
}
window.addEventListener('blur',joyReset);
function panApply(dt){
  if(!panState.x&&!panState.z)return;
  const d=camera.position.subtract(camera.target);
  const f=new BABYLON.Vector3(d.x,0,d.z);
  if(f.lengthSquared()<1e-9)f.set(0,0,-1);
  f.normalize();
  const right=BABYLON.Vector3.Cross(new BABYLON.Vector3(0,1,0),f).normalize();
  camera.target.addInPlace(right.scale(-panState.x*PAN_SPEED*dt).add(f.scale(-panState.z*PAN_SPEED*dt)));
  const mx=TERR.w/2+15,mz=TERR.d/2+15;
  camera.target.x=Math.max(-mx,Math.min(mx,camera.target.x));
  camera.target.z=Math.max(-mz,Math.min(mz,camera.target.z));
}

// ── 3D-миниатюры типов объектов (рендер через RenderTargetTexture в сцене) ──
const THUMBS={cones:null,lines:null};
function thumbCluster(type){
  const R=new BABYLON.TransformNode('thRoot'+type,scene);
  R.position.set(-9999,0,0);
  const cm=new BABYLON.StandardMaterial('thCone'+type,scene);
  cm.diffuseColor=new BABYLON.Color3(1,0.43,0);cm.specularColor=new BABYLON.Color3(0,0,0);
  const sm=new BABYLON.StandardMaterial('thStripe'+type,scene);
  sm.diffuseColor=new BABYLON.Color3(1,1,1);sm.specularColor=new BABYLON.Color3(0.15,0.15,0.15);
  const bm=new BABYLON.StandardMaterial('thBase'+type,scene);
  bm.diffuseColor=new BABYLON.Color3(0.82,0.24,0.07);bm.specularColor=new BABYLON.Color3(0,0,0);
  const gm=new BABYLON.StandardMaterial('thGround'+type,scene);
  gm.diffuseColor=new BABYLON.Color3(0.17,0.18,0.21);gm.specularColor=new BABYLON.Color3(0,0,0);
  const g=BABYLON.MeshBuilder.CreateGround('thG'+type,{width:2,height:2},scene);
  g.parent=R;g.material=gm;
  let cy=0.05;
  if(type==='cones'){
    cy=0.3;
    const base=BABYLON.MeshBuilder.CreateBox('thB'+type,{width:0.25,depth:0.25,height:0.035},scene);
    base.parent=R;base.position.y=0.0175;base.material=bm;
    const body=BABYLON.MeshBuilder.CreateCylinder('thC'+type,{diameterTop:0.04,diameterBottom:0.19,height:0.45,tessellation:24},scene);
    body.parent=R;body.position.y=0.26;body.material=cm;
    const st=BABYLON.MeshBuilder.CreateCylinder('thS'+type,{diameterTop:0.10,diameterBottom:0.14,height:0.11,tessellation:24},scene);
    st.parent=R;st.position.y=0.255;st.material=sm;
  }else{
    const m=BABYLON.MeshBuilder.CreateBox('thL'+type,{width:0.22,height:0.02,depth:0.8},scene);
    m.parent=R;m.position.set(0,0.01,0);m.material=sm;
  }
  return{root:R,cy:cy};
}
function captureThumb(type){
  try{
    const{root,cy}=thumbCluster(type);
    const cam=new BABYLON.ArcRotateCamera('thCam'+type,Math.PI/4,Math.PI/2.6,2.2,
      new BABYLON.Vector3(-9999,cy,0),scene);
    cam.lowerAlphaLimit=Math.PI/4;cam.upperAlphaLimit=Math.PI/4;
    cam.lowerBetaLimit=Math.PI/2.6;cam.upperBetaLimit=Math.PI/2.6;
    cam.lowerRadiusLimit=2.2;cam.upperRadiusLimit=2.2;
    const W=256,H=256;
    const rtt=new BABYLON.RenderTargetTexture('thRtt'+type,{width:W,height:H},scene,false);
    rtt.activeCamera=cam;
    rtt.renderList=root.getChildMeshes();
    const oldClear=scene.clearColor.clone();
    scene.clearColor=new BABYLON.Color4(0.05,0.086,0.125,1);
    try{rtt.render();}catch(e1){}
    scene.clearColor=oldClear;
    try{
      const buf=rtt.readPixels(0,0,W,H);
      const clamped=new Uint8ClampedArray(buf.buffer,buf.byteOffset,buf.byteLength);
      const ic=document.createElement('canvas');ic.width=W;ic.height=H;
      const gc=ic.getContext('2d');
      gc.putImageData(new ImageData(clamped,W,H),0,0);
      THUMBS[type]=ic.toDataURL('image/png');
    }catch(e2){}
    rtt.dispose();cam.dispose();root.dispose();
  }catch(e){}
}
// ── Живые 3D-предпросмотры в галерее объектов ───────────
const livePreviews={};
function ensureLivePreview(type){
  if(livePreviews[type]!==undefined)return livePreviews[type];
  livePreviews[type]=null;
  try{
    const card=document.querySelector('#typeWin .tg-card[data-type="'+type+'"]');
    if(!card)return null;
    const cv=card.querySelector('canvas');
    if(!cv.getContext('webgl')&&!cv.getContext('experimental-webgl'))return null;
    const eng=new BABYLON.Engine(cv,true);
    const s=new BABYLON.Scene(eng);
    s.clearColor=new BABYLON.Color4(0.05,0.086,0.125,1);
    const h=new BABYLON.HemisphericLight('lvH'+type,new BABYLON.Vector3(0.5,1,0.4),s);h.intensity=0.9;
    const d=new BABYLON.DirectionalLight('lvD'+type,new BABYLON.Vector3(-0.5,-1,-0.4),s);d.intensity=0.7;d.position=new BABYLON.Vector3(3,6,2);
    const gm=new BABYLON.StandardMaterial('lvGm'+type,s);
    gm.diffuseColor=new BABYLON.Color3(0.17,0.18,0.21);gm.specularColor=new BABYLON.Color3(0,0,0);
    const g=BABYLON.MeshBuilder.CreateGround('lvG'+type,{width:2,height:2},s);g.material=gm;
    const rot=new BABYLON.TransformNode('lvRot'+type,s);
    let cy=0.08;
    if(type==='cones'){
      cy=0.35;
      const cm=new BABYLON.StandardMaterial('lvCm'+type,s);
      cm.diffuseColor=new BABYLON.Color3(1,0.43,0);cm.specularColor=new BABYLON.Color3(0,0,0);
      const sm=new BABYLON.StandardMaterial('lvSm'+type,s);
      sm.diffuseColor=new BABYLON.Color3(1,1,1);sm.specularColor=new BABYLON.Color3(0.15,0.15,0.15);
      const bm=new BABYLON.StandardMaterial('lvBm'+type,s);
      bm.diffuseColor=new BABYLON.Color3(0.82,0.24,0.07);bm.specularColor=new BABYLON.Color3(0,0,0);
      const base=BABYLON.MeshBuilder.CreateBox('lvB'+type,{width:0.25,depth:0.25,height:0.035},s);
      base.parent=rot;base.position.y=0.0175;base.material=bm;
      const body=BABYLON.MeshBuilder.CreateCylinder('lvC'+type,{diameterTop:0.04,diameterBottom:0.19,height:0.45,tessellation:24},s);
      body.parent=rot;body.position.y=0.26;body.material=cm;
      const st=BABYLON.MeshBuilder.CreateCylinder('lvS'+type,{diameterTop:0.10,diameterBottom:0.14,height:0.11,tessellation:24},s);
      st.parent=rot;st.position.y=0.255;st.material=sm;
    }else{
      const lm=new BABYLON.StandardMaterial('lvLm'+type,s);
      lm.diffuseColor=new BABYLON.Color3(1,1,1);lm.specularColor=new BABYLON.Color3(0.15,0.15,0.15);
      const m=BABYLON.MeshBuilder.CreateBox('lvL'+type,{width:0.22,height:0.02,depth:0.8},s);
      m.parent=rot;m.position.set(0,0.01,0);m.material=lm;
    }
    rot.position.y=cy;
    const cam=new BABYLON.ArcRotateCamera('lvC'+type,Math.PI/4,Math.PI/2.6,2.2,new BABYLON.Vector3(0,cy,0),s);
    cam.lowerAlphaLimit=Math.PI/4;cam.upperAlphaLimit=Math.PI/4;
    cam.lowerBetaLimit=Math.PI/2.6;cam.upperBetaLimit=Math.PI/2.6;
    cam.lowerRadiusLimit=2.2;cam.upperRadiusLimit=2.2;
    s.registerBeforeRender(()=>{rot.rotation.y+=0.016;});
    livePreviews[type]={engine:eng,scene:s,canvas:cv,card:card};
  }catch(e){livePreviews[type]=null;}
  return livePreviews[type];
}
function startLive(type){
  const p=ensureLivePreview(type);if(!p)return;
  p.canvas.classList.add('on');
  const fb=p.card?p.card.querySelector('.tg-fallback'):null;if(fb)fb.style.display='none';
  p.engine.runRenderLoop(()=>p.scene.render());
}
function stopLive(type){
  const p=livePreviews[type];
  if(p){p.engine.stopRenderLoop();p.canvas.classList.remove('on');
    const fb=p.card?p.card.querySelector('.tg-fallback'):null;if(fb)fb.style.display='';}
}
function applyThumbs(){
  const fill=(el,type)=>{if(el&&THUMBS[type])el.innerHTML='<img src="'+THUMBS[type]+'" alt="">';};
  if(typeof typeIco!=='undefined'&&typeIco)fill(typeIco,editType);
  document.querySelectorAll('#typeWin .tg-card').forEach(c=>{const ico=c.querySelector('.tg-fallback');fill(ico,c.dataset.type);});
}
requestAnimationFrame(()=>requestAnimationFrame(()=>{
  try{captureThumb('cones');captureThumb('lines');applyThumbs();}catch(e){}
}));

// ── Окно-галерея объектов ───────────────────────────
const typeWin=document.getElementById('typeWin');
const typeBackdrop=document.getElementById('typeBackdrop');
function openTypeWin(o){
  typeWin.classList.toggle('open',o);
  typeBackdrop.classList.toggle('open',o);
  if(o){startLive('cones');startLive('lines');}
  else{stopLive('cones');stopLive('lines');}
}
document.getElementById('editTypeBtn').addEventListener('click',()=>{if(!conesEnabled)return;openTypeWin(true);});
document.getElementById('typeClose').addEventListener('click',()=>openTypeWin(false));
typeBackdrop.addEventListener('click',()=>openTypeWin(false));
document.querySelectorAll('#typeWin .tg-card').forEach(c=>c.addEventListener('click',()=>{
  if(!conesEnabled)return;
  setEditType(c.dataset.type);
  openTypeWin(false);
}));

// ── Живой 3D-предпросмотр в кнопке панели редактора ─────
const panelLive={eng:null,scene:null,root:null,node:null,started:false};
function panelLiveEnsure(){
  if(panelLive.eng)return true;
  try{
    const cv=document.getElementById('panelLiveCanvas');
    if(!cv)return false;
    if(!cv.getContext('webgl')&&!cv.getContext('experimental-webgl'))return false;
    const eng=new BABYLON.Engine(cv,true);
    const s=new BABYLON.Scene(eng);
    s.clearColor=new BABYLON.Color4(0.06,0.1,0.14,0);
    const h=new BABYLON.HemisphericLight('plH',new BABYLON.Vector3(0.5,1,0.4),s);h.intensity=0.9;
    const d=new BABYLON.DirectionalLight('plD',new BABYLON.Vector3(-0.5,-1,-0.4),s);d.intensity=0.7;d.position=new BABYLON.Vector3(3,6,2);
    const gm=new BABYLON.StandardMaterial('plGm',s);
    gm.diffuseColor=new BABYLON.Color3(0.17,0.18,0.21);gm.specularColor=new BABYLON.Color3(0,0,0);
    const g=BABYLON.MeshBuilder.CreateGround('plG',{width:2,height:2},s);g.material=gm;
    const root=new BABYLON.TransformNode('plRoot',s);
    const cam=new BABYLON.ArcRotateCamera('plC',Math.PI/4,Math.PI/2.6,2.2,new BABYLON.Vector3(0,0.3,0),s);
    cam.lowerAlphaLimit=Math.PI/4;cam.upperAlphaLimit=Math.PI/4;
    cam.lowerBetaLimit=Math.PI/2.6;cam.upperBetaLimit=Math.PI/2.6;
    cam.lowerRadiusLimit=2.2;cam.upperRadiusLimit=2.2;
    s.registerBeforeRender(()=>{root.rotation.y+=0.02;});
    panelLive.eng=eng;panelLive.scene=s;panelLive.root=root;
  }catch(e){return false;}
  return true;
}
function panelLiveBuild(t){
  if(!panelLive.scene)return;
  const s=panelLive.scene,root=panelLive.root;
  if(panelLive.node){const old=panelLive.node;panelLive.node=null;old.dispose();}
  const n=new BABYLON.TransformNode('plNode'+t,s);
  if(t==='cones'){
    const cm=new BABYLON.StandardMaterial('plCm'+t,s);
    cm.diffuseColor=new BABYLON.Color3(1,0.43,0);cm.specularColor=new BABYLON.Color3(0,0,0);
    const sm=new BABYLON.StandardMaterial('plSm'+t,s);
    sm.diffuseColor=new BABYLON.Color3(1,1,1);sm.specularColor=new BABYLON.Color3(0.15,0.15,0.15);
    const bm=new BABYLON.StandardMaterial('plBm'+t,s);
    bm.diffuseColor=new BABYLON.Color3(0.85,0.26,0.08);bm.specularColor=new BABYLON.Color3(0,0,0);
    const base=BABYLON.MeshBuilder.CreateBox('plB',{width:0.25,depth:0.25,height:0.035},s);
    base.parent=n;base.position.y=0.0175;base.material=bm;
    const body=BABYLON.MeshBuilder.CreateCylinder('plC',{diameterTop:0.04,diameterBottom:0.19,height:0.45,tessellation:24},s);
    body.parent=n;body.position.y=0.26;body.material=cm;
    const st=BABYLON.MeshBuilder.CreateCylinder('plS',{diameterTop:0.10,diameterBottom:0.14,height:0.11,tessellation:24},s);
    st.parent=n;st.position.y=0.255;st.material=sm;
  }else{
    const lm=new BABYLON.StandardMaterial('plLm'+t,s);
    lm.diffuseColor=new BABYLON.Color3(1,1,1);lm.specularColor=new BABYLON.Color3(0.15,0.15,0.15);
    const m=BABYLON.MeshBuilder.CreateBox('plL',{width:0.22,height:0.02,depth:0.8},s);
    m.parent=n;m.position.set(0,0.01,0);m.material=lm;
  }
  n.parent=root;
  panelLive.node=n;
}
function updatePanelLive(){
  if(!panelLiveEnsure())return;
  if(typeof editType==='undefined')return;
  panelLiveBuild(editType);
  const cv=document.getElementById('panelLiveCanvas');
  const acc=document.getElementById('typeIco');
  if(cv){cv.classList.add('on');}
  if(acc)acc.style.display='none';
  if(!panelLive.started){
    panelLive.started=true;
    panelLive.eng.runRenderLoop(()=>panelLive.scene.render());
  }
}
function stopPanelLive(){
  if(panelLive.eng&&panelLive.started){
    panelLive.started=false;
    panelLive.eng.stopRenderLoop();
  }
  const acc=document.getElementById('typeIco');
  if(acc)acc.style.display='';
  const cv=document.getElementById('panelLiveCanvas');
  if(cv)cv.classList.remove('on');
}

// ── Горячие клавиши редактора: 1/2/3, T (тип), C (очистить) ──
addEventListener('keydown',e=>{
  if(e.target.tagName==='INPUT')return;
  if(!conesEnabled&&(e.code==='Digit1'||e.code==='Digit2'||e.code==='Digit3'||e.code==='KeyT'||e.code==='KeyC')){e.preventDefault();return;}
  if(e.code==='Digit1')setMode('place');
  else if(e.code==='Digit2')setMode('move');
  else if(e.code==='Digit3')setMode('delete');
  else if(e.code==='KeyT')setEditType(editType==='lines'?'cones':'lines');
  else if(e.code==='KeyC')clearCones();
});

// ── Инициализация ───────────────────────────────────
setEditType('cones');
setMode('place');
loadCones();
loadMarkings();