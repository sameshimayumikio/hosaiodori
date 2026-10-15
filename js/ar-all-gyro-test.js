import * as THREE from 'three';
import { MindARThree } from 'mindar-image-three';

// Prototype only: image tracking establishes the initial pose; device orientation
// keeps the composition in a fixed *direction*, without positional SLAM tracking.
// Existing production runtimes are intentionally untouched.
const config = {
  imageTargetSrc: '../assets/05/05_target_800.mind',
  videoSrc: '../assets/all/all_dance.mp4',
  personHeight: 2.0, // prototype AR units; calibrate on-screen
  fifthPersonFraction: 0.45, // estimated horizontal midpoint of dancer 5 within RGB half
  brightness: 1.2,
  settleMs: 1000,
  bufferSeconds: 4,
  ...(window.ALL_GYRO_TEST_CONFIG || {}),
};

const startOverlay = document.getElementById('start-overlay');
const startButton = document.getElementById('start-button');
const status = document.getElementById('test-status');
const playButton = document.getElementById('test-play');
const restartButton = document.getElementById('test-restart');
const calibrator = document.getElementById('test-calibration');
const sizeLabel = document.getElementById('test-size');
const shiftLabel = document.getElementById('test-shift');

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
let personHeight = config.personHeight;
let horizontalShift = 0;

function updateVideoLayout() {
  if (!videoPlane || !video.videoWidth || !video.videoHeight) return;
  // The RGB image occupies the LEFT HALF of our side-by-side RGB+Alpha MP4.
  const aspect = (video.videoWidth / 2) / video.videoHeight;
  const width = personHeight * aspect;
  videoPlane.scale.set(width, personHeight, 1);
  // Make dancer 5 (estimated 45% from left) line up with the image marker.
  videoPlane.position.set((0.5 - config.fifthPersonFraction) * width + horizontalShift, 0, 0.002);
  sizeLabel.textContent = '大きさ ' + (personHeight / config.personHeight).toFixed(2) + '×';
  shiftLabel.textContent = '横位置 ' + horizontalShift.toFixed(2);
}
document.getElementById('test-smaller').addEventListener('click', () => {
  personHeight = Math.max(0.4, personHeight * 0.9);
  updateVideoLayout();
});
document.getElementById('test-larger').addEventListener('click', () => {
  personHeight = Math.min(8, personHeight * 1.1);
  updateVideoLayout();
});
document.getElementById('test-left').addEventListener('click', () => {
  horizontalShift -= 0.15;
  updateVideoLayout();
});
document.getElementById('test-right').addEventListener('click', () => {
  horizontalShift += 0.15;
  updateVideoLayout();
});

function setStatus(message) {
  status.textContent = message;
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
  playButton.disabled = false;
  setStatus('5番の位置を確認して再生。再生後は左右にスマホを向けてください。');
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
  calibrator.hidden = false;
  if (sensorAvailable) {
    playButton.disabled = false;
    setStatus('準備完了。5番の位置を確認して「再生」を押してください。');
  } else {
    setStatus(sensorPermissionDenied
      ? '傾きセンサーの許可がありません。ブラウザの設定を確認して再読み込みしてください。'
      : '動画準備完了。傾きセンサーからの応答を待っています。');
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
    setStatus('5番を認識しました。ALL集合動画を読み込んでいます…');
    updateBuffer();
  };

  anchor.onTargetFound = () => {
    if (frozen) return;
    found = true;
    if (ready) {
      calibrator.hidden = false;
      setStatus(sensorAvailable
        ? '準備完了。「再生」を押すとマーカーから切り離します。'
        : '傾きセンサーの応答を待っています。');
      playButton.disabled = !sensorAvailable;
    } else if (!loadingStarted && settleTimer == null) {
      setStatus('5番を認識しました。位置を安定させています…');
      settleTimer = window.setTimeout(startLoad, config.settleMs);
    } else {
      setStatus('5番を認識しました。動画を読み込んでいます…');
    }
  };

  anchor.onTargetLost = () => {
    if (frozen) return;
    found = false;
    playButton.disabled = true;
    calibrator.hidden = true;
    if (settleTimer != null) {
      window.clearTimeout(settleTimer);
      settleTimer = null;
    }
    setStatus('5番のアクリルスタンドをもう一度映してください。');
  };

  video.addEventListener('loadedmetadata', updateVideoLayout);
  video.addEventListener('progress', updateBuffer);
  video.addEventListener('loadeddata', updateBuffer);
  video.addEventListener('canplay', updateBuffer);
  window.setInterval(updateBuffer, 250);

  playButton.addEventListener('click', () => {
    if (!ready || !found || !sensorAvailable || frozen) return;
    if (!freezeToInitialPose()) return;
    playButton.hidden = true;
    restartButton.hidden = false;
    setStatus('再生中：左右にスマホを向けてください。横移動は追跡しません。');
    video.muted = false;
    video.currentTime = 0;
    video.play().catch((error) => {
      console.error('Video play failed:', error);
      setStatus('動画を再生できませんでした。ページを再読み込みしてください。');
    });
  });

  video.addEventListener('ended', () => {
    if (!frozen) return;
    setStatus('35秒の再生が終了しました。「最初から試す」で再認識できます。');
  });

  restartButton.addEventListener('click', () => window.location.reload());

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

startButton.addEventListener('click', async () => {
  if (booted) return;
  booted = true;
  startButton.disabled = true;
  setStatus('端末のセンサーとカメラを準備しています…');

  // On iOS permission must be requested directly inside the user tap handler.
  try {
    if (typeof DeviceOrientationEvent !== 'undefined' &&
        typeof DeviceOrientationEvent.requestPermission === 'function') {
      const permission = await DeviceOrientationEvent.requestPermission();
      sensorPermissionDenied = permission !== 'granted';
    }
  } catch (error) {
    sensorPermissionDenied = true;
    console.warn('Device orientation permission:', error);
  }
  window.addEventListener('deviceorientation', onDeviceOrientation, true);

  try {
    await startAR();
    startOverlay.classList.add('hidden');
    setStatus(sensorPermissionDenied
      ? '傾きセンサーを使用できません。許可して再読み込みしてください。'
      : '5番のアクリルスタンドをカメラに映してください。');
  } catch (error) {
    console.error(error);
    booted = false;
    startButton.disabled = false;
    setStatus('起動に失敗しました：' + (error?.message || String(error)));
  }
});
