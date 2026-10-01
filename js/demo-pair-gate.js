const button = document.getElementById('start-button');

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
    await import('./ar-pair-two-targets.js');
    button.textContent = READY_TEXT;
    button.disabled = false;
  }
} catch (err) {
  console.error('demo gate failed:', err);
  setUnavailable(ERROR_TEXT);
}
