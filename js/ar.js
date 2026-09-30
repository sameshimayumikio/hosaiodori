import * as THREE from 'three';
import { MindARThree } from 'mindar-image-three';

const config = {
  imageTargetSrc: '',
  videoSrc: '',
  planeAspect: 1.5,
  planeScale: 1,
  planeOffsetX: 0,
  planeOffsetY: 0,
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
loadingOverlay.textContent = '読み込み中…';
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
  lineHeight: '1',
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
    warmupTolerance: config.warmupTolerance,
    missTolerance: config.missTolerance,
    filterMinCF: config.filterMinCF,
    filterBeta: config.filterBeta,
  });

  const { renderer, scene, camera } = mindarThree;
  renderer.setClearAlpha(0);

  const anchor = mindarThree.addAnchor(0);
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
  plane.scale.set(config.planeScale, config.planeScale, 1);
  anchor.group.add(plane);

  const REQUIRED_BUFFER_SECONDS = 3;
  let targetVisible = false;
  let playbackReady = false;
  let videoLoadStarted = false;
  let previewPreparing = false;

  const showLoading = () => {
    if (targetVisible) loadingOverlay.style.display = 'block';
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
    if (!targetVisible || playbackReady || previewPreparing || !hasRequiredBuffer()) return;

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

    if (!targetVisible) return;

    playbackReady = true;
    hideLoading();
    tapArea.classList.add('active');
    playIcon.classList.add('visible');
  };

  const updatePlaybackReady = () => {
    if (!targetVisible || playbackReady) return;

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

  anchor.onTargetFound = () => {
    targetVisible = true;
    playbackReady = false;
    tapArea.classList.remove('active');
    playIcon.classList.remove('visible');

    showLoading();
    startVideoLoad();
    updatePlaybackReady();
  };

  anchor.onTargetLost = () => {
    targetVisible = false;
    playbackReady = false;
    video.pause();
    hideLoading();
    tapArea.classList.remove('active');
    playIcon.classList.remove('visible');
  };

  tapArea.addEventListener('click', () => {
    if (!targetVisible || !playbackReady) return;

    if (video.paused) {
      video.play().catch((err) => console.warn('video play failed:', err));
      playIcon.classList.remove('visible');
    }
  });

  video.addEventListener('ended', () => {
    video.currentTime = 0;
    video.pause();

    if (targetVisible) {
      playbackReady = true;
      tapArea.classList.add('active');
      playIcon.classList.add('visible');
    }
  });

  window.addEventListener('beforeunload', () => {
    window.clearInterval(bufferCheckTimer);
  });

  await mindarThree.start();

  renderer.setAnimationLoop(() => {
    renderer.render(scene, camera);
  });
}
