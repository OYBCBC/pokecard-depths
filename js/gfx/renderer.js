// WebGLRenderer + 画质档（《02》§1 三档：高/中/低）
export const TIERS = {
  high: { dpr: 2, shadow: 2048, postfx: 'full', label: '高' },
  med:  { dpr: 1.5, shadow: 1024, postfx: 'no-dof', label: '中' },
  low:  { dpr: 1, shadow: 0, postfx: 'none', label: '低' },
};

export function detectTier() {
  const q = new URLSearchParams(location.search).get('q');
  if (q === 'high' || q === 'med' || q === 'low') return q;
  // 用户在开始界面选过画质（M5）：优先于自动检测
  try {
    const saved = localStorage.getItem('depths-quality');
    if (saved === 'high' || saved === 'med' || saved === 'low') return saved;
  } catch (e) { /* ignore */ }
  return (navigator.hardwareConcurrency || 4) >= 8 ? 'high' : 'med';
}

export function createRenderer(THREE, canvas, tier) {
  const cap = TIERS[tier];
  const renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance' });
  renderer.outputColorSpace = THREE.SRGBColorSpace;
  // 色调映射统一由后处理链末端的 ToneMappingEffect(AgX) 处理；渲染器自身不再做
  renderer.toneMapping = THREE.NoToneMapping;
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, cap.dpr));
  renderer.shadowMap.enabled = cap.shadow > 0;
  renderer.shadowMap.type = THREE.PCFShadowMap;   // r187：PCFSoft 已弃用，PCF 即柔和过滤
  return renderer;
}

export function viewportSize() {
  // 个别 webview 偶发 innerWidth/innerHeight=0（NaN aspect → 全帧空白），做兜底
  const w = window.innerWidth || document.documentElement.clientWidth || 1280;
  const h = window.innerHeight || document.documentElement.clientHeight || 800;
  return [w, h];
}

export function resize(THREE, renderer, camera) {
  const [w, h] = viewportSize();
  renderer.setSize(w, h);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
}
