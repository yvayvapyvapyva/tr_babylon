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

// ── Рисование линиями: разметка / бордюр / забор ──────────────
const DRAW_TYPES=['lines','curb','fence','estacada'];
const LINE_KEY={lines:'tr_babylon_markings',curb:'tr_babylon_curbs',fence:'tr_babylon_fences',estacada:'tr_babylon_estacadas'};
const LINE_WIDTH={lines:0.1,curb:0.25,fence:0.05};
const LINE_H={lines:0.006,curb:0.30,fence:1.7};
const LINE_Y={lines:0.0042,curb:0.15,fence:0.85};
let drawSeq=0;
const EST_SLOPE=0.16,EST_L2=5,EST_W=4;
const countLinesEl=document.getElementById('countLines');
const countCurbEl=document.getElementById('countCurb');
const countFenceEl=document.getElementById('countFence');
const countEstacadaEl=document.getElementById('countEstacada');
const finishLineBtn=document.getElementById('finishLineBtn');
const lineMat=new BABYLON.StandardMaterial('lm',scene);
lineMat.diffuseColor=new BABYLON.Color3(1,1,1);
lineMat.specularColor=new BABYLON.Color3(0.15,0.15,0.15);
const curbDMat=new BABYLON.StandardMaterial('cm',scene);
curbDMat.diffuseColor=new BABYLON.Color3(1,1,1);
curbDMat.specularColor=new BABYLON.Color3(0.1,0.1,0.1);
const fencePostMat=new BABYLON.StandardMaterial('fpm',scene);
fencePostMat.diffuseColor=new BABYLON.Color3(0.42,0.46,0.5);
fencePostMat.specularColor=new BABYLON.Color3(0.4,0.4,0.42);
fencePostMat.specularPower=64;
const fenceRailMat=new BABYLON.StandardMaterial('frm',scene);
fenceRailMat.diffuseColor=new BABYLON.Color3(0.88,0.9,0.92);
fenceRailMat.specularColor=new BABYLON.Color3(0.5,0.5,0.5);
fenceRailMat.specularPower=128;
const estacadaMat=new BABYLON.StandardMaterial('em',scene);
estacadaMat.diffuseColor=new BABYLON.Color3(0.92,0.92,0.93);
estacadaMat.specularColor=new BABYLON.Color3(0.06,0.06,0.08);
estacadaMat.specularPower=16;
estacadaMat.backFaceCulling=false;
const estTex=new BABYLON.DynamicTexture('estTex',{width:256,height:256},scene,true);
const etx=estTex.getContext();
etx.fillStyle='rgb(62,62,64)';etx.fillRect(0,0,256,256);
for(let i=0;i<7000;i++){
  const x=Math.random()*256,y=Math.random()*256,v=64+(Math.random()*26-13);
  etx.fillStyle='rgb('+v+','+v+','+v+')';etx.fillRect(x,y,1,1);
}
for(let i=0;i<110;i++){
  const x=Math.random()*256,y=Math.random()*256,r=1.5+Math.random()*4,v=66+(Math.random()*22-11);
  etx.fillStyle='rgba('+v+','+v+','+v+',0.4)';
  etx.beginPath();etx.arc(x,y,r,0,Math.PI*2);etx.fill();
}
for(let i=0;i<20;i++){
  const x=Math.random()*256,y=Math.random()*256,l=12+Math.random()*34,a=Math.random()*Math.PI;
  etx.strokeStyle='rgba(18,18,18,0.35)';etx.lineWidth=1;
  etx.beginPath();etx.moveTo(x,y);etx.lineTo(x+Math.cos(a)*l,y+Math.sin(a)*l);etx.stroke();
}
estTex.update();
estTex.wrapU=estTex.wrapV=BABYLON.Texture.WRAP_ADDRESSMODE;
estacadaMat.diffuseTexture=estTex;
estacadaMat.diffuseTexture.level=1;
const rampPrevMat=new BABYLON.StandardMaterial('rpm',scene);
rampPrevMat.diffuseColor=new BABYLON.Color3(0.8,0.9,1);
rampPrevMat.alpha=0.5;
rampPrevMat.specularColor=new BABYLON.Color3(0,0,0);
rampPrevMat.backFaceCulling=false;
const prevLineMat=new BABYLON.StandardMaterial('lpm',scene);
prevLineMat.diffuseColor=new BABYLON.Color3(1,1,1);
prevLineMat.alpha=0.55;
prevLineMat.specularColor=new BABYLON.Color3(0,0,0);
const previewSeg=BABYLON.MeshBuilder.CreateBox('linePrev',{width:1,height:1,depth:1},scene);
previewSeg.material=prevLineMat;previewSeg.isVisible=false;previewSeg.isPickable=false;
const drawStore={};for(const t of DRAW_TYPES)drawStore[t]={polys:[],arrs:[]};
let openLine=null;
function segRotY(dx,dz){return Math.atan2(dx,dz);}
function makeFenceSegment(ax,az,dx,dz,L){
  const n=Math.max(1,Math.round(L/(typeof FENCE_STEP==='number'?FENCE_STEP:3.2)));
  const g=new BABYLON.TransformNode('fenceSeg'+(drawSeq++),scene);
  const ry=segRotY(dx,dz);
  [0.8,1.5].forEach(rh=>{
    const rail=BABYLON.MeshBuilder.CreateBox('fenceRail'+(drawSeq++),{width:0.06,height:0.06,depth:L},scene);
    rail.parent=g;rail.position.set((ax+ax+dx)/2,rh,(az+az+dz)/2);
    rail.rotation.y=ry;
    rail.isPickable=true;rail.receiveShadows=true;
    rail.material=fenceRailMat;rail.metadata={isLine:true,stype:'fence',group:g};
  });
  for(let i=0;i<=n;i++){
    const t=i/n;
    const post=BABYLON.MeshBuilder.CreateBox('fencePost'+(drawSeq++),{width:0.08,height:1.7,depth:0.08},scene);
    post.parent=g;post.position.set(ax+dx*t,0.85,az+dz*t);
    post.isPickable=true;post.receiveShadows=true;
    post.material=fencePostMat;post.metadata={isLine:true,stype:'fence',group:g};
  }
  return g;
}
function buildRampMesh(D,h,scene,name,L2){
  L2=L2===undefined?EST_L2:L2;
  const hw=EST_W/2,yb=-0.08,L=D+L2+D;
  const pos=[
    hw,0,0,     hw,h,D,     hw,h,D+L2,   hw,0,L,    hw,yb,L,   hw,yb,0,
    -hw,0,0,    -hw,h,D,    -hw,h,D+L2,  -hw,0,L,   -hw,yb,L,  -hw,yb,0
  ];
  const idx=[
    0,1,7, 0,7,6,
    1,2,8, 1,8,7,
    2,3,9, 2,9,8,
    3,4,10, 3,10,9,
    4,5,11, 4,11,10,
    5,0,6, 5,6,11,
    0,1,2, 0,2,3, 0,3,4, 0,4,5,
    6,11,10, 6,10,9, 6,9,8, 6,8,7
  ];
  const m=new BABYLON.Mesh(name,scene);
  const vd=new BABYLON.VertexData();
  vd.positions=pos;
  vd.indices=idx;
  const norms=new Float32Array(pos.length);
  BABYLON.VertexData.ComputeNormals(pos,idx,norms);
  vd.normals=norms;
  vd.uvs=(()=>{const a=[];for(let i=0;i<pos.length;i+=3)a.push(pos[i+2]*0.5,pos[i]*0.5+0.5);return a;})();
  vd.applyToMesh(m);
  return m;
}
function buildRampCurbs(g,sides,D,L2,h){
  for(const sx of sides){
    const mk=(z1,z2,y1,y2)=>{
      const Ls=Math.hypot(z2-z1,y2-y1)||0.05;
      const curb=BABYLON.MeshBuilder.CreateBox('estacadaCurb'+(drawSeq++),{width:0.24,height:0.4,depth:Ls+0.08},scene);
      const py=(z2-z1)/Ls,pz=-(y2-y1)/Ls;
      curb.parent=g;
      curb.position.set(sx,(y1+y2)/2+py*0.2,(z1+z2)/2+pz*0.2);
      curb.rotation.x=Math.atan2(-(y2-y1),z2-z1);
      curb.material=curbDMat;curb.isPickable=false;curb.receiveShadows=true;
      curb.metadata={isLine:true,stype:'estacada',group:g};
    };
    mk(-0.06,D+0.06,0,h);
    mk(D-0.06,D+L2+0.06,h,h);
    mk(D+L2-0.06,D+L2+D+0.06,h,0);
  }
}
function makeRampSegment(ax,az,dx,dz,D,h){
  const g=new BABYLON.TransformNode('estacadaSeg'+(drawSeq++),scene);
  const poly=buildRampMesh(D,h,scene,'estacadaRamp'+(drawSeq++));
  poly.parent=g;
  poly.material=estacadaMat;
  poly.isPickable=true;poly.receiveShadows=true;
  poly.metadata={isLine:true,stype:'estacada',group:g};
  buildRampCurbs(g,[-EST_W/2+0.12,EST_W/2-0.12],D,EST_L2,h);
  g.position.set(ax,0,az);
  g.rotation.y=segRotY(dx,dz);
  return g;
}
function carPointInBands(px,pz,y,dx,dz){
  const list=[['curb',(LINE_WIDTH.curb??0.25)+0.18],['fence',0.4]];
  try{
    for(const[t,hw]of list){
      const ds=drawStore&&drawStore[t];
      if(!ds)continue;
      for(const poly of ds.polys){
        if(!Array.isArray(poly)||poly.length<2)continue;
        for(let i=0;i<poly.length-1;i++){
          const ax=poly[i][0],az=poly[i][1],bx=poly[i+1][0],bz=poly[i+1][1];
          const LX=bx-ax,LZ=bz-az,LL=Math.hypot(LX,LZ);
          if(LL<1e-4)continue;
          const ux=LX/LL,uz=LZ/LL,px2=-uz,py2=ux;
          const u=(px-ax)*ux+(pz-az)*uz,v=(px-ax)*px2+(pz-az)*py2;
          if(u>-hw&&u<LL+hw&&Math.abs(v)<hw)return true;
        }
      }
    }
    if(dx===0&&dz===0)return false;
    const ds=drawStore&&drawStore.estacada;
    if(!ds)return false;
    const hw=EST_W/2,L2=EST_L2,slope=EST_SLOPE;
    for(const p of ds.polys){
      if(!Array.isArray(p)||p.length<2)continue;
      const ax=p[0][0],az=p[0][1],bx=p[1][0],bz=p[1][1];
      const LX=bx-ax,LZ=bz-az,LL=Math.hypot(LX,LZ);
      if(LL<1e-4)continue;
      const ux=LX/LL,uz=LZ/LL,px2=-uz,py2=ux;
      const rx=px-ax,rz=pz-az,u=rx*ux+rz*uz,v=rx*px2+rz*py2;
      if(u<0||u>LL+L2+LL||Math.abs(v)>=hw)continue;
      const dU=dx*ux+dz*uz,dV=dx*px2+dz*py2;
      if(Math.abs(dV)<=2*Math.abs(dU))continue;
      const h=Math.min(LL*slope,3.2);
      let yt;
      if(u<=LL)yt=u/LL*h;
      else if(u<=LL+L2)yt=h;
      else yt=h*(1-(u-LL-L2)/LL);
      if(yt-y>0.05)return true;
    }
  }catch(e){}
  return false;
}
function carBlocked(nx,nz,y,dx,dz,cs,sn){
  const pts=[[-0.85,-2.1],[0.85,-2.1],[-0.85,2.1],[0.85,2.1],[0,2.15]];
  for(const[p0,p1]of pts){
    const wx=nx+p0*cs+p1*sn,wz=nz-p0*sn+p1*cs;
    if(carPointInBands(wx,wz,y,dx,dz))return true;
  }
  return false;
}
function makeLineSegment(type,a,b){
  const ax=a[0],az=a[1],bx=b[0],bz=b[1];
  const dx=bx-ax,dz=bz-az;
  const L=Math.hypot(dx,dz);
  if(L<1e-4)return null;
  if(type==='fence')return makeFenceSegment(ax,az,dx,dz,L);
  if(type==='estacada')return makeRampSegment(ax,az,dx,dz,L,Math.min(L*EST_SLOPE,3.2));
  const w=LINE_WIDTH[type]??0.1,h=LINE_H[type]??0.006,y=(LINE_Y[type]??0.004);
  const seg=BABYLON.MeshBuilder.CreateBox('drawSeg'+(drawSeq++),{width:w,height:h,depth:L},scene);
  seg.position.set((ax+bx)/2,y,(az+bz)/2);
  seg.rotation.y=segRotY(dx,dz);
  seg.material=(type==='curb')?curbDMat:lineMat;
  seg.isPickable=true;seg.receiveShadows=true;
  seg.metadata={isLine:true,stype:type};
  return seg;
}
function updateCounts(){
  if(countLinesEl)countLinesEl.textContent=drawStore.lines.polys.length;
  if(countCurbEl)countCurbEl.textContent=drawStore.curb.polys.length;
  if(countFenceEl)countFenceEl.textContent=drawStore.fence.polys.length;
  if(countEstacadaEl)countEstacadaEl.textContent=drawStore.estacada.polys.length;
  syncFinishBtn();
}
function syncFinishBtn(){
  if(!finishLineBtn)return;
  const show=editType!=='cones'&&mode==='place'&&openLine;
  finishLineBtn.style.display=show?'':'none';
  if(show)finishLineBtn.textContent=FINISH_LABELS[editType]||'Завершить';
}
const FINISH_LABELS={lines:'Завершить линию',curb:'Завершить бордюр',fence:'Завершить забор',estacada:'Завершить эстакаду'};
function updateLinePreview(){
  if(!openLine)return;
  if(editType==='estacada'){updateRampPreview();return;}
  const last=openLine.pts[openLine.pts.length-1];
  const p=pickGround();
  if(p.hit&&last){
    const sx=snapX(p.pickedPoint.x),sz=snapZ(p.pickedPoint.z);
    const dx=sx-last[0],dz=sz-last[1];
    const L=Math.hypot(dx,dz);
    if(L>1e-4){
      const w=LINE_WIDTH[editType]??0.1,h=LINE_H[editType]??0.006,y=(LINE_Y[editType]??0.004);
      previewSeg.position.set((sx+last[0])/2,y,(sz+last[1])/2);
      previewSeg.scaling.set(w,h,L);
      previewSeg.rotation.y=Math.atan2(dx,dz);
      previewSeg.isVisible=true;
    }else previewSeg.isVisible=false;
  }else previewSeg.isVisible=false;
}
function hideLinePreview(){previewSeg.isVisible=false;if(rampPreviewGroup){const old=rampPreviewGroup;rampPreviewGroup=null;old.dispose();}}
let rampPreviewGroup=null;
function updateRampPreview(){
  if(rampPreviewGroup){const old=rampPreviewGroup;rampPreviewGroup=null;old.dispose();}
  const last=openLine&&openLine.pts.length?openLine.pts[openLine.pts.length-1]:null;
  const p=last?pickGround():null;
  if(!p||!p.hit)return;
  const sx=snapX(p.pickedPoint.x),sz=snapZ(p.pickedPoint.z);
  const dx=sx-last[0],dz=sz-last[1];
  const D=Math.hypot(dx,dz);
  if(D<=1e-4)return;
  const h=Math.min(D*EST_SLOPE,3.2);
  const g=new BABYLON.TransformNode('rvG'+(drawSeq++),scene);
  const poly=buildRampMesh(D,h,scene,'rv'+(drawSeq++));
  poly.parent=g;poly.material=rampPrevMat;poly.isPickable=false;
  g.position.set(last[0],0,last[1]);
  g.rotation.y=segRotY(dx,dz);
  rampPreviewGroup=g;
}
function startOpenLine(){openLine={pts:[],meshes:[]};syncFinishBtn();}
function addLinePoint(x,z){
  if(!openLine)startOpenLine();
  const last=openLine.pts[openLine.pts.length-1];
  if(last&&last[0]===x&&last[1]===z)return;
  openLine.pts.push([x,z]);
  if(last){const s=makeLineSegment(editType,last,[x,z]);if(s)openLine.meshes.push(s);}
  updateLinePreview();
}
function finishLine(){
  if(!openLine)return;
  if(openLine.pts.length>=2){
    drawStore[editType].polys.push(openLine.pts);
    drawStore[editType].arrs.push(openLine.meshes);
    updateCounts();
  }else{
    openLine.meshes.forEach(m=>{try{m.dispose();}catch(e){}});
  }
  openLine=null;
  hideLinePreview();
  syncFinishBtn();
  saveDraw(editType);
  if(typeof updateMirrorRenderList==='function')updateMirrorRenderList();
}
function saveDraw(type){try{localStorage.setItem(LINE_KEY[type],JSON.stringify(drawStore[type].polys));}catch(e){}}
function pushPolyline(type,pts){
  const meshes=[];
  for(let i=1;i<pts.length;i++){const s=makeLineSegment(type,pts[i-1],pts[i]);if(s)meshes.push(s);}
  drawStore[type].polys.push(pts);
  drawStore[type].arrs.push(meshes);
}
function loadDraw(type){try{const d=JSON.parse(localStorage.getItem(LINE_KEY[type])||'[]');
  if(Array.isArray(d))d.forEach(poly=>{
    if(!Array.isArray(poly)||poly.length<2)return;
    const pts=poly.filter(p=>Array.isArray(p)&&p.length===2&&typeof p[0]==='number'&&typeof p[1]==='number');
    if(pts.length>=2)pushPolyline(type,pts);
  });
  updateCounts();}catch(e){}}
function findDrawPolyline(mesh){
  const group=mesh.metadata&&mesh.metadata.group;
  for(const t of DRAW_TYPES){
    const arr=drawStore[t].arrs;
    for(let i=0;i<arr.length;i++){
      if(arr[i].includes(mesh))return{type:t,i:i};
      if(group&&arr[i].indexOf(group)>=0)return{type:t,i:i};
    }
  }
  return null;
}
function deletePolylineFromMesh(mesh){
  const f=findDrawPolyline(mesh);
  if(!f)return;
  drawStore[f.type].arrs[f.i].forEach(m=>{try{m.dispose();}catch(e){}});
  drawStore[f.type].arrs.splice(f.i,1);
  drawStore[f.type].polys.splice(f.i,1);
  updateCounts();saveDraw(f.type);
  if(typeof updateMirrorRenderList==='function')updateMirrorRenderList();
}
function clearDraw(){
  finishLine();
  for(const t of DRAW_TYPES){
    drawStore[t].arrs.forEach(arr=>arr.forEach(m=>{try{m.dispose();}catch(e){}}));
    drawStore[t].polys.length=0;drawStore[t].arrs.length=0;
    saveDraw(t);
  }
  updateCounts();
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
  move:'Зажми конус и перетащи в новый узел',delete:'Клик по конусу — удалить'};
const DRAWHINTS={
  lines:{place:'Кликай по площадке: точки соединяются в белую линию. «Завершить линию» — начать новую',move:'Перемещение разметки не поддерживается',delete:'Клик по разметке — удалить'},
  curb:{place:'Кликай по площадке: точки соединяются в бетонный бордюр. «Завершить линию» — начать новый',move:'Перемещение бордюра не поддерживается',delete:'Клик по бордюру — удалить'},
  fence:{place:'Кликай по площадке: точки соединяются в деревянный забор. «Завершить линию» — начать новый',move:'Перемещение забора не поддерживается',delete:'Клик по забору — удалить'},
  estacada:{place:'Кликни первый раз — начало подъёма эстакады, второй — вершина. Появится подъём 16% + площадка + спуск 16%. «Завершить» — поставить',move:'Перемещение эстакады не поддерживается',delete:'Клик по эстакаде — удалить'}
};
function drawHint(t){return DRAWHINTS[t]||DRAWHINTS.lines;}
const CURSORS={place:'crosshair',move:'grab',delete:'pointer'};
let editType='cones';
const editTypeSel=document.getElementById('editTypeSel');
const typeIco=document.getElementById('typeIco');
const typeName=document.getElementById('typeName');
const TYPE_NAMES={cones:'Конус',lines:'Разметка',curb:'Бордюр',fence:'Забор',estacada:'Эстакада'};
const TYPE_ICONS={
  cones:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 2.6 15.8 21H8.2Z" fill="#ff8c3b" stroke="#1a1200" stroke-width="1.1" stroke-linejoin="round"/><ellipse cx="12" cy="14.4" rx="2.4" ry="1.1" fill="#fff" stroke="#1a1200" stroke-width=".8"/></svg>',
  lines:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="10.3" width="4" height="1.7" rx=".85" fill="#fff"/><rect x="10" y="10.3" width="4" height="1.7" rx=".85" fill="#fff"/><rect x="17" y="10.3" width="4" height="1.7" rx=".85" fill="#fff"/></svg>',
  curb:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="2.5" y="8.6" width="19" height="5.6" rx="1.2" fill="#fff" stroke="#22303a" stroke-width="1"/><rect x="2.5" y="14.2" width="19" height="1.8" rx=".9" fill="#e8eaed" stroke="#22303a" stroke-width=".8"/></svg>',
  fence:'<svg viewBox="0 0 24 24" aria-hidden="true"><rect x="14" y="5" width="2" height="16" rx=".6" fill="#6a7075" stroke="#22303a" stroke-width=".8"/><rect x="18.5" y="5" width="2" height="16" rx=".6" fill="#6a7075" stroke="#22303a" stroke-width=".8"/><rect x="3" y="7" width="17.4" height="1.8" rx=".9" fill="#f2f4f6" stroke="#22303a" stroke-width=".7"/><rect x="3" y="14" width="17.4" height="1.8" rx=".9" fill="#f2f4f6" stroke="#22303a" stroke-width=".7"/></svg>',
  estacada:'<svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2.8 18.5 7.5 11h9l4.7 7.5" fill="none" stroke="#9db4c4" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/><line x1="2.8" y1="18.5" x2="21.2" y2="18.5" stroke="#7c93a4" stroke-width="1.6"/></svg>'
};
function setEditType(t){
  if(t!==editType&&editType!=='cones')finishLine();
  editType=t;
  if(editTypeSel)editTypeSel.value=t;
  if(typeIco)typeIco.innerHTML=(THUMBS[t]?'<img src="'+THUMBS[t]+'" alt="">':(TYPE_ICONS[t]||''));
  if(typeName)typeName.textContent=TYPE_NAMES[t]||t;
  if(t!=='cones'&&mode==='move')setMode('place');
  else setMode(mode);
  if(typeof updatePanelLive==='function'&&typeof panelLive!=='undefined'&&panelLive.started)updatePanelLive();
}
if(editTypeSel){editTypeSel.addEventListener('change',()=>{if(!conesEnabled)return;setEditType(editTypeSel.value);});}
function setMode(m){
  finishLine();
  mode=m;
  document.querySelectorAll('#editModes button').forEach(b=>b.classList.toggle('active',b.dataset.mode===m));
  hintline.textContent=editType==='cones'?HINTS[mode]:drawHint(editType)[mode];
  canvas.style.cursor=CURSORS[mode];preview.isVisible=false;
  document.getElementById('editModes').classList.toggle('draw',editType!=='cones'&&mode==='move');
  syncFinishBtn();
}
document.querySelectorAll('#editModes button').forEach(b=>b.addEventListener('click',()=>{if(!conesEnabled)return;setMode(b.dataset.mode)}));
document.getElementById('mapClearAll').addEventListener('click',()=>{clearCones();clearDraw();});

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
      if(editType!=='cones'&&mode==='place')updateLinePreview();else hideLinePreview();
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
      if(editType!=='cones')addLinePoint(px,pz);else addConeAt(px,pz);}}
  }
});

function setConesEnabled(on){
  if(!on)finishLine();
  conesEnabled=on;
  document.querySelectorAll('.modes').forEach(el=>el.classList.toggle('disabled',!on));
  if(editTypeSel){editTypeSel.disabled=!on;}
  if(document.getElementById('editType'))document.getElementById('editType').classList.toggle('disabled',!on);
  preview.isVisible=false;
  hintline.textContent=on?(editType==='cones'?HINTS[mode]:drawHint(editType)[mode]):'Режим редактирования карты выключен';
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
const THUMBS={cones:null,lines:null,curb:null,fence:null,estacada:null};
function previewFrame(type){
  if(type==='estacada')return{g:4.6,r:4.5,t:0.12};
  return{g:2,r:2.2,t:type==='cones'?0.35:type==='fence'?0.85:type==='curb'?0.15:0.05};
}
function buildTypedPreview(type,scene,parent){
  const n=new BABYLON.TransformNode('tp'+(++drawSeq),scene);
  if(type==='cones'){
    const cm=new BABYLON.StandardMaterial('tpCone'+type,scene);
    cm.diffuseColor=new BABYLON.Color3(1,0.43,0);cm.specularColor=new BABYLON.Color3(0,0,0);
    const sm=new BABYLON.StandardMaterial('tpStripe'+type,scene);
    sm.diffuseColor=new BABYLON.Color3(1,1,1);sm.specularColor=new BABYLON.Color3(0.15,0.15,0.15);
    const bm=new BABYLON.StandardMaterial('tpBase'+type,scene);
    bm.diffuseColor=new BABYLON.Color3(0.82,0.24,0.07);bm.specularColor=new BABYLON.Color3(0,0,0);
    const base=BABYLON.MeshBuilder.CreateBox('tpb',{width:0.25,depth:0.25,height:0.035},scene);
    base.parent=n;base.position.y=0.0175;base.material=bm;
    const body=BABYLON.MeshBuilder.CreateCylinder('tpc',{diameterTop:0.04,diameterBottom:0.19,height:0.45,tessellation:24},scene);
    body.parent=n;body.position.y=0.26;body.material=cm;
    const st=BABYLON.MeshBuilder.CreateCylinder('tps',{diameterTop:0.10,diameterBottom:0.14,height:0.11,tessellation:24},scene);
    st.parent=n;st.position.y=0.255;st.material=sm;
  }else if(type==='lines'){
    const lm=new BABYLON.StandardMaterial('tpLine'+type,scene);
    lm.diffuseColor=new BABYLON.Color3(1,1,1);lm.specularColor=new BABYLON.Color3(0.15,0.15,0.15);
    const m=BABYLON.MeshBuilder.CreateBox('tpl',{width:0.22,height:0.02,depth:0.8},scene);
    m.parent=n;m.position.set(0,0.01,0);m.material=lm;
  }else if(type==='curb'){
    const cm2=new BABYLON.StandardMaterial('tpCurb'+type,scene);
    cm2.diffuseColor=new BABYLON.Color3(1,1,1);cm2.specularColor=new BABYLON.Color3(0.1,0.1,0.1);
    const c=BABYLON.MeshBuilder.CreateBox('tpc2',{width:0.25,height:0.30,depth:0.9},scene);
    c.parent=n;c.position.set(0,0.15,0);c.material=cm2;
  }else if(type==='fence'){
    const fpm=new BABYLON.StandardMaterial('tpFPost'+type,scene);
    fpm.diffuseColor=new BABYLON.Color3(0.42,0.46,0.5);fpm.specularColor=new BABYLON.Color3(0.4,0.4,0.42);fpm.specularPower=64;
    const frm=new BABYLON.StandardMaterial('tpFRail'+type,scene);
    frm.diffuseColor=new BABYLON.Color3(0.88,0.9,0.92);frm.specularColor=new BABYLON.Color3(0.5,0.5,0.5);frm.specularPower=128;
    [0.8,1.5].forEach(rh=>{
      const rail=BABYLON.MeshBuilder.CreateBox('tpfr',{width:1.6,height:0.06,depth:0.06},scene);
      rail.parent=n;rail.position.set(0,rh,0);rail.material=frm;
    });
    [-0.8,0.8].forEach(x=>{
      const post=BABYLON.MeshBuilder.CreateBox('tpfp',{width:0.08,height:1.7,depth:0.08},scene);
      post.parent=n;post.position.set(x,0.85,0);post.material=fpm;
    });
  }else if(type==='estacada'){
    const p=buildRampMesh(1.4,0.22,scene,'tpEst'+(drawSeq++),1.2);
    p.parent=n;p.material=estacadaMat;
    buildRampCurbs(n,[-EST_W/2+0.12,EST_W/2-0.12],1.4,1.2,0.22);
  }
  n.parent=parent;
  return n;
}
function thumbCluster(type){
  const F=previewFrame(type);
  const R=new BABYLON.TransformNode('thRoot'+type,scene);
  R.position.set(-9999,0,0);
  const gm=new BABYLON.StandardMaterial('thGround'+type,scene);
  gm.diffuseColor=new BABYLON.Color3(0.17,0.18,0.21);gm.specularColor=new BABYLON.Color3(0,0,0);
  const g=BABYLON.MeshBuilder.CreateGround('thG'+type,{width:F.g,height:F.g},scene);
  g.parent=R;g.material=gm;
  buildTypedPreview(type,scene,R);
  return{root:R,cy:F.t};
}
function captureThumb(type){
  try{
    const{root,cy}=thumbCluster(type);
    const F=previewFrame(type);
    const cam=new BABYLON.ArcRotateCamera('thCam'+type,Math.PI/4,Math.PI/2.6,F.r,
      new BABYLON.Vector3(-9999,cy,0),scene);
    cam.lowerAlphaLimit=Math.PI/4;cam.upperAlphaLimit=Math.PI/4;
    cam.lowerBetaLimit=Math.PI/2.6;cam.upperBetaLimit=Math.PI/2.6;
    cam.lowerRadiusLimit=F.r;cam.upperRadiusLimit=F.r;
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
    const F=previewFrame(type);
    const gm=new BABYLON.StandardMaterial('lvGm'+type,s);
    gm.diffuseColor=new BABYLON.Color3(0.17,0.18,0.21);gm.specularColor=new BABYLON.Color3(0,0,0);
    const g=BABYLON.MeshBuilder.CreateGround('lvG'+type,{width:F.g,height:F.g},s);g.material=gm;
    const rot=new BABYLON.TransformNode('lvRot'+type,s);
    buildTypedPreview(type,s,rot);
    rot.position.y=F.t;
    const cam=new BABYLON.ArcRotateCamera('lvC'+type,Math.PI/4,Math.PI/2.6,F.r,new BABYLON.Vector3(0,F.t,0),s);
    cam.lowerAlphaLimit=Math.PI/4;cam.upperAlphaLimit=Math.PI/4;
    cam.lowerBetaLimit=Math.PI/2.6;cam.upperBetaLimit=Math.PI/2.6;
    cam.lowerRadiusLimit=F.r;cam.upperRadiusLimit=F.r;
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
  try{captureThumb('cones');captureThumb('lines');captureThumb('curb');captureThumb('fence');captureThumb('estacada');applyThumbs();}catch(e){}
}));

// ── Окно-галерея объектов ───────────────────────────
const typeWin=document.getElementById('typeWin');
const typeBackdrop=document.getElementById('typeBackdrop');
function openTypeWin(o){
  typeWin.classList.toggle('open',o);
  typeBackdrop.classList.toggle('open',o);
  if(o){startLive('cones');startLive('lines');startLive('curb');startLive('fence');startLive('estacada');}
  else{stopLive('cones');stopLive('lines');stopLive('curb');stopLive('fence');stopLive('estacada');}
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
    panelLive.eng=eng;panelLive.scene=s;panelLive.root=root;panelLive.cam=cam;
  }catch(e){return false;}
  return true;
}
function panelLiveBuild(t){
  if(!panelLive.scene)return;
  if(panelLive.node){const old=panelLive.node;panelLive.node=null;old.dispose();}
  const n=new BABYLON.TransformNode('plNode'+t,panelLive.scene);
  buildTypedPreview(t,panelLive.scene,n);
  if(panelLive.cam){const F=previewFrame(t);
    panelLive.cam.setRadius(F.r);
    panelLive.cam.lowerRadiusLimit=panelLive.cam.upperRadiusLimit=F.r;
    panelLive.cam.setTarget(new BABYLON.Vector3(0,F.t,0));}
  n.parent=panelLive.root;
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
  else if(e.code==='KeyT'){const order=['cones','lines','curb','fence','estacada'];setEditType(order[(order.indexOf(editType)+1)%order.length]);}
  else if(e.code==='KeyC')clearCones();
});

// ── Инициализация ───────────────────────────────────
setEditType('cones');
setMode('place');
loadCones();
loadDraw('lines');
loadDraw('curb');
loadDraw('fence');
loadDraw('estacada');