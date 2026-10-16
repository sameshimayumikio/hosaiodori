import * as THREE from 'three';
import { MindARThree } from 'mindar-image-three';

// Prototype only: image tracking establishes the initial pose; device orientation
// keeps the composition in a fixed *direction*, without positional SLAM tracking.
// Existing production runtimes are intentionally untouched.
const config = {
  imageTargetSrc: '../assets/05/05_target_800.mind',
  videoSrc: '../assets/all/all_dance.mp4',
  planeScale: 2.0, // displayed video height, in AR marker units
  planeOffsetX: 0, // horizontal shift relative to dancer 5 alignment
  planeOffsetY: 0, // vertical shift relative to the marker
  fifthPersonFraction: 0.45, // estimated horizontal position of dancer 5 within RGB half
  curveAngleDeg: 50, // total inward-facing arc from dancer 1 to dancer 10
  curveSegments: 96, // smooth surface, all 10 dancers remain on ONE video texture
  brightness: 1.2,
  settleMs: 1000,
  bufferSeconds: 4,
  ...(window.ALL_ARC_TEST_CONFIG || {}),
};

const startOverlay = document.getElementById('start-overlay');
const startButton = document.getElementById('start-button');
const status = document.getElementById('test-status');
const tapArea = document.getElementById('video-tap-area');
const playIcon = document.getElementById('play-icon');
const zoomHint = document.getElementById('zoom-hint');
const lookHint = document.getElementById('look-hint');

const video = document.createElement('video');
video.crossOrigin = 'anonymous';
video.preload = 'auto';
video.playsInline = true;
video.setAttribute('playsinline', '');
video.setAttribute('webkit-playsinline', '');
video.loop = false;

const zAxis = new THREE.Vector3(0, 0, 1);
const screenQuat = new THREE.Quaternion();
const adjustToCamera = new THREE.Quaternion(-Math.sqrt(0.5), 0, 0, Math.sqrt(0.5));
const deviceEuler = new THREE.Euler();
const currentOrientation = new THREE.Quaternion();
const startOrientation = new THREE.Quaternion();
const deltaOrientation = new THREE.Quaternion();
const startPosition = new THREE.Vector3();
const startRotation = new THREE.Quaternion();
let sensorAvailable = false;
let sensorPermissionDenied = false;
let booted = false;
let found = false;
let frozen = false;
let loadingStarted = false;
let preparing = false;
let ready = false;
let settleTimer = null;
let layout = null;
let mindarThree = null;
let videoPlane = null;

// Uniformly scale the entire curved surface around the existing fifth-dancer
// anchor. The camera feed and gyro orientation are not changed.
let zoomFactor = 1;
let pinchGesture = false;
let pinchStartDistance = 0;
let pinchStartZoom = 1;
let singleTouchMoved = false;
let singleTouchStart = null;
let lastTap = null;
let suppressPlayClickUntil = 0;
let zoomHintShown = false;
let zoomHintTimeout = null;
let lookHintTimeout = null;

function hideLookHint() {
  lookHint.hidden = true;
  if (lookHintTimeout !== null) {
    window.clearTimeout(lookHintTimeout);
    lookHintTimeout = null;
  }
}

function showLookHint() {
  hideLookHint();
  lookHint.hidden = false;
  // Short instruction on each playback; hide it to give the dancers room.
  lookHintTimeout = window.setTimeout(() => {
    lookHint.hidden = true;
    lookHintTimeout = null;
  }, 8000);
}

function showZoomHintOnce() {
  if (zoomHintShown) return;
  zoomHintShown = true;
  zoomHint.hidden = false;
  // Visible on first recognition, then gets out of the way even if unused.
  zoomHintTimeout = window.setTimeout(() => {
    zoomHint.hidden = true;
    zoomHintTimeout = null;
  }, 12000);
}

function dismissZoomHint() {
  zoomHintShown = true;
  zoomHint.hidden = true;
  if (zoomHintTimeout !== null) {
    window.clearTimeout(zoomHintTimeout);
    zoomHintTimeout = null;
  }
}

function setZoom(nextZoom) {
  const minZoom = Math.max(0.01, Number(config.zoomMin) || 0.12);
  const maxZoom = Math.max(minZoom, Number(config.zoomMax) || 3.0);
  zoomFactor = Math.min(maxZoom, Math.max(minZoom, nextZoom));
  if (videoPlane) videoPlane.scale.setScalar(zoomFactor);
}

function touchDistance(touches) {
  return Math.hypot(
    touches[0].clientX - touches[1].clientX,
    touches[0].clientY - touches[1].clientY
  );
}

function canZoom() {
  return ready && (found || frozen) && !!videoPlane;
}

// Touch gestures run on the document so the same pinch works whether the
// red playback overlay is visible or not. No one-finger pan is introduced.
document.addEventListener('touchstart', (event) => {
  if (!canZoom()) return;
  if (event.touches.length === 2) {
    pinchGesture = true;
    dismissZoomHint();
    hideLookHint();
    pinchStartDistance = touchDistance(event.touches);
    pinchStartZoom = zoomFactor;
    lastTap = null;
    singleTouchStart = null;
    event.preventDefault();
  } else if (event.touches.length === 1 && !pinchGesture) {
    const t = event.touches[0];
    singleTouchStart = { x: t.clientX, y: t.clientY };
    singleTouchMoved = false;
  }
}, { passive: false });

document.addEventListener('touchmove', (event) => {
  if (!canZoom()) return;
  if (pinchGesture) {
    if (event.touches.length === 2 && pinchStartDistance > 0) {
      setZoom(pinchStartZoom * touchDistance(event.touches) / pinchStartDistance);
    }
    event.preventDefault();
  } else if (singleTouchStart && event.touches.length === 1) {
    const t = event.touches[0];
    if (Math.hypot(t.clientX - singleTouchStart.x, t.clientY - singleTouchStart.y) > 24) {
      singleTouchMoved = true;
    }
  }
}, { passive: false });

document.addEventListener('touchend', (event) => {
  if (pinchGesture) {
    event.preventDefault();
    if (event.touches.length === 0) {
      pinchGesture = false;
      pinchStartDistance = 0;
      suppressPlayClickUntil = Date.now() + 450;
    }
    return;
  }

  if (!canZoom() || event.touches.length !== 0 ||
      event.changedTouches.length !== 1 || singleTouchMoved) {
    singleTouchStart = null;
    return;
  }

  const t = event.changedTouches[0];
  const now = Date.now();
  if (lastTap && now - lastTap.time < 320 &&
      Math.hypot(t.clientX - lastTap.x, t.clientY - lastTap.y) < 48) {
    // Prevent the second tap from triggering playback through the overlay.
    event.preventDefault();
    suppressPlayClickUntil = now + 450;
    setZoom(1);
    dismissZoomHint();
    hideLookHint();
    if (lastTap.wasPaused && !video.paused) {
      // A first tap on a visible play overlay may already have restarted
      // playback. Return to the previous ready/paused state on double-tap.
      video.pause();
      video.currentTime = 0;
      setStatus('');
      showPlayButton();
    }
    lastTap = null;
  } else {
    lastTap = {
      time: now, x: t.clientX, y: t.clientY,
      wasPaused: video.paused
    };
  }
  singleTouchStart = null;
}, { passive: false });

document.addEventListener('touchcancel', () => {
  pinchGesture = false;
  singleTouchStart = null;
  lastTap = null;
  suppressPlayClickUntil = Date.now() + 450;
});

document.addEventListener('dblclick', (event) => {
  if (!canZoom()) return;
  event.preventDefault();
  setZoom(1);
  dismissZoomHint();
  hideLookHint();
}, { passive: false });

function updateVideoLayout() {
  if (!videoPlane || !video.videoWidth || !video.videoHeight) return;

  // The source MP4 is side-by-side RGB | ALPHA. The visible aspect ratio
  // is RGB's HALF of the full source width divided by the source height.
  const aspect = (video.videoWidth / 2) / video.videoHeight;
  const height = config.planeScale;
  const arcLength = height * aspect;
  const segments = Math.max(8, Math.min(256, Math.round(config.curveSegments)));
  const sweep = THREE.MathUtils.degToRad(
    THREE.MathUtils.clamp(config.curveAngleDeg, 0, 85)
  );

  // Geometry UVs continue to run from u=0 (dancer 1) to u=1 (dancer 10).
  // u=fifthPersonFraction is the exact anchor for dancer 5:
  // x=0, z=0, with the surrounding characters on an inward-curving arc.
  const geometry = new THREE.PlaneGeometry(arcLength, height, segments, 1);
  const positions = geometry.attributes.position;
  const uv = geometry.attributes.uv;
  for (let i = 0; i < positions.count; i += 1) {
    const u = uv.getX(i);
    const angle = (u - config.fifthPersonFraction) * sweep;
    let x, z;
    if (sweep < 0.0001) {
      // A zero-degree curve reproduces the original flat geometry.
      x = (u - config.fifthPersonFraction) * arcLength;
      z = 0;
    } else {
      const radius = arcLength / sweep;
      x = radius * Math.sin(angle);
      // Positive Z points toward the viewer: the two ends turn inward.
      z = radius * (1 - Math.cos(angle));
    }
    positions.setXYZ(i, x, positions.getY(i), z);
  }
  positions.needsUpdate = true;
  geometry.computeVertexNormals();
  geometry.computeBoundingSphere();

  const previousGeometry = videoPlane.geometry;
  videoPlane.geometry = geometry;
  previousGeometry.dispose();
  videoPlane.scale.setScalar(zoomFactor);
  videoPlane.position.set(config.planeOffsetX, config.planeOffsetY, 0.002);
}

function setStatus(message) {
  status.textContent = message;
  status.hidden = !message;
}

function showPlayButton() {
  tapArea.classList.add('active');
  playIcon.classList.add('visible');
}

function hidePlayButton() {
  tapArea.classList.remove('active');
  playIcon.classList.remove('visible');
}

function onDeviceOrientation(event) {
  if (event.alpha == null || event.beta == null || event.gamma == null) return;
  const radians = THREE.MathUtils.DEG2RAD;
  const screenAngle = window.screen?.orientation?.angle ??
    (typeof window.orientation === 'number' ? window.orientation : 0);

  // Equivalent to the quaternion conversion in Three.js DeviceOrientationControls:
  // alpha/beta/gamma -> camera-to-world orientation, corrected for screen rotation.
  deviceEuler.set(event.beta * radians, event.alpha * radians, -event.gamma * radians, 'YXZ');
  currentOrientation.setFromEuler(deviceEuler);
  currentOrientation.multiply(adjustToCamera);
  screenQuat.setFromAxisAngle(zAxis, -screenAngle * radians);
  currentOrientation.multiply(screenQuat);
  currentOrientation.normalize();

  sensorAvailable = true;
  if (frozen || !found || !ready) return;
  showPlayButton();
  showZoomHintOnce();
  setStatus('');
}

function makeVideoPlane() {
  const texture = new THREE.VideoTexture(video);
  texture.colorSpace = THREE.SRGBColorSpace;
  texture.minFilter = THREE.LinearFilter;
  texture.magFilter = THREE.LinearFilter;
  const material = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: texture },
      alphaThreshold: { value: 0.5 },
      brightness: { value: config.brightness },
    },
    vertexShader: [
      'varying vec2 vUv;',
      'void main() {',
      '  vUv = uv;',
      '  gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);',
      '}',
    ].join('\n'),
    fragmentShader: [
      'uniform sampler2D map;',
      'uniform float alphaThreshold;',
      'uniform float brightness;',
      'varying vec2 vUv;',
      'void main() {',
      '  vec2 colorUv = vec2(vUv.x * 0.5, vUv.y);',
      '  vec2 alphaUv = vec2(vUv.x * 0.5 + 0.5, vUv.y);',
      '  vec3 color = texture2D(map, colorUv).rgb * brightness;',
      '  float alpha = texture2D(map, alphaUv).r;',
      '  if (alpha < alphaThreshold) discard;',
      '  gl_FragColor = vec4(color, 1.0);',
      '}',
    ].join('\n'),
    transparent: true,
    side: THREE.DoubleSide,
  });
  const plane = new THREE.Mesh(new THREE.PlaneGeometry(1, 1), material);
  videoPlane = plane;
  updateVideoLayout();
  return plane;
}

function hasBuffer() {
  if (!video.buffered.length) return false;
  const required = Number.isFinite(video.duration)
    ? Math.min(config.bufferSeconds, video.duration)
    : config.bufferSeconds;
  for (let i = 0; i < video.buffered.length; i++) {
    if (video.buffered.start(i) <= 0.05 && video.buffered.end(i) >= required) return true;
  }
  return false;
}

async function preparePreview() {
  if (!found || frozen || ready || preparing || !video.videoWidth || !hasBuffer()) return;
  preparing = true;
  const wasMuted = video.muted;
  video.muted = true;
  try {
    video.currentTime = 0;
    await video.play();
    video.pause();
    video.currentTime = 0;
  } catch (error) {
    console.warn('Muted video preview unavailable:', error);
  } finally {
    video.muted = wasMuted;
    preparing = false;
  }

  if (!found || frozen) return;
  ready = true;
  if (sensorAvailable) {
    showPlayButton();
    showZoomHintOnce();
    setStatus('');
  } else {
    setStatus(sensorPermissionDenied
      ? '傾きセンサーの許可がありません。ブラウザの設定を確認して再読み込みしてください。'
      : '傾きセンサーからの応答を待っています。');
  }
}

function updateBuffer() {
  if (found && !frozen && !ready && hasBuffer()) void preparePreview();
}

function freezeToInitialPose() {
  if (!layout || !found || !sensorAvailable || frozen) return false;

  // MindAR anchor is in camera coordinates. scene.attach preserves that pose,
  // even when MindAR subsequently hides its original anchor.
  layout.updateWorldMatrix(true, false);
  mindarThree.scene.attach(layout);
  startPosition.copy(layout.position);
  startRotation.copy(layout.quaternion);
  startOrientation.copy(currentOrientation);
  frozen = true;
  return true;
}

async function startAR() {
  mindarThree = new MindARThree({
    container: document.getElementById('ar-container'),
    imageTargetSrc: config.imageTargetSrc,
    uiScanning: 'yes',
    warmupTolerance: 5,
    missTolerance: 30,
    filterMinCF: 0.00001,
    filterBeta: 0.001,
  });

  const { renderer, scene, camera } = mindarThree;
  renderer.setClearAlpha(0);
  const anchor = mindarThree.addAnchor(0);

  layout = new THREE.Group();
  anchor.group.add(layout);
  layout.add(makeVideoPlane());

  const startLoad = () => {
    settleTimer = null;
    if (!found || loadingStarted || frozen) return;
    loadingStarted = true;
    video.src = config.videoSrc;
    video.load();
    setStatus('認識成功！ちょっと待ってね');
    updateBuffer();
  };

  anchor.onTargetFound = () => {
    if (frozen) return;
    found = true;
    if (ready) {
      setStatus(sensorAvailable ? '' : '傾きセンサーの応答を待っています。');
      if (sensorAvailable) {
        showPlayButton();
        showZoomHintOnce();
      }
    } else if (!loadingStarted && settleTimer == null) {
      setStatus('認識成功！ちょっと待ってね');
      settleTimer = window.setTimeout(startLoad, config.settleMs);
    } else {
      setStatus('認識成功！ちょっと待ってね');
    }
  };

  anchor.onTargetLost = () => {
    if (frozen) return;
    found = false;
    hidePlayButton();
    if (settleTimer != null) {
      window.clearTimeout(settleTimer);
      settleTimer = null;
    }
    setStatus('5番 子抱嫁のアクリルスタンドをもう一度映してください。');
  };

  video.addEventListener('loadedmetadata', updateVideoLayout);
  video.addEventListener('progress', updateBuffer);
  video.addEventListener('loadeddata', updateBuffer);
  video.addEventListener('canplay', updateBuffer);
  window.setInterval(updateBuffer, 250);

  tapArea.addEventListener('click', () => {
    if (Date.now() < suppressPlayClickUntil) return;
    if (!ready || !sensorAvailable || !video.paused) return;

    if (!frozen) {
      if (!found || !freezeToInitialPose()) return;
      // Keep the scan overlay hidden after detaching the anchored video.
      const scanningOverlay = mindarThree.ui?.scanningMask ||
        document.querySelector('.mindar-ui-scanning');
      if (scanningOverlay) {
        scanningOverlay.style.setProperty('display', 'none', 'important');
      }
    }

    hidePlayButton();
    setStatus('');
    showLookHint();
    video.muted = false;
    video.currentTime = 0;
    video.play().catch((error) => {
      console.error('Video play failed:', error);
      hideLookHint();
      setStatus('動画を再生できませんでした。もう一度タップしてください。');
      showPlayButton();
    });
  });

  video.addEventListener('ended', () => {
    if (!frozen) return;
    video.pause();
    video.currentTime = 0;
    hideLookHint();
    setStatus('');
    showPlayButton();
  });

  await mindarThree.start();
  renderer.setAnimationLoop(() => {
    if (frozen && sensorAvailable) {
      // Rotational-only camera model: M_new = Q_now^-1 * Q_start * M_at_capture.
      // There is no translation estimate; this is intentionally NOT SLAM.
      deltaOrientation.copy(currentOrientation).invert().multiply(startOrientation);
      layout.position.copy(startPosition).applyQuaternion(deltaOrientation);
      layout.quaternion.copy(deltaOrientation).multiply(startRotation);
    }
    renderer.render(scene, camera);
  });
}

window.ALL_ARC_TEST_READY = true;
startButton.disabled = false;
startButton.textContent = 'タップして、アクリルスタンドをスキャンしよう';

// Called by a plain (non-module) page click listener. This lets the click respond
// even if a CDN import takes too long or fails before this module can execute.
async function startTest() {
  if (booted) return;
  booted = true;
  startOverlay.classList.add('hidden');
  setStatus('カメラを起動しています。カメラの許可が表示されたら「許可」を選んでください。');

  // DeviceOrientation permission is requested synchronously by the page's
  // direct click handler. Do NOT re-request here after asynchronous imports.
  const permissionPromise = window.ALL_ARC_MOTION_PERMISSION;
  if (permissionPromise) {
    Promise.resolve(permissionPromise)
      .then((permission) => {
        sensorPermissionDenied = permission !== 'granted';
        if (sensorPermissionDenied) {
          setStatus('カメラは起動できますが、傾きセンサーの許可がありません。');
        }
      })
      .catch((error) => {
        sensorPermissionDenied = true;
        console.warn('Device orientation permission:', error);
        setStatus('傾きセンサーの許可を取得できませんでした。');
      });
  }
  window.addEventListener('deviceorientation', onDeviceOrientation, true);

  let cameraReady = false;
  const slowStartup = window.setTimeout(() => {
    if (!cameraReady) {
      setStatus('カメラ起動待ちです。ブラウザのカメラ許可と通信状況を確認してください。');
    }
  }, 12000);

  try {
    await startAR();
    cameraReady = true;
    setStatus(sensorPermissionDenied
      ? 'カメラ起動済み。傾きセンサーへの許可も必要です。'
      : '5番 子抱嫁のアクリルスタンドを映してください。');
  } catch (error) {
    console.error('ALL arc camera startup failure:', error);
    setStatus('カメラ起動エラー：' + (error?.message || String(error)));
    booted = false;
  } finally {
    window.clearTimeout(slowStartup);
  }
}

window.ALL_ARC_START = startTest;
window.ALL_ARC_TEST_READY = true;
window.dispatchEvent(new Event('ALL_ARC_READY'));
