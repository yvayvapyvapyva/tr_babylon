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

const STEP=0.25,HALF=50;
const snap=v=>Math.max(-HALF,Math.min(HALF,Math.round(v/STEP)*STEP));
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

const preview=BABYLON.MeshBuilder.CreateTorus('preview',{diameter:0.4,thickness:0.04,tessellation:28},scene);
const prevMat=new BABYLON.StandardMaterial('pm',scene);
prevMat.diffuseColor=new BABYLON.Color3(1,0.43,0);prevMat.emissiveColor=new BABYLON.Color3(1,0.43,0);
prevMat.alpha=0.85;prevMat.specularColor=new BABYLON.Color3(0,0,0);
preview.material=prevMat;preview.position.y=0.05;preview.isVisible=false;preview.isPickable=false;

let mode='place',dragging=null,dragOldKey=null,conesEnabled=false;
const hintline=document.getElementById('hintline');
const HINTS={place:'Клик по площадке — поставить конус (шаг 0,25 м)',
  move:'Зажми конус и перетащи в новый узел',delete:'Клик по конусу — удалить его'};
const CURSORS={place:'crosshair',move:'grab',delete:'pointer'};
function setMode(m){mode=m;
  document.querySelectorAll('.modes button').forEach(b=>b.classList.toggle('active',b.dataset.mode===m));
  hintline.textContent=HINTS[m];canvas.style.cursor=CURSORS[m];preview.isVisible=false;}
document.querySelectorAll('.modes button').forEach(b=>b.addEventListener('click',()=>{if(!conesEnabled)return;setMode(b.dataset.mode)}));
document.getElementById('clear').addEventListener('click',clearCones);

function carHits(px,pz){
  const dx=px-car.position.x,dz=pz-car.position.z;
  const c=Math.cos(heading),s=Math.sin(heading);
  const lx=dx*c-dz*s,lz=dx*s+dz*c;
  return Math.abs(lx)<=CAR.width/2 && Math.abs(lz)<=CAR.length/2;}
function knockCone(node,carPos){node.userData.knocked=true;
  const d=node.position.subtract(carPos);d.y=0;
  if(d.lengthSquared()<1e-6)d.set(0,0,1);d.normalize();
  node.position.addInPlace(d.scale(0.35));
  const axis=BABYLON.Vector3.Cross(BABYLON.Vector3.Up(),d).normalize();
  node.rotationQuaternion=BABYLON.Quaternion.RotationAxis(axis,Math.PI/2*0.95);}
function checkCollisions(){for(const node of coneNodes){const ud=node.userData;
  if(!ud||ud.knocked||node===dragging)continue;
  if(carHits(node.position.x,node.position.z))knockCone(node,car.position);}}

const pickGround=()=>scene.pick(scene.pointerX,scene.pointerY,m=>m.name==='ground');
const pickCone=()=>scene.pick(scene.pointerX,scene.pointerY,m=>m.metadata&&m.metadata.isCone);
scene.onPointerObservable.add(pi=>{const t=pi.type;
  if(!conesEnabled)return;
  if(t===BABYLON.PointerEventTypes.POINTERMOVE){
    const p=pickGround();
    if(p.hit){const sx=snap(p.pickedPoint.x),sz=snap(p.pickedPoint.z);
      preview.position.set(sx,0.05,sz);preview.isVisible=(mode==='place')||!!dragging;
      if(dragging)dragging.position.set(sx,0,sz);}
    else if(!dragging)preview.isVisible=false;}
  else if(t===BABYLON.PointerEventTypes.POINTERDOWN){
    if(mode==='move'){const c=pickCone();
      if(c.hit){dragging=c.pickedMesh.parent;const ud=dragging.userData;
        dragging.rotationQuaternion=BABYLON.Quaternion.Identity();ud.knocked=false;
        dragOldKey=ud.cellKey;occupied.delete(dragOldKey);
        camera.detachControl();canvas.style.cursor='grabbing';}}}
  else if(t===BABYLON.PointerEventTypes.POINTERUP){
    if(dragging){const x=snap(dragging.position.x),z=snap(dragging.position.z),k=key(x,z);
      const ud=dragging.userData;
      if(occupied.has(k)){const[ox,oz]=dragOldKey.split(',').map(Number);
        dragging.position.set(ox,0,oz);occupied.add(dragOldKey);ud.cellKey=dragOldKey;}
      else{dragging.position.set(x,0,z);occupied.add(k);ud.cellKey=k;}
      updateCount();saveCones();
      dragging=null;camera.attachControl(canvas,true);canvas.style.cursor=CURSORS[mode];}}
  else if(t===BABYLON.PointerEventTypes.POINTERTAP){
    if(dragging)return;
    if(mode==='delete'){const c=pickCone();if(c.hit)deleteCone(c.pickedMesh.parent);}
    else if(mode==='place'){const p=pickGround();if(p.hit)addConeAt(snap(p.pickedPoint.x),snap(p.pickedPoint.z));}}});

setMode('place');
loadCones();

function setConesEnabled(on){
  conesEnabled=on;
  document.querySelector('.modes').classList.toggle('disabled',!on);
  preview.isVisible=false;
  hintline.textContent=on?HINTS[mode]:'Режим редактирования карты выключен';
  if(on)setMode(mode);
}
document.querySelector('.modes').classList.add('disabled');
hintline.textContent='Режим редактирования карты выключен';