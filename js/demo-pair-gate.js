const button = document.getElementById('start-button');
const gateScript = document.querySelector('script[src$="/js/demo-pair-gate.js"], script[src$="../js/demo-pair-gate.js"], script[src$="js/demo-pair-gate.js"]');

const READY_TEXT = 'タップして、アクリルスタンドをスキャンしよう';
const CLOSED_TEXT = 'このARデモは現在利用できません';
const ERROR_TEXT = 'デモ設定を確認できません';

const setUnavailable = (message) => {
  button.disabled = true;
  button.textContent = message;
};

const parseBoundary = (value) => {
  if (value === null || value === undefined || value === '') return null;
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) throw new Error('Invalid demo access datetime');
  return ms;
};

const loadProductionConfig = async () => {
  const sourcePage = gateScript?.dataset?.source;
  if (!sourcePage) throw new Error('Demo source page is not configured');

  const sourceUrl = new URL(sourcePage, window.location.href);
  sourceUrl.searchParams.set('_', Date.now().toString());

  const response = await fetch(sourceUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Production page HTTP ${response.status}`);

  const html = await response.text();
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const configScript = Array.from(doc.scripts).find((script) =>
    script.textContent.includes('window.AR_CONFIG')
  );

  if (!configScript) throw new Error('AR_CONFIG not found in production page');

  const match = configScript.textContent.match(
    /window\.AR_CONFIG\s*=\s*(\{[\s\S]*?\})\s*;/
  );
  if (!match) throw new Error('AR_CONFIG could not be parsed');

  window.AR_CONFIG = Function(`"use strict"; return (${match[1]});`)();
};

try {
  setUnavailable('デモ利用可否を確認中…');

  const configUrl = new URL('../demo-access.json', window.location.href);
  configUrl.searchParams.set('_', Date.now().toString());

  const response = await fetch(configUrl, { cache: 'no-store' });
  if (!response.ok) throw new Error(`Demo config HTTP ${response.status}`);

  const access = await response.json();
  const startAt = parseBoundary(access.startAt);
  const endAt = parseBoundary(access.endAt);
  const now = Date.now();

  const isOpen =
    access.enabled === true &&
    (startAt === null || now >= startAt) &&
    (endAt === null || now < endAt);

  if (!isOpen) {
    setUnavailable(CLOSED_TEXT);
  } else {
    await loadProductionConfig();
    await import('./ar-pair-two-targets.js');
    button.textContent = READY_TEXT;
    button.disabled = false;
  }
} catch (err) {
  console.error('demo gate failed:', err);
  setUnavailable(ERROR_TEXT);
}
