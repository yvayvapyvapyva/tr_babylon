/*
 * editor.js — модуль редактирования площадки: установка, перемещение и удаление
 * конусов, режимы, предпросмотр, сохранение и столкновения с машиной.
 *
 * Подключается классическим <script> ПОСЛЕ основного inline-скрипта index.html.
 * Классические скрипты делят глобальную лексическую область, поэтому:
 *   — читает из главного скрипта: scene, BABYLON, canvas, camera, shadowGen,
 *     car, CAR, heading, dragging, updateMirrorRenderList;
 *   — объявляет здесь общие состояния (coneNodes, occupied, mode, conesEnabled,
 *     preview) и функции (loadCones, setMode, clearCones, checkCollisions),
 *     которые главный скрипт использует из обработчиков клавиш и цикла рендера.
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

setEditType('cones');
setMode('place');
loadCones();
loadMarkings();

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