/**
 * IBOM SPACE GLOBE ENGINE
 * Stripped from LoqSatGlobe v5 — Umanah Systems Group
 * Day texture only. Speed hardcoded at 0.01. No night layer.
 */

window.IbomGlobe = (function () {
  'use strict';

  const PI  = Math.PI;
  const TAU = PI * 2;

  function kpos(r, theta, inc, raan) {
    const ox = r * Math.cos(theta);
    const oz = r * Math.sin(theta);
    const ci = Math.cos(inc), si = Math.sin(inc);
    const x1 = ox, y1 = -oz * si, z1 = oz * ci;
    const cr = Math.cos(raan), sr = Math.sin(raan);
    return new THREE.Vector3(x1*cr-z1*sr, y1, x1*sr+z1*cr);
  }

  function init(containerId) {
    const el = document.getElementById(containerId);
    if (!el) { console.warn('[IbomGlobe] container not found:', containerId); return null; }

    const SPEED       = 0.01;  // hardcoded — do not expose
    const SPEED_SCALE = 60;
    const R           = 1.0;
    const SAT_BG      = 80;
    const SAT_CT      = 24;
    const SAT_EV      = 4;
    const TRAIL_CT    = 32;
    const TRAIL_EV    = 44;

    const W = el.clientWidth  || 1080;
    const H = el.clientHeight || 500;

    const renderer = new THREE.WebGLRenderer({ antialias: true, alpha: false });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
    renderer.setSize(W, H);
    renderer.toneMapping         = THREE.ACESFilmicToneMapping;
    renderer.toneMappingExposure = 1.1;
    el.innerHTML = '';
    el.appendChild(renderer.domElement);
    renderer.domElement.style.cssText = 'display:block;width:100%;height:100%;';

    const scene  = new THREE.Scene();
    scene.background = new THREE.Color(0x020406);

    const camera = new THREE.PerspectiveCamera(40, W/H, 0.005, 300);
    const cam    = { phi:0.18, theta:0, radius:3.0,
                     tPhi:0.18, tTheta:0, tRadius:3.0,
                     dragging:false, didDrag:false, px:0, py:0 };
    setupCamera(el, cam);

    /* sun — fixed position, full day side visible */
    const sunDir = new THREE.Vector3(
      Math.cos(0.25)*Math.cos(1.0),
      Math.sin(0.25),
      Math.cos(0.25)*Math.sin(1.0)
    ).normalize();

    const sunLight = new THREE.DirectionalLight(0xfff6e8, 3.2);
    sunLight.position.copy(sunDir).multiplyScalar(10);
    scene.add(sunLight);
    scene.add(new THREE.AmbientLight(0x26334a, 0.72));
    const rimLight = new THREE.DirectionalLight(0x0a1a60, 0.4);
    rimLight.position.set(-8,-1,-4);
    scene.add(rimLight);

    buildStars(scene);
    const earth = buildEarth(scene, R, renderer);
    buildAtmo(scene, R, sunDir);
    buildShells(scene, R);
    const moon = buildMoon(scene, R, renderer);

    const sats  = buildSatellites(R, SAT_BG, SAT_CT, SAT_EV, TRAIL_CT, TRAIL_EV);
    const bgPts = buildBgPoints(scene, sats);
    buildFgMeshes(scene, sats, R, TRAIL_CT, TRAIL_EV);
    const arc       = buildArc(scene);
    const orbitLine = buildOrbitLine(scene);

    let playing    = true;
    let lastT      = performance.now();
    let animId     = null;
    let selectedId = 'SAT-088';
    selectSat(selectedId, sats, orbitLine);

    /* auto-rotate when not dragging */
    let autoTheta = 0.6;

    const ro = new ResizeObserver(() => {
      const w = el.clientWidth, h = el.clientHeight;
      if (!w || !h) return;
      camera.aspect = w/h; camera.updateProjectionMatrix();
      renderer.setSize(w, h);
    });
    ro.observe(el);

    /* click to select */
    const ray = new THREE.Raycaster();
    ray.params.Mesh = { threshold: 0.04 };
    ray.near = 0.001;
    const mp = new THREE.Vector2();
    el.addEventListener('click', e => {
      if (cam.didDrag) { cam.didDrag=false; return; }
      const rc = el.getBoundingClientRect();
      mp.x =  ((e.clientX-rc.left)/rc.width)*2-1;
      mp.y = -((e.clientY-rc.top)/rc.height)*2+1;
      ray.setFromCamera(mp, camera);
      const visTargets = sats.filter(s=>s.mesh&&!s.hidden).map(s=>s.mesh);
      const hitTargets = sats.filter(s=>s.hitMesh&&!s.hidden).map(s=>s.hitMesh);
      const hits = ray.intersectObjects([...visTargets,...hitTargets]);
      if (hits.length) {
        const hit = hits[0].object;
        const s = sats.find(s=>s.mesh===hit||s.hitMesh===hit);
        if (s) { selectedId=s.id; selectSat(selectedId,sats,orbitLine); }
      }
    });

    function loop() {
      animId = requestAnimationFrame(loop);
      const now = performance.now();
      const dt  = Math.min((now-lastT)/1000, 0.05) * (playing ? SPEED : 0) * SPEED_SCALE;
      lastT = now;

      /* gentle auto-rotate when user not dragging */
      if (!cam.dragging) {
        autoTheta += 0.00012;
        cam.tTheta = autoTheta;
      } else {
        autoTheta = cam.tTheta;
      }

      cam.phi    += (cam.tPhi    - cam.phi)    * 0.08;
      cam.theta  += (cam.tTheta  - cam.theta)  * 0.08;
      cam.radius += (cam.tRadius - cam.radius) * 0.08;
      cam.phi    = Math.max(-1.35, Math.min(1.35, cam.phi));
      cam.radius = Math.max(1.45,  Math.min(8.0,  cam.radius));
      camera.position.set(
        cam.radius*Math.cos(cam.phi)*Math.sin(cam.theta),
        cam.radius*Math.sin(cam.phi),
        cam.radius*Math.cos(cam.phi)*Math.cos(cam.theta)
      );
      camera.lookAt(0,0,0);

      const earthRate = TAU/(1440*60);
      earth.day.rotation.y   += dt*earthRate;
      earth.cloud.rotation.y += dt*earthRate*1.06;
      tickMoon(moon, dt, camera);

      const camU = camera.position.clone().normalize();
      sats.forEach(s => {
        s.angle += dt*(TAU/s.period);
        const p = kpos(s.r, s.angle, s.inc, s.raan);
        s.pos.copy(p);
        const satU = p.clone().normalize();
        s.hidden = (camU.dot(satU) < -0.10) && (p.length() < R*1.38);
      });

      tickBgPoints(bgPts, sats, camera);
      tickFg(sats, camera, now, R);
      tickArc(arc, sats, now);

      if (orbitLine.visible) {
        const sel = sats.find(s=>s.id===selectedId);
        if (sel) refreshOrbitLine(orbitLine, sel);
      }

      renderer.render(scene, camera);
    }
    loop();

    return {
      destroy() {
        cancelAnimationFrame(animId);
        ro.disconnect();
        renderer.dispose();
        renderer.domElement.parentNode?.removeChild(renderer.domElement);
      }
    };
  }

  /* ── CAMERA CONTROLS ─────────────────────────────────────────── */
  function setupCamera(el, c) {
    el.style.cursor='grab';
    el.addEventListener('mousedown', e=>{
      c.dragging=true;c.didDrag=false;c.px=e.clientX;c.py=e.clientY;
      el.style.cursor='grabbing';
    });
    window.addEventListener('mousemove', e=>{
      if(!c.dragging)return;
      const dx=e.clientX-c.px,dy=e.clientY-c.py;
      if(Math.abs(dx)+Math.abs(dy)>3)c.didDrag=true;
      c.tTheta-=dx*0.006;c.tPhi-=dy*0.006;
      c.px=e.clientX;c.py=e.clientY;
    });
    window.addEventListener('mouseup',()=>{c.dragging=false;el.style.cursor='grab';});
    el.addEventListener('wheel',e=>{
      e.preventDefault();
      c.tRadius=Math.max(1.45,Math.min(8.0,c.tRadius+e.deltaY*0.006));
    },{passive:false});
    let ld=0;
    el.addEventListener('touchstart',e=>{
      if(e.touches.length===1){c.dragging=true;c.didDrag=false;c.px=e.touches[0].clientX;c.py=e.touches[0].clientY;}
      else if(e.touches.length===2)ld=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
    },{passive:true});
    el.addEventListener('touchmove',e=>{
      if(e.touches.length===1&&c.dragging){
        const dx=e.touches[0].clientX-c.px,dy=e.touches[0].clientY-c.py;
        if(Math.abs(dx)+Math.abs(dy)>3)c.didDrag=true;
        c.tTheta-=dx*0.006;c.tPhi-=dy*0.006;
        c.px=e.touches[0].clientX;c.py=e.touches[0].clientY;
      }else if(e.touches.length===2){
        const d=Math.hypot(e.touches[0].clientX-e.touches[1].clientX,e.touches[0].clientY-e.touches[1].clientY);
        c.tRadius=Math.max(1.45,Math.min(8.0,c.tRadius-(d-ld)*0.01));ld=d;
      }
    },{passive:true});
    el.addEventListener('touchend',()=>{c.dragging=false;});
  }

  /* ── STARS ───────────────────────────────────────────────────── */
  function buildStars(scene) {
    [{count:900,rMin:42,rMax:68,size:0.028,opacity:0.72},
     {count:600,rMin:70,rMax:110,size:0.04,opacity:0.9}].forEach(layer=>{
      const pos=new Float32Array(layer.count*3),col=new Float32Array(layer.count*3);
      for(let i=0;i<layer.count;i++){
        const th=Math.random()*TAU,ph=Math.acos(2*Math.random()-1);
        const r=layer.rMin+Math.random()*(layer.rMax-layer.rMin);
        pos[i*3]=r*Math.sin(ph)*Math.cos(th);pos[i*3+1]=r*Math.sin(ph)*Math.sin(th);pos[i*3+2]=r*Math.cos(ph);
        const b=0.45+Math.pow(Math.random(),2.2)*0.55,t=Math.random();
        if(t<0.10){col[i*3]=b*0.80;col[i*3+1]=b*0.88;col[i*3+2]=b;}
        else if(t<0.18){col[i*3]=b;col[i*3+1]=b*0.88;col[i*3+2]=b*0.78;}
        else{col[i*3]=b;col[i*3+1]=b;col[i*3+2]=b;}
      }
      const g=new THREE.BufferGeometry();
      g.setAttribute('position',new THREE.BufferAttribute(pos,3));
      g.setAttribute('color',new THREE.BufferAttribute(col,3));
      scene.add(new THREE.Points(g,new THREE.PointsMaterial({
        size:layer.size,vertexColors:true,transparent:true,opacity:layer.opacity,
        sizeAttenuation:true,depthWrite:false,
      })));
    });
  }

  /* ── EARTH — DAY ONLY ────────────────────────────────────────── */
  function buildEarth(scene, R, renderer) {
    const loader  = new THREE.TextureLoader();
    const aniso   = renderer.capabilities.getMaxAnisotropy
      ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 4;

    const dayMap    = loadRequiredTexture(loader, 'images/earth_day.jpg', aniso, true, '[IbomGlobe] detailed Earth texture is missing: images/earth_day.jpg');
    const cloudMap  = loadRequiredTexture(loader, 'images/earth_clouds.png', aniso, true, '[IbomGlobe] cloud texture is missing: images/earth_clouds.png');
    const normalMap = loadRequiredTexture(loader, 'images/earth_normal.jpg', aniso, false, '[IbomGlobe] Earth relief texture is missing: images/earth_normal.jpg');
    const specularMap = makeSpecularTex();

    const day = new THREE.Mesh(
      new THREE.SphereGeometry(R, 96, 96),
      new THREE.MeshPhongMaterial({
        map:         dayMap,
        normalMap:   normalMap,
        normalScale: new THREE.Vector2(0.55, 0.55),
        specularMap: specularMap,
        specular:    new THREE.Color(0x365f86),
        shininess:   18,
        emissive:    new THREE.Color(0x02060a),
        emissiveIntensity: 0.16,
      })
    );
    day.rotation.y = -0.15;
    scene.add(day);

    const cloud = new THREE.Mesh(
      new THREE.SphereGeometry(R*1.009, 72, 72),
      new THREE.MeshPhongMaterial({
        map:           cloudMap,
        transparent:   true,
        opacity:       0.24,
        depthWrite:    false,
        blending:      THREE.NormalBlending,
        emissive:      new THREE.Color(0x101822),
        emissiveIntensity: 0.05,
      })
    );
    cloud.rotation.y = day.rotation.y + 0.12;
    scene.add(cloud);

    return { day, cloud };
  }

  function applyTextureColor(texture, srgb) {
    if (!texture) return texture;
    if (srgb && THREE.sRGBEncoding !== undefined) texture.encoding = THREE.sRGBEncoding;
    else if (srgb && THREE.SRGBColorSpace !== undefined) texture.colorSpace = THREE.SRGBColorSpace;
    return texture;
  }

  function loadRequiredTexture(loader, url, aniso, srgb, warning) {
    const tex = loader.load(url, loaded => {
      loaded.anisotropy = aniso;
      applyTextureColor(loaded, srgb);
    }, undefined, err => {
      console.warn(warning, err || '');
    });
    tex.anisotropy = aniso;
    applyTextureColor(tex, srgb);
    return tex;
  }

  function canvasTexture(width, height, painter, srgb) {
    const c = document.createElement('canvas');
    c.width = width; c.height = height;
    painter(c.getContext('2d'), width, height);
    return applyTextureColor(new THREE.CanvasTexture(c), srgb);
  }

  function makeSpecularTex() {
    const W=2048,H=1024,c=document.createElement('canvas');
    c.width=W;c.height=H;const ctx=c.getContext('2d');
    ctx.fillStyle='rgb(215,215,215)';ctx.fillRect(0,0,W,H);
    function land(pts){
      ctx.beginPath();ctx.moveTo(pts[0][0]*W,pts[0][1]*H);
      for(let i=1;i<pts.length;i++){
        const mx=(pts[i-1][0]+pts[i][0])*.5*W,my=(pts[i-1][1]+pts[i][1])*.5*H;
        ctx.quadraticCurveTo(pts[i-1][0]*W,pts[i-1][1]*H,mx,my);
      }
      ctx.closePath();ctx.fillStyle='rgb(28,28,28)';ctx.fill();
    }
    land([[.01,.15],[.05,.10],[.12,.08],[.18,.10],[.23,.16],[.24,.24],[.22,.32],[.18,.40],[.14,.47],[.10,.56],[.06,.58],[.03,.48],[.02,.32]]);
    land([[.13,.53],[.18,.49],[.24,.52],[.26,.60],[.25,.70],[.21,.81],[.17,.88],[.12,.84],[.10,.72],[.10,.60]]);
    land([[.29,.08],[.35,.06],[.41,.09],[.44,.14],[.44,.20],[.39,.24],[.33,.23],[.29,.18]]);
    land([[.33,.21],[.39,.22],[.47,.28],[.52,.38],[.54,.49],[.53,.61],[.49,.72],[.45,.78],[.40,.73],[.36,.62],[.33,.48],[.31,.34]]);
    land([[.54,.03],[.63,.05],[.72,.08],[.79,.13],[.85,.22],[.88,.31],[.84,.38],[.76,.42],[.69,.43],[.60,.39],[.54,.31]]);
    land([[.66,.32],[.72,.31],[.76,.35],[.78,.41],[.76,.47],[.70,.49],[.66,.45]]);
    land([[.78,.33],[.85,.34],[.88,.40],[.86,.45],[.81,.44],[.77,.39]]);
    land([[.70,.53],[.76,.49],[.84,.50],[.88,.56],[.87,.64],[.82,.70],[.74,.69],[.69,.62]]);
    land([[.46,.77],[.53,.80],[.58,.86],[.56,.93],[.50,.95],[.45,.91],[.43,.84]]);
    const t=new THREE.CanvasTexture(c);t.anisotropy=4;return t;
  }

  /* ── ATMOSPHERE ──────────────────────────────────────────────── */
  function buildAtmo(scene, R, sunDir) {
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(R*1.05,72,72),
      new THREE.ShaderMaterial({
        uniforms:{c:{value:new THREE.Vector3(.18,.46,.95)},sunDir:{value:sunDir}},
        vertexShader:`varying vec3 vN;void main(){vN=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
        fragmentShader:`uniform vec3 c;uniform vec3 sunDir;varying vec3 vN;void main(){
          vec3 n=normalize(vN);float rim=pow(1.0-max(0.0,abs(n.z)),3.2);
          float light=smoothstep(-0.2,0.7,dot(n,normalize(sunDir)));
          float a=rim*(0.18+light*0.42);gl_FragColor=vec4(c,a);}`,
        side:THREE.BackSide,blending:THREE.AdditiveBlending,transparent:true,depthWrite:false
      })
    ));
    scene.add(new THREE.Mesh(new THREE.SphereGeometry(R*1.013,72,72),
      new THREE.ShaderMaterial({
        uniforms:{sunDir:{value:sunDir}},
        vertexShader:`varying vec3 vN;void main(){vN=normalize(normalMatrix*normal);gl_Position=projectionMatrix*modelViewMatrix*vec4(position,1.);}`,
        fragmentShader:`uniform vec3 sunDir;varying vec3 vN;void main(){
          vec3 n=normalize(vN);float day=smoothstep(-0.35,0.4,dot(n,normalize(sunDir)));
          float rim=pow(1.0-abs(n.z),5.0);gl_FragColor=vec4(0.24,0.56,1.0,rim*day*0.18);}`,
        side:THREE.BackSide,blending:THREE.AdditiveBlending,transparent:true,depthWrite:false
      })
    ));
  }

  /* ── ALTITUDE SHELLS ─────────────────────────────────────────── */
  function buildShells(scene, R) {
    [{r:R*1.105,col:0xe87c2a,op:.028},{r:R*1.185,col:0x4a8cd4,op:.018},{r:R*1.260,col:0x4a8cd4,op:.013}]
    .forEach(s=>{
      const m=new THREE.Mesh(new THREE.RingGeometry(s.r-.0006,s.r+.0006,256),
        new THREE.MeshBasicMaterial({color:s.col,side:THREE.DoubleSide,transparent:true,opacity:s.op,depthWrite:false}));
      m.rotation.x=PI/2+.10;scene.add(m);
    });
  }

  /* ── SATELLITE DATA ──────────────────────────────────────────── */
  function buildSatellites(R, SAT_BG, SAT_CT, SAT_EV, TRAIL_CT, TRAIL_EV) {
    const sats=[];
    for(let i=0;i<SAT_BG;i++){
      const r=R*(1.08+Math.random()*.32),inc=(Math.random()*160-80)*PI/180;
      const raan=Math.random()*TAU,angle=Math.random()*TAU;
      const p=kpos(r,angle,inc,raan);
      sats.push({id:`BG-${1000+i}`,type:'background',r,inc,raan,angle,period:90+Math.random()*40,
        pos:p.clone(),hidden:false,mesh:null,hitMesh:null,ring:null,trail:null,trailDots:null,
        selected:false,phOff:Math.random()*TAU,color:0x1a3060,size:.0048});
    }
    const ctDef=[
      {px:'LSC',r:1.105,inc:53,col:0xe87c2a},{px:'UMC',r:1.175,inc:71,col:0xd47020},
      {px:'RYD',r:1.095,inc:45,col:0xf09030},{px:'GOV',r:1.215,inc:38,col:0xc86018},
    ];
    for(let i=0;i<SAT_CT;i++){
      const g=ctDef[i%ctDef.length];
      const r=R*(g.r+Math.random()*.04),inc=(g.inc+(Math.random()-.5)*14)*PI/180;
      const raan=(i/SAT_CT)*TAU+Math.random()*.3,angle=Math.random()*TAU;
      const p=kpos(r,angle,inc,raan);
      sats.push({id:`${g.px}-${100+i}`,type:'controlled',r,inc,raan,angle,period:88+Math.random()*30,
        pos:p.clone(),hidden:false,mesh:null,hitMesh:null,ring:null,
        trail:{maxLen:TRAIL_CT,head:0,validCount:0,pts:Array.from({length:TRAIL_CT},()=>p.clone())},
        trailDots:null,selected:false,phOff:Math.random()*TAU,color:g.col,size:.0085});
    }
    const evDef=[
      {id:'SAT-088',inc:51.2,r:1.128},{id:'SAT-002',inc:52.0,r:1.134},
      {id:'SAT-047',inc:63.0,r:1.118},{id:'SAT-103',inc:74.5,r:1.145},
    ];
    evDef.forEach((d,i)=>{
      const r=R*d.r,inc=d.inc*PI/180,raan=(i/4)*TAU+.42,angle=Math.random()*TAU;
      const p=kpos(r,angle,inc,raan);
      sats.push({id:d.id,type:'event',r,inc,raan,angle,period:92,
        pos:p.clone(),hidden:false,mesh:null,hitMesh:null,ring:null,
        trail:{maxLen:TRAIL_EV,head:0,validCount:0,pts:Array.from({length:TRAIL_EV},()=>p.clone())},
        trailDots:null,selected:false,phOff:Math.random()*TAU,color:0xffe050,size:.0100});
    });
    return sats;
  }

  /* ── BG POINTS ───────────────────────────────────────────────── */
  function buildBgPoints(scene, sats) {
    const bgSats=sats.filter(s=>s.type==='background'),N=bgSats.length;
    const pos=new Float32Array(N*3);
    bgSats.forEach((s,i)=>{pos[i*3]=s.pos.x;pos[i*3+1]=s.pos.y;pos[i*3+2]=s.pos.z;});
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
    const pts=new THREE.Points(geo,new THREE.PointsMaterial({
      color:0x5a7ea8,size:.0105,transparent:true,opacity:.20,sizeAttenuation:true,depthWrite:false,
    }));
    scene.add(pts);
    return {pts,bgSats,posArr:pos};
  }

  function tickBgPoints(bgPts, sats, camera) {
    const {bgSats,posArr,pts}=bgPts;
    bgSats.forEach((s,i)=>{
      if(!s.hidden){posArr[i*3]=s.pos.x;posArr[i*3+1]=s.pos.y;posArr[i*3+2]=s.pos.z;}
      else{posArr[i*3]=1e6;posArr[i*3+1]=1e6;posArr[i*3+2]=1e6;}
    });
    pts.geometry.attributes.position.needsUpdate=true;
    const dist=camera.position.length();
    pts.material.size=Math.max(.006,Math.min(.018,.012*(dist/3.4)));
  }

  /* ── FG MESHES ───────────────────────────────────────────────── */
  function buildFgMeshes(scene, sats, R, TRAIL_CT, TRAIL_EV) {
    sats.filter(s=>s.type!=='background').forEach(s=>{
      const col=s.type==='event'?0xffe050:s.color;
      const emit=s.type==='event'?0xffaa20:s.color;
      const visSize=s.size*1.6;
      s.mesh=new THREE.Mesh(
        new THREE.SphereGeometry(visSize,8,8),
        new THREE.MeshPhongMaterial({color:col,emissive:emit,emissiveIntensity:s.type==='event'?1.0:0.65,shininess:70})
      );
      s.mesh.position.copy(s.pos);scene.add(s.mesh);
      const hitGeo=new THREE.SphereGeometry(visSize*12,5,5);
      s.hitMesh=new THREE.Mesh(hitGeo,new THREE.MeshBasicMaterial({transparent:true,opacity:0,depthWrite:false,depthTest:false}));
      s.hitMesh.position.copy(s.pos);scene.add(s.hitMesh);
      if(s.type==='event'){
        s.ring=new THREE.Mesh(
          new THREE.RingGeometry(s.size*2.8,s.size*4.2,40),
          new THREE.MeshBasicMaterial({color:0xffc45a,side:THREE.DoubleSide,transparent:true,opacity:.34,depthWrite:false})
        );
        s.ring.position.copy(s.pos);scene.add(s.ring);
      }
      if(s.trail){
        const LEN=s.trail.maxLen;
        const posArr=new Float32Array(LEN*3),colArr=new Float32Array(LEN*3);
        const baseCol=new THREE.Color(s.type==='event'?0xffaa20:s.color);
        for(let i=0;i<LEN;i++){
          posArr[i*3]=s.pos.x;posArr[i*3+1]=s.pos.y;posArr[i*3+2]=s.pos.z;
          colArr[i*3]=0;colArr[i*3+1]=0;colArr[i*3+2]=0;
        }
        const tg=new THREE.BufferGeometry();
        tg.setAttribute('position',new THREE.BufferAttribute(posArr,3));
        tg.setAttribute('color',new THREE.BufferAttribute(colArr,3));
        s.trailDots=new THREE.Points(tg,new THREE.PointsMaterial({
          size:s.type==='event'?.0075:.0055,vertexColors:true,transparent:true,
          opacity:s.type==='event'?.58:.34,sizeAttenuation:true,depthWrite:false,
        }));
        scene.add(s.trailDots);
        s.trail._posArr=posArr;s.trail._colArr=colArr;
        s.trail._baseR=baseCol.r;s.trail._baseG=baseCol.g;s.trail._baseB=baseCol.b;
      }
    });
  }

  function tickFg(sats, camera, now, R) {
    sats.filter(s=>s.type!=='background').forEach(s=>{
      if(!s.mesh)return;
      s.mesh.position.copy(s.pos);s.mesh.visible=!s.hidden;
      if(s.hitMesh){s.hitMesh.position.copy(s.pos);s.hitMesh.visible=!s.hidden;}
      if(s.ring){
        s.ring.position.copy(s.pos);s.ring.visible=!s.hidden;
        if(!s.hidden){
          s.ring.lookAt(camera.position);
          const pulse=.5+.5*Math.sin(now*.0025+s.phOff);
          s.ring.material.opacity=.28+pulse*.42;s.ring.scale.setScalar(1+pulse*.32);
        }
      }
      if(s.trail&&s.trailDots){
        const trail=s.trail,LEN=trail.maxLen;
        if(!s.hidden){
          trail.head=(trail.head-1+LEN)%LEN;
          trail.pts[trail.head].copy(s.pos);
          if(trail.validCount<LEN)trail.validCount++;
        }
        const posArr=trail._posArr,colArr=trail._colArr,validN=trail.validCount;
        const br=trail._baseR,bg2=trail._baseG,bb=trail._baseB;
        for(let i=0;i<LEN;i++){
          if(i<validN){
            const idx=(trail.head+i)%LEN,p=trail.pts[idx];
            posArr[i*3]=p.x;posArr[i*3+1]=p.y;posArr[i*3+2]=p.z;
            const fade=1.0-(i/validN);
            colArr[i*3]=br*fade;colArr[i*3+1]=bg2*fade;colArr[i*3+2]=bb*fade;
          }else{
            posArr[i*3]=1e6;posArr[i*3+1]=1e6;posArr[i*3+2]=1e6;
            colArr[i*3]=0;colArr[i*3+1]=0;colArr[i*3+2]=0;
          }
        }
        s.trailDots.geometry.attributes.position.needsUpdate=true;
        s.trailDots.geometry.attributes.color.needsUpdate=true;
        s.trailDots.visible=!s.hidden&&validN>0;
      }
    });
  }

  /* ── CONJUNCTION ARC ─────────────────────────────────────────── */
  function buildArc(scene) {
    const N=80,pos=new Float32Array(N*3);
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
    const line=new THREE.Line(geo,new THREE.LineBasicMaterial({
      color:0xffd78a,transparent:true,opacity:.22,depthWrite:false
    }));
    line.visible=false;scene.add(line);return line;
  }

  function tickArc(arc, sats, now) {
    const s1=sats.find(s=>s.id==='SAT-088'),s2=sats.find(s=>s.id==='SAT-002');
    if(!s1||!s2||s1.hidden||s2.hidden){arc.visible=false;return;}
    arc.visible=true;
    const N=80,p1=s1.pos,p2=s2.pos;
    const mid=new THREE.Vector3().addVectors(p1,p2).multiplyScalar(.5);
    const bulge=mid.clone().normalize().multiplyScalar(mid.length()*1.08);
    const pos=arc.geometry.attributes.position;
    for(let i=0;i<N;i++){
      const t=i/(N-1);
      const q=new THREE.Vector3().copy(p1).multiplyScalar((1-t)*(1-t))
        .addScaledVector(bulge,2*t*(1-t)).addScaledVector(p2,t*t);
      pos.setXYZ(i,q.x,q.y,q.z);
    }
    pos.needsUpdate=true;
    arc.material.opacity=.16+.08*Math.sin(now*.002);
  }

  /* ── ORBIT LINE ──────────────────────────────────────────────── */
  function buildOrbitLine(scene) {
    const N=200,pos=new Float32Array(N*3);
    const geo=new THREE.BufferGeometry();
    geo.setAttribute('position',new THREE.BufferAttribute(pos,3));
    const line=new THREE.LineLoop(geo,new THREE.LineBasicMaterial({
      color:0xffb86a,transparent:true,opacity:.36,depthWrite:false
    }));
    line.visible=false;scene.add(line);return line;
  }

  function refreshOrbitLine(line, sat) {
    const N=200,pos=line.geometry.attributes.position;
    for(let i=0;i<N;i++){
      const a=(i/N)*TAU,p=kpos(sat.r,a,sat.inc,sat.raan);
      pos.setXYZ(i,p.x,p.y,p.z);
    }
    pos.needsUpdate=true;
  }

  function selectSat(id, sats, orbitLine) {
    let found=null;
    sats.forEach(s=>{
      const sel=s.id===id;s.selected=sel;
      if(s.mesh){s.mesh.material.emissiveIntensity=sel?1.25:s.type==='event'?1.0:0.65;s.mesh.scale.setScalar(sel?1.72:1.0);}
      if(sel)found=s;
    });
    if(found){orbitLine.visible=true;refreshOrbitLine(orbitLine,found);}
    else orbitLine.visible=false;
  }

  /* ── MOON ───────────────────────────────────────────────────── */
  function buildMoon(scene, R, renderer) {
    const loader = new THREE.TextureLoader();
    const aniso = renderer.capabilities.getMaxAnisotropy
      ? Math.min(8, renderer.capabilities.getMaxAnisotropy()) : 4;
    const moonR = R * 0.18;
    const basePos = new THREE.Vector3(-2.2, 1.0, 0.2);

    const moonMap = loadRequiredTexture(loader, 'images/moon.png', aniso, true, '[IbomGlobe] Moon texture is missing: images/moon.png');
    const moonMesh = new THREE.Mesh(
      new THREE.SphereGeometry(moonR, 48, 48),
      new THREE.MeshPhongMaterial({
        map: moonMap,
        color: new THREE.Color(0xd7d9df),
        emissive: new THREE.Color(0x252a36),
        emissiveIntensity: 0.16,
        shininess: 4,
      })
    );

    const halo = new THREE.Mesh(
      new THREE.PlaneGeometry(moonR * 5.2, moonR * 5.2),
      new THREE.MeshBasicMaterial({
        map: makeMoonHaloTex(),
        transparent: true,
        opacity: 0.82,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
        side: THREE.DoubleSide,
      })
    );

    const group = new THREE.Object3D();
    group.add(moonMesh);
    group.add(halo);
    scene.add(group);
    group.position.copy(basePos);

    return { group, moonMesh, halo, basePos, drift: 0 };
  }

  function tickMoon(moon, dt, camera) {
    if (!moon || !moon.group) return;
    moon.drift += dt * 0.0008;
    moon.group.position.set(
      moon.basePos.x + Math.sin(moon.drift) * 0.04,
      moon.basePos.y + Math.cos(moon.drift * 0.8) * 0.025,
      moon.basePos.z
    );
    moon.moonMesh.rotation.y += 0.00018;
    moon.moonMesh.rotation.x = -0.08;
    if (moon.halo && camera) moon.halo.lookAt(camera.position);
  }

  function makeFallbackMoonTex() {
    return canvasTexture(512, 512, (ctx, W, H) => {
      const g = ctx.createRadialGradient(W*.38,H*.35,4,W*.5,H*.5,W*.52);
      g.addColorStop(0,'#c8ccd4');
      g.addColorStop(.55,'#8e929c');
      g.addColorStop(1,'#5f636d');
      ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
      for(let i=0;i<90;i++){
        const x=Math.random()*W,y=Math.random()*H,r=2+Math.random()*16;
        ctx.beginPath();ctx.arc(x,y,r,0,TAU);
        ctx.fillStyle='rgba(50,52,60,.18)';ctx.fill();
        ctx.strokeStyle='rgba(220,224,234,.22)';ctx.lineWidth=1;ctx.stroke();
      }
    }, true);
  }

  function makeMoonHaloTex() {
    return canvasTexture(128, 128, (ctx, W, H) => {
      ctx.clearRect(0,0,W,H);
      const g = ctx.createRadialGradient(W/2,H/2,0,W/2,H/2,W/2);
      g.addColorStop(0,'rgba(210,225,255,0.20)');
      g.addColorStop(.42,'rgba(100,160,255,0.08)');
      g.addColorStop(1,'rgba(0,0,0,0)');
      ctx.fillStyle = g; ctx.fillRect(0,0,W,H);
    }, true);
  }

  return { init };
})();
