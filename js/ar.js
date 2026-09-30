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

  const video = document.createElement('video');
  video.preload = 'auto';
  video.src = config.videoSrc;
  video.playsInline = true;
  video.crossOrigin = 'anonymous';
  video.setAttribute('webkit-playsinline', '');
  video.load();

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

  anchor.onTargetFound = () => {
    video.currentTime = 0;
    video.play()
      .then(() => {
        video.pause();
      })
      .catch((err) => console.warn('preview frame failed:', err));

    tapArea.classList.add('active');
    playIcon.classList.add('visible');
  };

  anchor.onTargetLost = () => {
    video.pause();
    tapArea.classList.remove('active');
    playIcon.classList.remove('visible');
  };

  tapArea.addEventListener('click', () => {
    if (video.paused) {
      video.play().catch((err) => console.warn('video play failed:', err));
      playIcon.classList.remove('visible');
    }
  });

  video.addEventListener('ended', () => {
    video.currentTime = 0;
    video.pause();
    playIcon.classList.add('visible');
  });

  await mindarThree.start();

  renderer.setAnimationLoop(() => {
    renderer.render(scene, camera);
  });
}
