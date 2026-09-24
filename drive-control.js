/*
 * drive-control.js — модуль нижней панели управления (мобильные устройства).
 *
 * Подключается классическим <script> ПОСЛЕ основного inline-скрипта index.html.
 * Классические скрипты делят глобальную лексическую область, поэтому:
 *   — читает общие состояния из главного скрипта: keys, CAR, steerAngle,
 *     cabMode, cabFovDeg, applyCabFov, fovEl, fovValEl, camera, setCabMode;
 *   — объявляет здесь же общие состояния поворотников (blinkerLeft/Right)
 *     и сенсорного руля (touchSteerEnabled/Angle), которые главный скрипт
 *     использует из updateCar() / toggleBlink().
 * Функции syncDvView()/syncBlinkBtns() становятся свойствами window и доступны
 * из setCabMode() и updateCar() главного скрипта.
 */

let blinkerLeft=false,blinkerRight=false;
let touchSteerEnabled=false,touchSteerAngle=0;

// ── Руль и кнопки «вперёд/назад» ────────────────────────────────
(function(){
  const dv=document.getElementById('driveCtrl');if(!dv)return;
  const fwd=document.getElementById('dvFwd'),back=document.getElementById('dvBack');
  const wheel=document.getElementById('dvWheel'),rotEl=document.getElementById('dvRot');
  const WMAX=540;
  let wAng=0,rotDrag=null;
  // Кнопки вперёд/назад: каждый палец запоминается по pointerId, отпускание
  // ловится глобально на window. Без setPointerCapture, чтобы не блокировать мультитач.
  const keyState={forward:new Set(),back:new Set()};
  const btnByKey={forward:fwd,back:back};
  const releaseKey=(key,pointerId)=>{
    const s=keyState[key];if(!s.has(pointerId))return;
    s.delete(pointerId);
    if(s.size===0){keys[key]=false;const b=btnByKey[key];if(b)b.classList.remove('on');}
  };
  const pressKey=(key,el,pointerId)=>{keyState[key].add(pointerId);keys[key]=true;if(el)el.classList.add('on');};
  fwd.addEventListener('pointerdown',e=>{e.preventDefault();pressKey('forward',fwd,e.pointerId);});
  back.addEventListener('pointerdown',e=>{e.preventDefault();pressKey('back',back,e.pointerId);});
  window.addEventListener('pointerup',e=>{releaseKey('forward',e.pointerId);releaseKey('back',e.pointerId);});
  window.addEventListener('pointercancel',e=>{releaseKey('forward',e.pointerId);releaseKey('back',e.pointerId);});

  // Сенсорный руль без захвата указателя — движение отслеживается глобально
  // по pointerId, поэтому в мультитаче остальные кнопки работают.
  wheel.addEventListener('pointerdown',e=>{
    e.preventDefault();
    const r=wheel.getBoundingClientRect(),cx=r.left+r.width/2,cy=r.top+r.height/2;
    const a=Math.atan2(e.clientY-cy,e.clientX-cx);
    const target=a*180/Math.PI+90;
    wAng=target+Math.round((wAng-target)/360)*360;
    wAng=Math.max(-WMAX,Math.min(WMAX,wAng));
    rotEl.style.transform='rotate('+wAng+'deg)';
    touchSteerEnabled=true;touchSteerAngle=(wAng/WMAX)*CAR.maxSteer;
    rotDrag={id:e.pointerId,last:a,cx,cy};
  });
  window.addEventListener('pointermove',e=>{
    if(!rotDrag||rotDrag.id!==e.pointerId)return;
    e.preventDefault();
    const a=Math.atan2(e.clientY-rotDrag.cy,e.clientX-rotDrag.cx);
    let d=a-rotDrag.last;
    while(d>Math.PI)d-=Math.PI*2;while(d<-Math.PI)d+=Math.PI*2;
    rotDrag.last=a;
    wAng=Math.max(-WMAX,Math.min(WMAX,wAng+d*180/Math.PI));
    rotEl.style.transform='rotate('+wAng+'deg)';
    touchSteerEnabled=true;touchSteerAngle=(wAng/WMAX)*CAR.maxSteer;
  });
  const endDrag=e=>{
    if(!rotDrag||rotDrag.id!==e.pointerId)return;
    rotDrag=null;touchSteerEnabled=false;
  };
  window.addEventListener('pointerup',endDrag);
  window.addEventListener('pointercancel',endDrag);
  window.addEventListener('blur',()=>{rotDrag=null;touchSteerEnabled=false;});
  window.__syncTouchWheel=()=>{
    let cur;
    if(rotDrag){cur=wAng/WMAX;}
    else{wAng=(steerAngle/CAR.maxSteer)*WMAX;cur=steerAngle/CAR.maxSteer;}
    rotEl.style.transform='rotate('+wAng+'deg)';
    const ind=document.getElementById('dvIndMarker');
    if(ind)ind.style.left=(50+cur*48)+'%';
  };
})();

// ── Кнопка переключения вида (салон / снаружи) ─────────────────
const dvView=document.getElementById('dvView');
function syncDvView(){
  if(!dvView)return;
  dvView.textContent='👁';
  dvView.classList.toggle('active',cabMode);
  dvView.setAttribute('aria-label',cabMode?'Вид: салон. Переключить наружу':'Вид: снаружи. Переключить в салон');
}
if(dvView)dvView.addEventListener('click',()=>setCabMode(!cabMode));
syncDvView();

// ── Кнопки поворотников ───────────────────────────────────────
const blkL=document.getElementById('dvBlinkL'),blkR=document.getElementById('dvBlinkR');
function syncBlinkBtns(){
  if(blkL)blkL.classList.toggle('active',blinkerLeft);
  if(blkR)blkR.classList.toggle('active',blinkerRight);
}
if(blkL)blkL.addEventListener('pointerdown',e=>{e.preventDefault();blinkerLeft=!blinkerLeft;if(blinkerLeft)blinkerRight=false;syncBlinkBtns();});
if(blkR)blkR.addEventListener('pointerdown',e=>{e.preventDefault();blinkerRight=!blinkerRight;if(blinkerRight)blinkerLeft=false;syncBlinkBtns();});

// ── Кнопки масштаба (+/−) ──────────────────────────────────────
const zIn=document.getElementById('dvZoomIn'),zOut=document.getElementById('dvZoomOut');
function applyFov(){applyCabFov();if(fovEl)fovEl.value=cabFovDeg;if(fovValEl)fovValEl.textContent=Math.round(cabFovDeg)+'°';}
function zoomStep(k){
  if(cabMode){cabFovDeg=Math.max(40,Math.min(120,cabFovDeg+(k<1?-3:3)));applyFov();return;}
  camera.radius=Math.max(camera.lowerRadiusLimit,Math.min(camera.upperRadiusLimit,camera.radius*k));
}
function zoomHold(k,dt){
  if(cabMode){cabFovDeg=Math.max(40,Math.min(120,cabFovDeg+(k<1?-1:1)*25*dt));applyFov();return;}
  const f=Math.exp(dt*Math.log(k)/0.13);
  camera.radius=Math.max(camera.lowerRadiusLimit,Math.min(camera.upperRadiusLimit,camera.radius*f));
}
function bindZoom(el,k){
  if(!el)return;
  let raf=null,lastT=0;
  const tick=t=>{
    if(!lastT)lastT=t;
    const dt=Math.min(0.1,(t-lastT)/1000);lastT=t;
    zoomHold(k,dt);
    raf=requestAnimationFrame(tick);
  };
  const stop=()=>{
    if(raf){cancelAnimationFrame(raf);raf=null;lastT=0;}
  };
  el.addEventListener('pointerdown',e=>{e.preventDefault();zoomStep(k);
    if(!raf){lastT=0;raf=requestAnimationFrame(tick);}});
  el.addEventListener('pointerup',stop);el.addEventListener('pointercancel',stop);
  el.addEventListener('pointerleave',stop);el.addEventListener('lostpointercapture',stop);
}
bindZoom(zIn,0.9);
bindZoom(zOut,1.1);

// ── Защита от контекстного меню / выделения на мобильных ─────────
document.addEventListener('contextmenu',e=>{
  const t=e.target;
  if(t&&t.closest&&(t.closest('#driveCtrl')||t.closest('#settingsWin')||t.closest('#mapEdit')))e.preventDefault();
});
document.addEventListener('selectstart',e=>{
  const t=e.target;
  if(t&&t.closest&&t.closest('#driveCtrl'))e.preventDefault();
});