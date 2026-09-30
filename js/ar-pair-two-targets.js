import * as THREE from 'three';
import { MindARThree } from 'mindar-image-three';

const config = {
  imageTargetSrc: '',
  videoSrc: '',
  targetIndexA: 0,
  targetIndexB: 1,
  planeAspect: 1.5,
  planeScale: 1,
  planeOffsetX: 0,
  planeOffsetY: 0,
  attachToAnchorA: false,
  stabilizeTracking: false,
  trackingSmoothing: 0.22,
  maxPositionJump: 0.18,
  maxScaleJumpRatio: 0.12,
  maxRotationJumpDeg: 15,
  outlierResetFrames: 3,
  brightness: 1,
  alphaThreshold: 0.5,
  warmupTolerance: 0,
  missTolerance: 30,
  filterMinCF: 0.00001,
  filterBeta: 0.001,
  ...(window.AR_CONFIG || {}),
};

if (!config.imageTargetSrc || !config.videoSrc) {
  throw new Error('AR_CONFIG に imageTargetSrc と videoSrc を指定してください。');
}

const video = document.createElement('video');
video.preload = 'auto';
video.playsInline = true;
video.crossOrigin = 'anonymous';
video.setAttribute('webkit-playsinline', '');

const loadingOverlay = document.createElement('div');
loadingOverlay.innerHTML = '認識成功！<br>ちょっと待ってね';
Object.assign(loadingOverlay.style, {
  position: 'fixed',
  left: '50%',
  top: '50%',
  transform: 'translate(-50%, -50%)',
  zIndex: '6',
  display: 'none',
  padding: '12px 18px',
  borderRadius: '999px',
  background: 'rgba(0, 0, 0, 0.72)',
  color: '#fff',
  fontSize: '16px',
  lineHeight: '1.35',
  textAlign: 'center',
  pointerEvents: 'none'
});
document.body.appendChild(loadingOverlay);

const startOverlay = document.getElementById('start-overlay');
const startButton = document.getElementById('start-button');

startButton.addEventListener('click', async () => {
  try {
    startOverlay.classList.add('hidden');
    await startAR();
  } catch (err) {
    console.error(err);
    alert('起動に失敗しました: ' + err.message);
  }
});

async function startAR() {
  const mindarThree = new MindARThree({
    container: document.querySelector('#ar-container'),
    imageTargetSrc: config.imageTargetSrc,
    maxTrack: 2,
    warmupTolerance: config.warmupTolerance,
    missTolerance: config.missTolerance,
    filterMinCF: config.filterMinCF,
    filterBeta: config.filterBeta,
  });

  const { renderer, scene, camera } = mindarThree;
  renderer.setClearAlpha(0);

  const anchorA = mindarThree.addAnchor(config.targetIndexA);
  const anchorB = mindarThree.addAnchor(config.targetIndexB);

  const tapArea = document.getElementById('video-tap-area');
  const playIcon = document.getElementById('play-icon');

  const videoTexture = new THREE.VideoTexture(video);
  videoTexture.colorSpace = THREE.SRGBColorSpace;
  videoTexture.minFilter = THREE.LinearFilter;
  videoTexture.magFilter = THREE.LinearFilter;

  const material = new THREE.ShaderMaterial({
    uniforms: {
      map: { value: videoTexture },
      alphaThreshold: { value: config.alphaThreshold },
      brightness: { value: config.brightness },
    },
    vertexShader: `
      varying vec2 vUv;
      void main() {
        vUv = uv;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      uniform sampler2D map;
      uniform float alphaThreshold;
      uniform float brightness;
      varying vec2 vUv;

      void main() {
        vec2 colorUv = vec2(vUv.x * 0.5, vUv.y);
        vec2 alphaUv = vec2(vUv.x * 0.5 + 0.5, vUv.y);

        vec3 color = texture2D(map, colorUv).rgb;
        color *= brightness;

        float alpha = texture2D(map, alphaUv).r;
        if (alpha < alphaThreshold) discard;

        gl_FragColor = vec4(color, 1.0);
      }
    `,
    transparent: true,
  });

  const geometry = new THREE.PlaneGeometry(1, config.planeAspect);
  const plane = new THREE.Mesh(geometry, material);
  plane.position.set(config.planeOffsetX, config.planeOffsetY, 0);

  const pairRoot = new THREE.Group();
  pairRoot.visible = false;
  pairRoot.add(plane);

  if (config.attachToAnchorA || config.stabilizeTracking) {
    plane.scale.set(config.planeScale, config.planeScale, 1);
  }

  if (config.attachToAnchorA) {
    anchorA.group.add(pairRoot);
  } else {
    scene.add(pairRoot);
  }

  const REQUIRED_BUFFER_SECONDS = 4;
  let foundA = false;
  let foundB = false;
  let pairActive = false;
  let playbackReady = false;
  let videoLoadStarted = false;
  let previewPreparing = false;

  const showLoading = () => {
    if (pairActive) loadingOverlay.style.display = 'block';
  };

  const hideLoading = () => {
    loadingOverlay.style.display = 'none';
  };

  const startVideoLoad = () => {
    if (videoLoadStarted) return;
    videoLoadStarted = true;
    video.src = config.videoSrc;
    video.load();
  };

  const hasRequiredBuffer = () => {
    if (!video.buffered.length) return false;

    const requiredEnd = Number.isFinite(video.duration)
      ? Math.min(REQUIRED_BUFFER_SECONDS, video.duration)
      : REQUIRED_BUFFER_SECONDS;

    for (let i = 0; i < video.buffered.length; i += 1) {
      if (video.buffered.start(i) <= 0.05 && video.buffered.end(i) >= requiredEnd) {
        return true;
      }
    }
    return false;
  };

  const preparePreview = async () => {
    if (!pairActive || playbackReady || previewPreparing || !hasRequiredBuffer()) return;

    previewPreparing = true;
    video.currentTime = 0;

    const previousMuted = video.muted;
    video.muted = true;

    try {
      await video.play();
      video.pause();
    } catch (err) {
      console.warn('preview frame failed:', err);
    } finally {
      video.muted = previousMuted;
      previewPreparing = false;
    }

    if (!pairActive) return;

    playbackReady = true;
    hideLoading();
    pairRoot.visible = true;
    tapArea.classList.add('active');
    playIcon.classList.add('visible');
  };

  const updatePlaybackReady = () => {
    if (!pairActive || playbackReady) return;

    if (hasRequiredBuffer()) {
      preparePreview();
    } else {
      showLoading();
    }
  };

  video.addEventListener('progress', updatePlaybackReady);
  video.addEventListener('loadeddata', updatePlaybackReady);
  video.addEventListener('canplaythrough', updatePlaybackReady);

  const bufferCheckTimer = window.setInterval(updatePlaybackReady, 250);

  const activatePair = () => {
    if (pairActive || !foundA || !foundB) return;

    pairActive = true;
    playbackReady = false;
    pairRoot.visible = false;
    tapArea.classList.remove('active');
    playIcon.classList.remove('visible');

    showLoading();
    startVideoLoad();
    updatePlaybackReady();
  };

  const deactivatePair = () => {
    if (!pairActive) return;

    pairActive = false;
    playbackReady = false;
    trackingInitialized = false;
    consecutiveOutliers = 0;
    video.pause();
    hideLoading();
    pairRoot.visible = false;
    tapArea.classList.remove('active');
    playIcon.classList.remove('visible');
  };

  const updatePairState = () => {
    if (foundA && foundB) activatePair();
    else deactivatePair();
  };

  anchorA.onTargetFound = () => {
    foundA = true;
    updatePairState();
  };

  anchorA.onTargetLost = () => {
    foundA = false;
    updatePairState();
  };

  anchorB.onTargetFound = () => {
    foundB = true;
    updatePairState();
  };

  anchorB.onTargetLost = () => {
    foundB = false;
    updatePairState();
  };

  tapArea.addEventListener('click', () => {
    if (!pairActive || !playbackReady) return;

    if (video.paused) {
      video.play().catch((err) => console.warn('video play failed:', err));
      playIcon.classList.remove('visible');
    }
  });

  video.addEventListener('ended', () => {
    video.currentTime = 0;
    video.pause();

    if (pairActive) {
      playbackReady = true;
      pairRoot.visible = true;
      tapArea.classList.add('active');
      playIcon.classList.add('visible');
    }
  });

  window.addEventListener('beforeunload', () => {
    window.clearInterval(bufferCheckTimer);
  });

  // Both targets are required to activate the pair AR,
  // but target A alone is the spatial reference for position/orientation/scale.
  const posA = new THREE.Vector3();
  const scaleA = new THREE.Vector3();
  const quatA = new THREE.Quaternion();

  const filteredPos = new THREE.Vector3();
  const filteredQuat = new THREE.Quaternion();
  let filteredScale = 1;
  let trackingInitialized = false;
  let consecutiveOutliers = 0;

  const updateStabilizedTransform = () => {
    scene.updateMatrixWorld(true);

    anchorA.group.getWorldPosition(posA);
    anchorA.group.getWorldScale(scaleA);
    anchorA.group.getWorldQuaternion(quatA);

    const rawScale = scaleA.x;

    if (!trackingInitialized) {
      filteredPos.copy(posA);
      filteredQuat.copy(quatA);
      filteredScale = rawScale;
      trackingInitialized = true;
      consecutiveOutliers = 0;
    } else {
      const scaleBase = Math.max(Math.abs(filteredScale), 0.0001);
      const positionJump = posA.distanceTo(filteredPos) / scaleBase;
      const scaleJumpRatio = Math.abs(rawScale - filteredScale) / scaleBase;
      const rotationJumpDeg = THREE.MathUtils.radToDeg(filteredQuat.angleTo(quatA));

      const isOutlier =
        positionJump > config.maxPositionJump ||
        scaleJumpRatio > config.maxScaleJumpRatio ||
        rotationJumpDeg > config.maxRotationJumpDeg;

      if (isOutlier) {
        consecutiveOutliers += 1;

        // A one- or two-frame spike is ignored. If the change persists,
        // treat it as real camera/marker movement and re-lock to the new pose.
        if (consecutiveOutliers >= config.outlierResetFrames) {
          filteredPos.copy(posA);
          filteredQuat.copy(quatA);
          filteredScale = rawScale;
          consecutiveOutliers = 0;
        }
      } else {
        consecutiveOutliers = 0;
        filteredPos.lerp(posA, config.trackingSmoothing);
        filteredQuat.slerp(quatA, config.trackingSmoothing);
        filteredScale = THREE.MathUtils.lerp(filteredScale, rawScale, config.trackingSmoothing);
      }
    }

    pairRoot.position.copy(filteredPos);
    pairRoot.quaternion.copy(filteredQuat);
    pairRoot.scale.set(filteredScale, filteredScale, filteredScale);
  };

  await mindarThree.start();

  renderer.setAnimationLoop(() => {
    if (pairActive && config.stabilizeTracking) {
      updateStabilizedTransform();
    } else if (pairActive && !config.attachToAnchorA) {
      scene.updateMatrixWorld(true);

      anchorA.group.getWorldPosition(posA);
      anchorA.group.getWorldScale(scaleA);
      anchorA.group.getWorldQuaternion(quatA);

      pairRoot.position.copy(posA);
      pairRoot.quaternion.copy(quatA);

      const baseScale = scaleA.x * config.planeScale;
      pairRoot.scale.set(baseScale, baseScale, baseScale);
    }

    renderer.render(scene, camera);
  });
}
