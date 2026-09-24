/*
 * mirror.js — модуль отражений в зеркалах заднего вида:
 * MirrorTexture, плоскости отражения, регулировка углов,
 * сохранение настроек, сброс и обновление списка рендера.
 *
 * Подключается классическим <script> ПОСЛЕ основного inline-скрипта index.html.
 * Классические скрипты делят глобальную лексическую область, поэтому:
 *   — читает из главного скрипта: BABYLON, scene, car, heading, MIRROR_SIZE;
 *   — объявляет здесь общие состояния (mirrorAngles, leftMirrorTex и т.п.)
 *     и функции (setupMirrorReflections, disposeMirrors,
 *     updateMirrorRenderList, adjustMirror, resetMirrorAngles), которые
 *     главный скрипт и editor.js используют при смене машины, в обработчиках
 *     клавиш и в цикле рендера (mirrorUpdaters вызывается из
 *     onBeforeRenderObservable).
 */

// ── ОТРАЖЕНИЯ И РЕГУЛИРОВКА ЗЕРКАЛ ────────────────────────
let leftMirrorTex=null,rightMirrorTex=null,rearMirrorTex=null;
const mirrorUpdaters=[];
let leftMirrorPivot=null,rightMirrorPivot=null;
let leftMirrorMesh=null,rightMirrorMesh=null;
let leftMirrorBaseQuat=null,rightMirrorBaseQuat=null;
// оси регулировки: H — вокруг вертикали (влево-вправо), V — вокруг поперечной оси (вверх-вниз)
let leftYawAxis=null,leftPitchAxis=null,rightYawAxis=null,rightPitchAxis=null;
const DEFAULT_MIRROR_ANGLES={left:{h:14,v:1},right:{h:-2,v:2}};
const mirrorAngles = { left: { h: DEFAULT_MIRROR_ANGLES.left.h, v: DEFAULT_MIRROR_ANGLES.left.v }, right: { h: DEFAULT_MIRROR_ANGLES.right.h, v: DEFAULT_MIRROR_ANGLES.right.v } };

function disposeMirrors(){
  mirrorUpdaters.length=0;
  if(leftMirrorTex){try{leftMirrorTex.dispose();}catch(e){}leftMirrorTex=null;}
  if(rightMirrorTex){try{rightMirrorTex.dispose();}catch(e){}rightMirrorTex=null;}
  if(rearMirrorTex){try{rearMirrorTex.dispose();}catch(e){}rearMirrorTex=null;}
  if(leftMirrorPivot){try{leftMirrorPivot.dispose();}catch(e){}leftMirrorPivot=null;leftMirrorMesh=null;}
  if(rightMirrorPivot){try{rightMirrorPivot.dispose();}catch(e){}rightMirrorPivot=null;rightMirrorMesh=null;}
  leftMirrorBaseQuat=null;rightMirrorBaseQuat=null;
  leftYawAxis=null;leftPitchAxis=null;rightYawAxis=null;rightPitchAxis=null;
}
// ИСПРАВЛЕНО: ранний обработчик updateMirrorPlane удалён.
// Обновление плоскостей зеркал перенесено в основной цикл onBeforeRenderObservable,
// чтобы оно выполнялось ПОСЛЕ обновления позиции автомобиля (без лага на 1 кадр).

// Нормаль поверхности стекла зеркала (самая «плоская» ось геометрии, PCA)
function mirrorSurfaceNormalLocal(mesh){
  const geo=mesh.geometry;
  const pos=geo&&geo.getVerticesData(BABYLON.VertexBuffer.PositionKind);
  if(!pos||pos.length<9)return new BABYLON.Vector3(0,0,1);
  const cnt=pos.length/3;
  let cx=0,cy=0,cz=0;
  for(let i=0;i<pos.length;i+=3){cx+=pos[i];cy+=pos[i+1];cz+=pos[i+2];}
  cx/=cnt;cy/=cnt;cz/=cnt;
  let xx=0,xy=0,xz=0,yy=0,yz=0,zz=0;
  for(let i=0;i<pos.length;i+=3){
    const dx=pos[i]-cx,dy=pos[i+1]-cy,dz=pos[i+2]-cz;
    xx+=dx*dx;xy+=dx*dy;xz+=dx*dz;yy+=dy*dy;yz+=dy*dz;zz+=dz*dz;
  }
  // минимальное собственное число ковариации = нормаль плоскости стекла
  const tr=xx+yy+zz;
  const M=[[tr-xx,-xy,-xz],[-xy,tr-yy,-yz],[-xz,-yz,tr-zz]];
  let v=new BABYLON.Vector3(1,0.3,0.17);
  for(let it=0;it<32;it++){
    const x=M[0][0]*v.x+M[0][1]*v.y+M[0][2]*v.z;
    const y=M[1][0]*v.x+M[1][1]*v.y+M[1][2]*v.z;
    const z=M[2][0]*v.x+M[2][1]*v.y+M[2][2]*v.z;
    const len=Math.sqrt(x*x+y*y+z*z);
    if(!isFinite(len)||len<1e-12)return new BABYLON.Vector3(0,0,1);
    v.set(x/len,y/len,z/len);
  }
  return v;
}

// Обновление плоскости отражения каждый кадр (машина и регулировка зеркала двигаются)
function updateMirrorPlane(tex,mesh,localN){
  if(!mesh||mesh.isDisposed()||!car)return;
  mesh.computeWorldMatrix(true);
  const c=mesh.getBoundingInfo().boundingBox.centerWorld;
  let n=BABYLON.Vector3.TransformNormal(localN,mesh.getWorldMatrix());
  if(n.lengthSquared()<1e-12)return;
  n.normalize();
  // нормаль должна смотреть назад от машины (в сторону водителя/назад)
  const back=new BABYLON.Vector3(-Math.sin(heading),0,-Math.cos(heading));
  const away=c.subtract(car.position);away.y=0;
  const prefer=away.lengthSquared()>0.25?away:back;
  if(BABYLON.Vector3.Dot(n,prefer)<0)n=n.negate();
  tex.mirrorPlane=BABYLON.Plane.FromPositionAndNormal(c,n);
}

function mirrorRenderFilter(){
  return scene.meshes.filter(m=>{
    const mn=m.name.toLowerCase();
    return !mn.includes('mirror')&&!mn.includes('mirblink')&&!mn.includes('_pivot');
  });
}

function loadMirrorAngles(){
  syncUIFromAngles();
  applyMirrorAngles();
}
function syncUIFromAngles(){
  const lH=document.getElementById('leftH');if(lH)lH.value=mirrorAngles.left.h;
  const lV=document.getElementById('leftV');if(lV)lV.value=mirrorAngles.left.v;
  const rH=document.getElementById('rightH');if(rH)rH.value=mirrorAngles.right.h;
  const rV=document.getElementById('rightV');if(rV)rV.value=mirrorAngles.right.v;
  const lHV=document.getElementById('leftHV');if(lHV)lHV.textContent=mirrorAngles.left.h+'°';
  const lVV=document.getElementById('leftVV');if(lVV)lVV.textContent=mirrorAngles.left.v+'°';
  const rHV=document.getElementById('rightHV');if(rHV)rHV.textContent=mirrorAngles.right.h+'°';
  const rVV=document.getElementById('rightVV');if(rVV)rVV.textContent=mirrorAngles.right.v+'°';
}
function applyMirrorAngles(){
  const compose=(pivot,baseVal,yawAxis,pitchAxis,ang)=>{
    if(!pivot)return;
    const hRad=ang.h*Math.PI/180;
    const vRad=ang.v*Math.PI/180;
    const base=baseVal||BABYLON.Quaternion.Identity();
    // H — влево/вправо (вокруг вертикали), V — вверх/вниз (вокруг поперечной оси)
    const qH=BABYLON.Quaternion.RotationAxis(yawAxis||BABYLON.Axis.Y,hRad);
    const qV=BABYLON.Quaternion.RotationAxis(pitchAxis||BABYLON.Axis.X,vRad);
    pivot.rotationQuaternion=qH.multiply(qV).multiply(base);
  };
  compose(leftMirrorPivot,leftMirrorBaseQuat,leftYawAxis,leftPitchAxis,mirrorAngles.left);
  compose(rightMirrorPivot,rightMirrorBaseQuat,rightYawAxis,rightPitchAxis,mirrorAngles.right);
}
function adjustMirror(side,axis,delta){
  const key=axis==='h'?'h':'v';
  const min=axis==='h'?-45:-25;
  const max=axis==='h'?45:25;
  mirrorAngles[side][key]=Math.max(min,Math.min(max,mirrorAngles[side][key]+delta));
  const uiId=side+key.toUpperCase();
  const valId=side+key.toUpperCase()+'V';
  const slider=document.getElementById(uiId);
  const valEl=document.getElementById(valId);
  if(slider)slider.value=mirrorAngles[side][key];
  if(valEl)valEl.textContent=mirrorAngles[side][key]+'°';
  applyMirrorAngles();
}
function resetMirrorAngles(){
  mirrorAngles.left.h=DEFAULT_MIRROR_ANGLES.left.h;mirrorAngles.left.v=DEFAULT_MIRROR_ANGLES.left.v;
  mirrorAngles.right.h=DEFAULT_MIRROR_ANGLES.right.h;mirrorAngles.right.v=DEFAULT_MIRROR_ANGLES.right.v;
  syncUIFromAngles();
  applyMirrorAngles();
}

function setupMirrorReflections(modelRoot){
  const mirrors = modelRoot.getChildMeshes().filter(m => {
    const n = m.name.toLowerCase();
    return n.includes('mirror') && (n.includes('door_mesh') || n.includes('rear') || n.includes('interior') || n.includes('inside'));
  });
  
  if(!mirrors.length){
    console.log('Mirror meshes not found');
    return;
  }
  
  mirrors.forEach((mesh, i) => {
    mesh.computeWorldMatrix(true);
    const boundingInfo = mesh.getBoundingInfo();
    const center = boundingInfo.boundingBox.centerWorld;
    
    const n = mesh.name.toLowerCase();
    let name, probeKey;
    const isRear = n.includes('rear_mirror') || n.includes('interior_mirror') || 
                   (n.includes('mirror') && !n.includes('door_mesh'));
    
    if(isRear){
      name = 'rearMirror';
      probeKey = 'rear';
    } else {
      const side = center.x < 0 ? -1 : 1;
      name = side < 0 ? 'leftMirror' : 'rightMirror';
      probeKey = side < 0 ? 'left' : 'right';
    }
    
    // Создаём pivot для регулировки зеркала
    const pivot = new BABYLON.TransformNode(name + '_pivot', scene);
    // Привязываем pivot к тому же родителю, что и mesh, чтобы зеркало ехало с машиной
    pivot.parent = mesh.parent;
    // Позиция pivot должна быть в центре зеркала, чтобы вращение выглядело естественно
    const worldPos = center.clone();
    if(mesh.parent){
      const invParent = mesh.parent.getWorldMatrix().clone().invert();
      pivot.position = BABYLON.Vector3.TransformCoordinates(worldPos, invParent);
    } else {
      pivot.position.copyFrom(worldPos);
    }
    // Сохраняем базовое вращение mesh
    let baseQuat = BABYLON.Quaternion.Identity();
    if(mesh.rotationQuaternion){
      baseQuat = mesh.rotationQuaternion.clone();
    } else {
      baseQuat = BABYLON.Quaternion.FromEulerAngles(mesh.rotation.x, mesh.rotation.y, mesh.rotation.z);
    }
    // Сохраняем базовое вращение pivot с учётом вращения mesh
    pivot.rotationQuaternion = baseQuat.clone();
    // Обнуляем локальное вращение mesh (всё переносим в pivot)
    if(mesh.rotationQuaternion){
      mesh.rotationQuaternion = BABYLON.Quaternion.Identity();
    } else {
      mesh.rotation.x = mesh.rotation.y = mesh.rotation.z = 0;
    }
    // Переносим mesh как дочерний к pivot (с сохранением мировых координат)
    mesh.setParent(pivot, true);
    
    // Сохраняем ссылки
    if(probeKey === 'left'){
      leftMirrorPivot = pivot;
      leftMirrorMesh = mesh;
      leftMirrorBaseQuat = baseQuat.clone();
    } else if(probeKey === 'right'){
      rightMirrorPivot = pivot;
      rightMirrorMesh = mesh;
      rightMirrorBaseQuat = baseQuat.clone();
    }
    
    // Планарное отражение (MirrorTexture) — идеально ровное зеркало без искажений
    const tex = new BABYLON.MirrorTexture(name + "_mirrorTex", MIRROR_SIZE, scene, true);
    tex.renderList = mirrorRenderFilter();
    const localN = mirrorSurfaceNormalLocal(mesh);
    
    // Оси регулировки в системе координат родителя зеркала:
    // H — вертикаль (влево/вправо), V — горизонтальная поперечная ось (вверх/вниз)
    if(probeKey==='left'||probeKey==='right'){
      modelRoot.computeWorldMatrix(true);
      mesh.computeWorldMatrix(true);
      let normalW=BABYLON.Vector3.TransformNormal(localN,mesh.getWorldMatrix());
      normalW.y=0;
      let yawA=new BABYLON.Vector3(0,1,0),pitchA=new BABYLON.Vector3(1,0,0);
      if(normalW.lengthSquared()>1e-9){
        normalW.normalize();
        pitchA=BABYLON.Vector3.Cross(BABYLON.Axis.Y,normalW);
        if(pitchA.lengthSquared()<1e-9)pitchA=new BABYLON.Vector3(1,0,0);
        else pitchA.normalize();
      }
      const invW=pivot.parent?pivot.parent.getWorldMatrix().clone().invert():BABYLON.Matrix.Identity();
      yawA=BABYLON.Vector3.TransformNormal(yawA,invW);
      pitchA=BABYLON.Vector3.TransformNormal(pitchA,invW);
      if(probeKey==='left'){leftYawAxis=yawA;leftPitchAxis=pitchA;}
      else{rightYawAxis=yawA;rightPitchAxis=pitchA;}
    }
    
    mirrorUpdaters.push(() => updateMirrorPlane(tex, mesh, localN));
    
    // Создаём высококачественный зеркальный материал
    const mat = new BABYLON.StandardMaterial(name + "_mat", scene);
    // Базовый цвет зеркала (серебристый)
    mat.diffuseColor = new BABYLON.Color3(0.03, 0.03, 0.03);
    mat.specularColor = new BABYLON.Color3(1.0, 1.0, 1.0);
    mat.specularPower = 256;
    mat.emissiveColor = new BABYLON.Color3(0, 0, 0);
    mat.ambientColor = new BABYLON.Color3(0.1, 0.1, 0.1);
    // Отражение без fresnel — поверхность ровная, без искажений
    mat.reflectionTexture = tex;
    mat.reflectionTexture.level = 1.0;
    mat.backFaceCulling = false;
    mesh.material = mat;
    updateMirrorPlane(tex, mesh, localN);
    
    // Сохраняем текстуру для управления
    if(probeKey === 'left') leftMirrorTex = tex;
    else if(probeKey === 'right') rightMirrorTex = tex;
    else rearMirrorTex = tex;
  });
  
  // Применяем сохранённые углы
  applyMirrorAngles();
}

function updateMirrorRenderList(){
  const list = mirrorRenderFilter();
  if(leftMirrorTex) leftMirrorTex.renderList = list;
  if(rightMirrorTex) rightMirrorTex.renderList = list;
  if(rearMirrorTex) rearMirrorTex.renderList = list;
}

// ── UI обработчики для регулировки зеркал ────────────────
['leftH','leftV','rightH','rightV'].forEach(id=>{
  const el=document.getElementById(id);
  if(!el)return;
  el.addEventListener('input',()=>{
    const v=parseInt(el.value)||0;
    if(id==='leftH'){mirrorAngles.left.h=v;document.getElementById('leftHV').textContent=v+'°';}
    else if(id==='leftV'){mirrorAngles.left.v=v;document.getElementById('leftVV').textContent=v+'°';}
    else if(id==='rightH'){mirrorAngles.right.h=v;document.getElementById('rightHV').textContent=v+'°';}
    else if(id==='rightV'){mirrorAngles.right.v=v;document.getElementById('rightVV').textContent=v+'°';}
    applyMirrorAngles();
  });
});
document.getElementById('resetMirrors').addEventListener('click',resetMirrorAngles);

loadMirrorAngles();