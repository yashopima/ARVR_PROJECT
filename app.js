// ============================================================
// app.js  — AuraSpace 3D Furniture Viewer
// ============================================================
// Features:
//  • Room photo → applied to <a-sky> as immersive 3D backdrop (fixed)
//  • Furniture image → placed as <a-image>, draggable via mouse/touch
//  • Scale & Rotate sliders for furniture
//  • Antigravity float animation
//  • Reset all
// ============================================================

// ── Register pseudo-3d BEFORE the scene parses ──────────────
AFRAME.registerComponent('pseudo-3d', {
  schema: {
    src: { type: 'string', default: '' },
    width: { type: 'number', default: 1.6 },
    height: { type: 'number', default: 1.6 },
    layers: { type: 'number', default: 15 },
    depth: { type: 'number', default: 0.08 }
  },
  update: function () {
    if (this.el.getObject3D('mesh')) {
      this.el.removeObject3D('mesh');
    }
    if (!this.data.src) return;

    const loader = new THREE.TextureLoader();
    loader.load(this.data.src, (texture) => {
      // Standard material for shadows and lighting
      const material = new THREE.MeshStandardMaterial({
        map: texture,
        transparent: true,
        alphaTest: 0.1,  // Discards transparent background so layers stack cleanly
        side: THREE.DoubleSide,
        roughness: 0.7,
        metalness: 0.1
      });

      const group = new THREE.Group();
      const step = this.data.depth / this.data.layers;
      const geo = new THREE.PlaneGeometry(this.data.width, this.data.height);
      
      for (let i = 0; i < this.data.layers; i++) {
        const mesh = new THREE.Mesh(geo, material);
        mesh.position.z = - (i * step);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        group.add(mesh);
      }
      
      this.el.setObject3D('mesh', group);
    });
  }
});

// ── Register drag-move BEFORE the scene parses ──────────────
AFRAME.registerComponent('drag-move', {
  init: function () {
    const el    = this.el;
    const scene = el.sceneEl;

    this.dragging   = false;
    this.plane      = new THREE.Plane();
    this.raycaster  = new THREE.Raycaster();
    this.mouse      = new THREE.Vector2();
    this.offset     = new THREE.Vector3();
    this.intersection = new THREE.Vector3();

    // ── helpers ──
    const getClient = (e) => e.touches
      ? { x: e.touches[0].clientX, y: e.touches[0].clientY }
      : { x: e.clientX,            y: e.clientY };

    const toNDC = (cx, cy) => {
      const rect = scene.canvas.getBoundingClientRect();
      return {
        x:  ((cx - rect.left) / rect.width)  * 2 - 1,
        y: -((cy - rect.top)  / rect.height) * 2 + 1,
      };
    };

    const setLookControls = (enabled) => {
      const cam = scene.querySelector('[camera]');
      if (cam) cam.setAttribute('look-controls', 'enabled', enabled);
    };

    // ── mousedown / touchstart ──
    this._onDown = (e) => {
      if (!el.getAttribute('visible')) return;
      const { x, y } = getClient(e);
      const ndc = toNDC(x, y);
      this.mouse.set(ndc.x, ndc.y);

      const cam = scene.camera;
      this.raycaster.setFromCamera(this.mouse, cam);

      const mesh = el.getObject3D('mesh');
      if (!mesh) return;

      const hits = this.raycaster.intersectObject(mesh, true);
      if (hits.length === 0) return;

      this.dragging = true;
      setLookControls(false);

      // Build a plane facing the camera at the hit point
      const normal = new THREE.Vector3();
      cam.getWorldDirection(normal);
      this.plane.setFromNormalAndCoplanarPoint(normal, hits[0].point);
      this.offset.copy(hits[0].point).sub(el.object3D.position);

      e.stopPropagation && e.stopPropagation();
    };

    // ── mousemove / touchmove ──
    this._onMove = (e) => {
      if (!this.dragging) return;
      const { x, y } = getClient(e);
      const ndc = toNDC(x, y);
      this.mouse.set(ndc.x, ndc.y);

      this.raycaster.setFromCamera(this.mouse, scene.camera);
      if (this.raycaster.ray.intersectPlane(this.plane, this.intersection)) {
        el.object3D.position.copy(this.intersection.clone().sub(this.offset));
      }
    };

    // ── mouseup / touchend ──
    this._onUp = () => {
      if (!this.dragging) return;
      this.dragging = false;
      setLookControls(true);
    };

    const canvas = scene.canvas;
    canvas.addEventListener('mousedown',  this._onDown, false);
    canvas.addEventListener('mousemove',  this._onMove, false);
    canvas.addEventListener('mouseup',    this._onUp,   false);
    canvas.addEventListener('touchstart', this._onDown, { passive: true });
    canvas.addEventListener('touchmove',  this._onMove, { passive: true });
    canvas.addEventListener('touchend',   this._onUp,   false);
  },

  remove: function () {
    const canvas = this.el.sceneEl.canvas;
    canvas.removeEventListener('mousedown',  this._onDown);
    canvas.removeEventListener('mousemove',  this._onMove);
    canvas.removeEventListener('mouseup',    this._onUp);
    canvas.removeEventListener('touchstart', this._onDown);
    canvas.removeEventListener('touchmove',  this._onMove);
    canvas.removeEventListener('touchend',   this._onUp);
  }
});

// ── Helper: Remove Background using Flood Fill ───────────────
function removeBackgroundCanvas(img) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  canvas.width = img.width;
  canvas.height = img.height;
  ctx.drawImage(img, 0, 0);

  const imageData = ctx.getImageData(0, 0, canvas.width, canvas.height);
  const data = imageData.data;

  // Background color from top-left pixel
  const bgR = data[0], bgG = data[1], bgB = data[2];
  const threshold = 40; 

  const w = canvas.width, h = canvas.height;
  const visited = new Uint8Array(w * h);
  const q = [];

  const addPoint = (x, y) => {
    if (x >= 0 && x < w && y >= 0 && y < h) {
      const idx = y * w + x;
      if (!visited[idx]) {
        const p = idx * 4;
        const r = data[p], g = data[p+1], b = data[p+2], a = data[p+3];
        if (a > 0 && Math.abs(r - bgR) < threshold && Math.abs(g - bgG) < threshold && Math.abs(b - bgB) < threshold) {
          visited[idx] = 1;
          data[p+3] = 0; // Transparent
          q.push(x, y);
        }
      }
    }
  };

  for(let x=0; x<w; x++) { addPoint(x, 0); addPoint(x, h-1); }
  for(let y=0; y<h; y++) { addPoint(0, y); addPoint(w-1, y); }

  while(q.length > 0) {
    const y = q.pop();
    const x = q.pop();
    addPoint(x+1, y);
    addPoint(x-1, y);
    addPoint(x, y+1);
    addPoint(x, y-1);
  }

  ctx.putImageData(imageData, 0, 0);
  return canvas.toDataURL('image/png');
}

// ── Helper: read a File as DataURL ──────────────────────────
function readFile(file) {
  return new Promise((res, rej) => {
    const r = new FileReader();
    r.onload  = () => res(r.result);
    r.onerror = rej;
    r.readAsDataURL(file);
  });
}

// ── Socket.IO / Network ──────────────────────────────────────
let socket = null;
let serverBaseUrl = `http://${window.location.host || 'localhost:3000'}`;

if (window.location.protocol === 'file:') {
  console.warn("Running via file:// — Mobile upload requires the Node.js server.");
}

if (typeof io !== 'undefined') {
  socket = io();
  
  socket.on('server-info', (info) => {
    if (info.ip && info.ip !== 'localhost') {
      serverBaseUrl = `http://${info.ip}:${info.port}`;
    }
  });

  socket.on('receive-image', (data) => {
    // Hide QR modal
    qrModal.classList.add('hidden');
    
    // Simulate file upload with DataURL
    fetch(data.image)
      .then(res => res.blob())
      .then(blob => {
        const file = new File([blob], "phone_upload.png", { type: "image/png" });
        const fakeEvent = { target: { files: [file] } };
        if (data.target === 'room') {
          handleRoomUpload(fakeEvent);
        } else {
          handleFurnitureUpload(fakeEvent);
        }
      });
  });
}

function showQR(target) {
  if (window.location.protocol === 'file:') {
    // Attempt to redirect the user to the local server automatically
    alert('Switching to Local Server Mode to connect to your phone...');
    window.location.href = 'http://localhost:3000';
    return;
  }
  
  const url = `${serverBaseUrl}/mobile?target=${target}`;
  document.getElementById('qr-img').src = `https://api.qrserver.com/v1/create-qr-code/?size=250x250&data=${encodeURIComponent(url)}`;
  qrModal.classList.remove('hidden');
}

// ── DOM refs ────────────────────────────────────────────────
const btnUploadRoom       = document.getElementById('btn-upload-room');
const btnCameraRoom       = document.getElementById('btn-camera-room');
const fileRoomInput       = document.getElementById('file-room');
const fileRoomCamInput    = document.getElementById('file-room-cam');
const roomDoneDiv         = document.getElementById('room-done');
const btnChangeRoom       = document.getElementById('btn-change-room');
const roomUploadArea      = document.getElementById('room-upload-area');

const btnUploadFurniture  = document.getElementById('btn-upload-furniture');
const btnCameraFurniture  = document.getElementById('btn-camera-furniture');
const fileFurnitureInput  = document.getElementById('file-furniture');
const fileFurnitureCamInput = document.getElementById('file-furniture-cam');
const furnitureDoneDiv    = document.getElementById('furniture-done');
const btnChangeFurniture  = document.getElementById('btn-change-furniture');
const furnitureUploadArea = document.getElementById('furniture-upload-area');
const transformControls   = document.getElementById('transform-controls');

const stepFurniture = document.getElementById('step-furniture');

const scaleSlider  = document.getElementById('scale-slider');
const rotateSlider = document.getElementById('rotate-slider');

const btnAntigravity    = document.getElementById('btn-antigravity');
const statusAntigravity = document.getElementById('status-antigravity');
const btnReset          = document.getElementById('btn-reset');
const zoomSlider       = document.getElementById('zoom-slider');
const dragHint          = document.getElementById('drag-hint');

const btnToggleUI       = document.getElementById('btn-toggle-ui');
const uiContainer       = document.getElementById('ui-container');

// AuraSync Refs
const brightnessSlider  = document.getElementById('brightness-slider');
const contrastSlider    = document.getElementById('contrast-slider');
const shadowSlider      = document.getElementById('shadow-slider');
const btnVoice          = document.getElementById('btn-voice');
const statusVoice       = document.getElementById('status-voice');
const auraStatusBar     = document.getElementById('aurasync-status');
const auraStatusText    = document.getElementById('aura-status-text');

// AuraGesture Refs
const btnGesture        = document.getElementById('btn-gesture');
const statusGesture     = document.getElementById('status-gesture');
const gestureMonitor    = document.getElementById('gesture-monitor-wrap');
const gestureVideo      = document.getElementById('gesture-video');

const qrModal           = document.getElementById('qr-modal');
document.getElementById('btn-close-qr').addEventListener('click', () => {
  qrModal.classList.add('hidden');
});

// ── Upload Options Modal ──────────────────────────────────────
const uploadOptionsModal = document.getElementById('upload-options-modal');
let currentUploadTarget = null; // 'room' or 'furniture'

document.getElementById('btn-close-options').addEventListener('click', () => {
  uploadOptionsModal.classList.add('hidden');
});

document.getElementById('btn-opt-computer').addEventListener('click', () => {
  uploadOptionsModal.classList.add('hidden');
  if (currentUploadTarget === 'room') fileRoomInput.click();
  else if (currentUploadTarget === 'furniture') fileFurnitureInput.click();
});

document.getElementById('btn-opt-mobile').addEventListener('click', () => {
  uploadOptionsModal.classList.add('hidden');
  showQR(currentUploadTarget);
});

// ── A-Frame scene refs (after scene is ready) ────────────────
let skyEl       = null;
let furnitureEl = null;

const initApp = () => {
  skyEl       = document.getElementById('sky-bg');
  furnitureEl = document.getElementById('furniture-image');
  document.getElementById('loading-screen').classList.add('hidden');
  console.log("AuraSpace: UI Initialized");
};

// Safety timeout: Hide loading screen if scene takes > 5s
const loadingTimeout = setTimeout(() => {
  if (!document.getElementById('loading-screen').classList.contains('hidden')) {
    console.warn("AuraSpace: Scene took too long to load, forcing initialization...");
    initApp();
  }
}, 5000);

document.querySelector('a-scene').addEventListener('loaded', () => {
  clearTimeout(loadingTimeout);
  initApp();
});

// ── Toggle UI ────────────────────────────────────────────────
btnToggleUI.addEventListener('click', () => {
  const isCollapsed = uiContainer.classList.toggle('collapsed');
  btnToggleUI.innerHTML = isCollapsed ? '👁️ Show UI' : '👁️ Hide UI';
});

// ── Room upload ──────────────────────────────────────────────
btnUploadRoom.addEventListener('click', () => {
  currentUploadTarget = 'room';
  uploadOptionsModal.classList.remove('hidden');
});
btnCameraRoom.addEventListener('click', () => openCamera('room'));

const handleRoomUpload = async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const dataURL = await readFile(file);
    // Apply to sky — gives a clear, immersive 3D environment
    const tex = new Image();
    tex.src = dataURL;
    tex.onload = () => {
      skyEl.setAttribute('src', dataURL);
      skyEl.removeAttribute('color');
      // AuraSync: Match lighting to photo
      syncLightingWithPhoto(tex);
    };

    // UI
    roomUploadArea.classList.add('hidden');
    roomDoneDiv.classList.remove('hidden');
    stepFurniture.classList.remove('disabled');
  } catch (err) {
    console.error('Room upload failed', err);
  }
};

fileRoomInput.addEventListener('change', handleRoomUpload);
fileRoomCamInput.addEventListener('change', handleRoomUpload);

btnChangeRoom.addEventListener('click', () => {
  skyEl.setAttribute('color', '#0d0d1f');
  skyEl.removeAttribute('src');
  roomUploadArea.classList.remove('hidden');
  roomDoneDiv.classList.add('hidden');
  stepFurniture.classList.add('disabled');
  fileRoomInput.value = '';
  fileRoomCamInput.value = '';
});

// ── Furniture image upload ───────────────────────────────────
btnUploadFurniture.addEventListener('click', () => {
  currentUploadTarget = 'furniture';
  uploadOptionsModal.classList.remove('hidden');
});
btnCameraFurniture.addEventListener('click', () => openCamera('furniture'));

const handleFurnitureUpload = async (e) => {
  const file = e.target.files[0];
  if (!file) return;

  try {
    const dataURL = await readFile(file);

    let img = new Image();
    img.src = dataURL;
    await new Promise((r) => img.onload = r);

    // 1. Resize large phone images before processing to prevent crashes
    const MAX_DIM = 800;
    if (img.width > MAX_DIM || img.height > MAX_DIM) {
      let w = img.width, h = img.height;
      if (w > h) { h = Math.round(h * (MAX_DIM / w)); w = MAX_DIM; } 
      else { w = Math.round(w * (MAX_DIM / h)); h = MAX_DIM; }
      
      const tmpCanvas = document.createElement('canvas');
      tmpCanvas.width = w; tmpCanvas.height = h;
      tmpCanvas.getContext('2d').drawImage(img, 0, 0, w, h);
      
      const resizedImg = new Image();
      resizedImg.src = tmpCanvas.toDataURL('image/png');
      await new Promise((r) => resizedImg.onload = r);
      img = resizedImg; // Replace with resized version
    }

    // 2. Remove background
    const processedDataURL = removeBackgroundCanvas(img);
    
    // Create an image to get the final dimensions and ensure it's loaded
    const finalImg = new Image();
    finalImg.src = processedDataURL;
    await new Promise((r) => { finalImg.onload = r; });

    const aspect = finalImg.width / finalImg.height;
    const h = 1.6;
    const w = h * aspect;

    // Apply to <a-entity> using pseudo-3d
    furnitureEl.setAttribute('pseudo-3d', {
      src: processedDataURL,
      width: w,
      height: h
    });
    furnitureEl.setAttribute('position', '0 1.1 -1.5');
    furnitureEl.setAttribute('visible', true);

    // Reset sliders
    scaleSlider.value  = 1;
    rotateSlider.value = 0;
    furnitureEl.object3D.scale.set(1, 1, 1);
    furnitureEl.object3D.rotation.set(0, 0, 0);

    // UI
    furnitureUploadArea.classList.add('hidden');
    furnitureDoneDiv.classList.remove('hidden');
    transformControls.classList.remove('hidden');

    // Show drag hint briefly
    dragHint.classList.remove('hidden');
    setTimeout(() => dragHint.classList.add('hidden'), 4000);
  } catch (err) {
    console.error('Furniture upload failed', err);
  }
};

fileFurnitureInput.addEventListener('change', handleFurnitureUpload);
fileFurnitureCamInput.addEventListener('change', handleFurnitureUpload);

btnChangeFurniture.addEventListener('click', () => {
  furnitureEl.setAttribute('visible', false);
  furnitureUploadArea.classList.remove('hidden');
  furnitureDoneDiv.classList.add('hidden');
  transformControls.classList.add('hidden');
  fileFurnitureInput.value = '';
  fileFurnitureCamInput.value = '';
  stopAntigravity();
});

// ── Scale slider ─────────────────────────────────────────────
scaleSlider.addEventListener('input', () => {
  const s = parseFloat(scaleSlider.value);
  furnitureEl.object3D.scale.set(s, s, s);
});

// ── Rotate slider ────────────────────────────────────────────
rotateSlider.addEventListener('input', () => {
  const deg = parseFloat(rotateSlider.value);
  furnitureEl.setAttribute('rotation', `0 ${deg} 0`);
});

// ── Antigravity ──────────────────────────────────────────────
let antigravityActive = false;
let animFrame = null;
let agBaseY = 1.1;
let agT = 0;

function stopAntigravity() {
  antigravityActive = false;
  statusAntigravity.textContent = 'OFF';
  btnAntigravity.classList.remove('active');
  if (animFrame) cancelAnimationFrame(animFrame);
  animFrame = null;
}

btnAntigravity.addEventListener('click', () => {
  if (!furnitureEl || !furnitureEl.getAttribute('visible')) return;

  antigravityActive = !antigravityActive;

  if (antigravityActive) {
    statusAntigravity.textContent = 'ON';
    btnAntigravity.classList.add('active');
    agBaseY = furnitureEl.object3D.position.y;
    agT = 0;
    const loop = () => {
      if (!antigravityActive) return;
      agT += 0.02;
      const floatY = agBaseY + Math.sin(agT) * 0.25 + 0.1;
      furnitureEl.object3D.position.y = floatY;
      animFrame = requestAnimationFrame(loop);
    };
    loop();
  } else {
    stopAntigravity();
  }
});

// ── Keyboard Controls ────────────────────────────────────────
window.addEventListener('keydown', (e) => {
  if (!furnitureEl || !furnitureEl.getAttribute('visible')) return;
  
  const step = 0.1;
  const rotStep = 5;

  const pos = furnitureEl.object3D.position;
  let currentRot = parseFloat(rotateSlider.value);

  switch(e.key) {
    case 'w': case 'W':
      pos.z -= step; // move further away
      break;
    case 's': case 'S':
      pos.z += step; // move closer
      break;
    case 'a': case 'A':
      pos.x -= step; // move left
      break;
    case 'd': case 'D':
      pos.x += step; // move right
      break;
    case 'ArrowUp':
      pos.y += step; // move up
      break;
    case 'ArrowDown':
      pos.y -= step; // move down
      break;
    case 'q': case 'Q':
      currentRot -= rotStep;
      rotateSlider.value = currentRot;
      furnitureEl.setAttribute('rotation', `0 ${currentRot} 0`);
      break;
    case 'e': case 'E':
      currentRot += rotStep;
      rotateSlider.value = currentRot;
      furnitureEl.setAttribute('rotation', `0 ${currentRot} 0`);
      break;
  }
});

// ── Reset All ────────────────────────────────────────────────
btnReset.addEventListener('click', () => {
  // Reset room
  skyEl.setAttribute('color', '#0d0d1f');
  skyEl.removeAttribute('src');
  roomUploadArea.classList.remove('hidden');
  roomDoneDiv.classList.add('hidden');
  fileRoomInput.value = '';
  fileRoomCamInput.value = '';

  // Reset furniture
  furnitureEl.setAttribute('visible', false);
  furnitureUploadArea.classList.remove('hidden');
  furnitureDoneDiv.classList.add('hidden');
  transformControls.classList.add('hidden');
  fileFurnitureInput.value = '';
  fileFurnitureCamInput.value = '';

  // Reset step 2
  stepFurniture.classList.add('disabled');

  // Reset antigravity
  stopAntigravity();

  // Reset sliders
  scaleSlider.value  = 1;
  rotateSlider.value = 0;
});

// ── WebRTC Camera Logic ──────────────────────────────────────
let currentStream = null;
let cameraTarget = null;
let useFrontCamera = false;

async function openCamera(target) {
  cameraTarget = target;
  document.getElementById('camera-modal').classList.remove('hidden');
  startCamera();
}

async function startCamera() {
  if (currentStream) {
    currentStream.getTracks().forEach(t => t.stop());
  }
  const constraints = {
    video: { facingMode: useFrontCamera ? "user" : "environment" }
  };
  try {
    currentStream = await navigator.mediaDevices.getUserMedia(constraints);
    const videoEl = document.getElementById('camera-feed');
    videoEl.srcObject = currentStream;
    // Mirror video feed visually if using front camera
    videoEl.style.transform = useFrontCamera ? 'scaleX(-1)' : 'scaleX(1)';
  } catch (err) {
    console.error("Camera access error:", err);
    alert("Could not access camera. Please check permissions or try on a secure HTTPS connection.");
    stopCamera();
  }
}

function stopCamera() {
  if (currentStream) {
    currentStream.getTracks().forEach(t => t.stop());
    currentStream = null;
  }
  document.getElementById('camera-modal').classList.add('hidden');
}

document.getElementById('btn-close-camera').addEventListener('click', stopCamera);

document.getElementById('btn-flip-camera').addEventListener('click', () => {
  useFrontCamera = !useFrontCamera;
  startCamera();
});

document.getElementById('btn-snap-camera').addEventListener('click', () => {
  const video = document.getElementById('camera-feed');
  const canvas = document.createElement('canvas');
  canvas.width = video.videoWidth;
  canvas.height = video.videoHeight;
  const ctx = canvas.getContext('2d');
  
  if (useFrontCamera) {
    ctx.translate(canvas.width, 0);
    ctx.scale(-1, 1);
  }
  ctx.drawImage(video, 0, 0, canvas.width, canvas.height);
  
  const dataURL = canvas.toDataURL('image/png');
  stopCamera();
  
  fetch(dataURL)
    .then(res => res.blob())
    .then(blob => {
      const file = new File([blob], "camera_capture.png", { type: "image/png" });
      const fakeEvent = { target: { files: [file] } };
      if (cameraTarget === 'room') {
        handleRoomUpload(fakeEvent);
      } else {
        handleFurnitureUpload(fakeEvent);
      }
    });
});

// ── AuraSync: Image Color Analysis ───────────────────────────
function syncLightingWithPhoto(img) {
  const canvas = document.createElement('canvas');
  const ctx = canvas.getContext('2d');
  canvas.width = 100; // Increased resolution for better sampling
  canvas.height = 100;
  ctx.drawImage(img, 0, 0, 100, 100);
  
  // 1. Average Global Color for Scene Lighting
  const globalData = ctx.getImageData(0, 0, 100, 100).data;
  let gr = 0, gg = 0, gb = 0;
  for (let i = 0; i < globalData.length; i += 4) {
    gr += globalData[i];
    gg += globalData[i+1];
    gb += globalData[i+2];
  }
  const gCount = globalData.length / 4;
  const avgColor = `rgb(${Math.round(gr/gCount)}, ${Math.round(gg/gCount)}, ${Math.round(gb/gCount)})`;
  
  // Apply to lights
  document.getElementById('ambient-light').setAttribute('light', 'color', avgColor);
  document.getElementById('main-light').setAttribute('light', 'color', avgColor);
  
  // 2. Floor Color Sync: Sample from bottom center (where floor is)
  const floorData = ctx.getImageData(40, 80, 20, 20).data;
  let fr = 0, fg = 0, fb = 0;
  for (let i = 0; i < floorData.length; i += 4) {
    fr += floorData[i];
    fg += floorData[i+1];
    fb += floorData[i+2];
  }
  const fCount = floorData.length / 4;
  const floorColor = `rgb(${Math.round(fr/fCount)}, ${Math.round(fg/fCount)}, ${Math.round(fb/fCount)})`;
  
  const roomFloor = document.getElementById('room-floor');
  if (roomFloor) {
    roomFloor.setAttribute('material', 'color', floorColor);
    roomFloor.setAttribute('material', 'opacity', 0.9); // Slight transparency for blending
  }

  // Update grid color to match
  const floorGrid = document.querySelector('#floor-grid a-plane');
  if (floorGrid) {
    floorGrid.setAttribute('material', 'color', floorColor);
  }
  
  console.log("AuraSync: Environment Synced. Floor Color mapped to:", floorColor);
}

// ── AuraSync: Voice Control ──────────────────────────────────
let recognition = null;
let isVoiceActive = false;

function initVoiceControl() {
  const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
  if (!SpeechRecognition) {
    alert("Voice control is not supported in this browser. Try Chrome.");
    return;
  }
  
  recognition = new SpeechRecognition();
  recognition.continuous = true;
  recognition.lang = 'en-US';
  recognition.interimResults = false;
  
  recognition.onresult = (event) => {
    const command = event.results[event.results.length - 1][0].transcript.toLowerCase();
    processVoiceCommand(command);
  };
  
  recognition.onend = () => {
    if (isVoiceActive) try { recognition.start(); } catch(e) {}
  };
}

function extractMultiplier(cmd) {
  const numMap = { 'one':1, 'two':2, 'three':3, 'four':4, 'five':5, 'twice':2, 'thrice':3 };
  const words = cmd.split(' ');
  for (let word of words) {
    if (numMap[word]) return numMap[word];
    const n = parseInt(word);
    if (!isNaN(n)) return n;
  }
  return 1;
}

function processVoiceCommand(cmd) {
  if (!furnitureEl || !furnitureEl.getAttribute('visible')) {
    if (!(cmd.includes('show') || cmd.includes('visible') || cmd.includes('appear'))) return;
  }
  
  const pos = furnitureEl.getAttribute('position');
  const rot = furnitureEl.getAttribute('rotation') || {x:0, y:0, z:0};
  const scale = furnitureEl.object3D.scale.x;
  
  const mult = extractMultiplier(cmd);
  let processed = false;

  // Move Commands (Comprehensive Synonyms)
  if (cmd.includes('left') || cmd.includes('west') || cmd.includes('slide left')) { pos.x -= 0.5 * mult; processed = true; }
  if (cmd.includes('right') || cmd.includes('east') || cmd.includes('slide right')) { pos.x += 0.5 * mult; processed = true; }
  if (cmd.includes('forward') || cmd.includes('up') || cmd.includes('north') || cmd.includes('forth') || cmd.includes('push')) { pos.z -= 0.5 * mult; processed = true; }
  if (cmd.includes('backward') || cmd.includes('down') || cmd.includes('south') || cmd.includes('back') || cmd.includes('pull')) { pos.z += 0.5 * mult; processed = true; }
  
  // Scale Commands (Comprehensive Synonyms)
  if (cmd.includes('bigger') || cmd.includes('increase') || cmd.includes('scale up') || cmd.includes('grow') || cmd.includes('enlarge') || cmd.includes('huge') || cmd.includes('maximize')) {
    const s = Math.min(4, scale + (0.3 * mult));
    furnitureEl.object3D.scale.set(s, s, s);
    processed = true;
  }
  if (cmd.includes('smaller') || cmd.includes('decrease') || cmd.includes('scale down') || cmd.includes('shrink') || cmd.includes('tiny') || cmd.includes('little') || cmd.includes('minimize')) {
    const s = Math.max(0.3, scale - (0.3 * mult));
    furnitureEl.object3D.scale.set(s, s, s);
    processed = true;
  }
  
  // Rotate Commands
  if (cmd.includes('rotate') || cmd.includes('spin') || cmd.includes('turn') || cmd.includes('twist')) { 
    rot.y += 45 * mult; 
    processed = true; 
  }

  // Position Anchors
  if (cmd.includes('corner')) {
    pos.x = cmd.includes('right') ? 3 : -3;
    pos.z = -4; 
    processed = true;
  }

  // COLOR CONTROL (New Novel Feature)
  const colors = { 
    'red': '#ff4d4d', 'blue': '#4d94ff', 'green': '#4dff88', 
    'yellow': '#ffff4d', 'white': '#ffffff', 'black': '#333333', 
    'orange': '#ffaa33', 'purple': '#aa33ff', 'original': '#ffffff' 
  };
  for (let colorName in colors) {
    if (cmd.includes(colorName)) {
      const mesh = furnitureEl.getObject3D('mesh');
      if (mesh) {
        mesh.traverse(node => {
          if (node.material) node.material.color.set(colors[colorName]);
        });
      }
      processed = true;
    }
  }

  // Visibility Control
  if (cmd.includes('hide') || cmd.includes('invisible') || cmd.includes('remove') || cmd.includes('vanish')) {
    furnitureEl.setAttribute('visible', false);
    processed = true;
  }
  if (cmd.includes('show') || cmd.includes('visible') || cmd.includes('appear')) {
    furnitureEl.setAttribute('visible', true);
    processed = true;
  }

  // Reset Commands
  if (cmd.includes('reset') || cmd.includes('center') || cmd.includes('middle') || cmd.includes('default')) {
    pos.x = 0; pos.y = 1.1; pos.z = -1.5;
    furnitureEl.object3D.scale.set(1, 1, 1);
    rot.y = 0;
    const mesh = furnitureEl.getObject3D('mesh');
    if (mesh) mesh.traverse(node => { if (node.material) node.material.color.set('#ffffff'); });
    processed = true;
  }

  if (processed) {
    furnitureEl.setAttribute('position', pos);
    furnitureEl.setAttribute('rotation', rot);
    
    // Visual feedback
    auraStatusText.textContent = `Heard: "${cmd}"`;
    
    // Reset status text after a while if still active
    setTimeout(() => {
      if (isVoiceActive) auraStatusText.textContent = 'Voice Active...';
    }, 2000);
  }
}

function toggleVoice(forceState) {
  if (forceState !== undefined) isVoiceActive = forceState;
  else isVoiceActive = !isVoiceActive;

  if (isVoiceActive) {
    try {
      recognition.start();
      statusVoice.textContent = 'ON';
      btnVoice.classList.add('active');
      auraStatusBar.classList.remove('hidden');
      auraStatusText.textContent = 'Voice Active...';
    } catch(e) { isVoiceActive = false; }
  } else {
    if (recognition) {
      try { recognition.stop(); } catch(e) {}
    }
    statusVoice.textContent = 'OFF';
    btnVoice.classList.remove('active');
    // Only hide bar if gesture is also off
    if (!gestureActive) auraStatusBar.classList.add('hidden');
  }
}

btnVoice.addEventListener('click', () => {
  if (!recognition) initVoiceControl();
  if (!recognition) return;
  toggleVoice();
});

document.getElementById('btn-stop-voice').addEventListener('click', () => {
  toggleVoice(false);
  toggleGesture(false);
});

// ── AuraSync: Image Enhancement Logic ───────────────────────
function updateFurnitureVisuals() {
  if (!furnitureEl) return;
  const b = parseFloat(brightnessSlider.value);
  const c = parseFloat(contrastSlider.value);
  const s = parseFloat(shadowSlider.value);
  
  const mesh = furnitureEl.getObject3D('mesh');
  if (mesh) {
    mesh.traverse(node => {
      if (node.material) {
        // We use color and emissive to simulate brightness and contrast
        const baseColor = new THREE.Color(1, 1, 1);
        node.material.color.setRGB(b * c, b * c, b * c);
        node.material.emissive.setRGB(b * (1 - c), b * (1 - c), b * (1 - c));
      }
    });
  }
  
  // Adjust light intensity based on shadow slider
  document.getElementById('main-light').setAttribute('light', 'intensity', s * 2);
  document.getElementById('ambient-light').setAttribute('light', 'intensity', (1 - s) * 0.8);
}

brightnessSlider.addEventListener('input', updateFurnitureVisuals);
contrastSlider.addEventListener('input', updateFurnitureVisuals);
shadowSlider.addEventListener('input', updateFurnitureVisuals);

// ── AuraSync: Room Zoom (FOV Control) ──────────────────────
const mainCam = document.getElementById('main-cam');
if (zoomSlider) {
  zoomSlider.addEventListener('input', () => {
    const fov = parseFloat(zoomSlider.value);
    mainCam.setAttribute('fov', fov);
  });
}

// ── AuraGesture: Webcam Motion Tracking ──────────────────────
let gestureActive = false;
let gestureStream = null;
let prevFrame = null;
let gestureCanvas = document.createElement('canvas');
let gestureCtx = gestureCanvas.getContext('2d', { willReadFrequently: true });
gestureCanvas.width = 48; // Low res for performance
gestureCanvas.height = 36;

async function toggleGesture(forceState) {
  if (forceState !== undefined) gestureActive = forceState;
  else gestureActive = !gestureActive;

  if (gestureActive) {
    try {
      gestureStream = await navigator.mediaDevices.getUserMedia({ video: { width: 320, height: 240 } });
      gestureVideo.srcObject = gestureStream;
      gestureMonitor.classList.remove('hidden');
      statusGesture.textContent = 'ON';
      btnGesture.classList.add('active');
      auraStatusBar.classList.remove('hidden');
      auraStatusText.textContent = 'Gesture Mode Active...';
      requestAnimationFrame(processMotion);
    } catch (e) {
      console.error(e);
      alert("Webcam needed for Gesture Mode.");
      gestureActive = false;
    }
  } else {
    if (gestureStream) gestureStream.getTracks().forEach(t => t.stop());
    gestureStream = null;
    gestureMonitor.classList.add('hidden');
    statusGesture.textContent = 'OFF';
    btnGesture.classList.remove('active');
    // Only hide status bar if voice is also off
    if (!isVoiceActive) auraStatusBar.classList.add('hidden');
  }
}

function processMotion() {
  if (!gestureActive) return;
  
  // Mirror the canvas drawing to match the mirrored UI monitor
  gestureCtx.save();
  gestureCtx.translate(gestureCanvas.width, 0);
  gestureCtx.scale(-1, 1);
  gestureCtx.drawImage(gestureVideo, 0, 0, gestureCanvas.width, gestureCanvas.height);
  gestureCtx.restore();
  
  const currentFrame = gestureCtx.getImageData(0, 0, gestureCanvas.width, gestureCanvas.height);
  
  if (prevFrame) {
    let moveLeft = 0, moveRight = 0, scaleUp = 0, scaleDown = 0;
    let totalMotion = 0;
    let totalBrightness = 0;
    
    const midX = gestureCanvas.width / 2;
    const midY = gestureCanvas.height / 2;
    
    for (let i = 0; i < currentFrame.data.length; i += 4) {
      const r = currentFrame.data[i];
      const g = currentFrame.data[i+1];
      const b = currentFrame.data[i+2];
      
      // 1. Calculate Brightness (Luminance)
      totalBrightness += (r + g + b) / 3;

      // 2. Calculate Motion (Temporal Difference)
      const diff = Math.abs(r - prevFrame.data[i]);
      if (diff > 45) {
        totalMotion += diff;
        const x = (i / 4) % gestureCanvas.width;
        const y = Math.floor((i / 4) / gestureCanvas.width);
        
        if (y < midY) {
          if (x < midX) moveLeft++; else moveRight++;
        } else {
          if (x < midX) scaleDown++; else scaleUp++;
        }
      }
    }
    
    // ── AuraReact: Live Lighting Matching ──
    const avgBrightness = totalBrightness / (gestureCanvas.width * gestureCanvas.height);
    const normalizedIntensity = (avgBrightness / 255) * 1.5 + 0.2; // Map to 0.2 - 1.7
    document.getElementById('ambient-light').setAttribute('light', 'intensity', normalizedIntensity * 0.6);
    document.getElementById('main-light').setAttribute('light', 'intensity', normalizedIntensity * 0.8);

    // ── AuraReact: Motion Spike Detection ──
    if (totalMotion > 80000 && !antigravityActive) {
      auraStatusText.textContent = "💥 Expression: SURPRISE! Triggering Antigravity";
      btnAntigravity.click(); 
    }

    // ── Quadrant Gestures ──
    const trigger = 30; 
    if (furnitureEl && furnitureEl.getAttribute('visible')) {
      const pos = furnitureEl.getAttribute('position');
      const scale = furnitureEl.object3D.scale.x;

      if (moveLeft > trigger && moveLeft > moveRight * 1.5) {
        pos.x -= 0.04;
        furnitureEl.setAttribute('position', pos);
        auraStatusText.textContent = "👈 Gesture: Moving Left";
      } else if (moveRight > trigger && moveRight > moveLeft * 1.5) {
        pos.x += 0.04;
        furnitureEl.setAttribute('position', pos);
        auraStatusText.textContent = "👉 Gesture: Moving Right";
      } else if (scaleUp > trigger && scaleUp > scaleDown * 1.5) {
        const s = Math.min(4, scale + 0.04);
        furnitureEl.object3D.scale.set(s, s, s);
        auraStatusText.textContent = "🔍 Gesture: Increasing Scale";
      } else if (scaleDown > trigger && scaleDown > scaleUp * 1.5) {
        const s = Math.max(0.3, scale - 0.04);
        furnitureEl.object3D.scale.set(s, s, s);
        auraStatusText.textContent = "🤏 Gesture: Decreasing Scale";
      }
    }
  }
  
  prevFrame = currentFrame;
  setTimeout(() => requestAnimationFrame(processMotion), 50);
}

btnGesture.addEventListener('click', toggleGesture);


