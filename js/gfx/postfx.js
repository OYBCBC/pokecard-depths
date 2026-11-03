// 后处理链（《02》§7.4）：低档不加载库；DoF 仅高档
//   RenderPass → [DoF] → Bloom(mipmapBlur) → ToneMapping(AgX) → Vignette → [Noise] → SMAA → Output
export async function createPostfx(THREE, renderer, scene, camera, tier) {
  if (tier === 'low') return null;
  const PP = await import('postprocessing');

  const composer = new PP.EffectComposer(renderer, { frameBufferType: THREE.HalfFloatType });
  composer.addPass(new PP.RenderPass(scene, camera));

  let dof = null;
  if (tier === 'high') {
    dof = new PP.DepthOfFieldEffect(camera, {
      focusDistance: 0.02,      // 由 target 接管，见下
      focalLength: 0.06,
      bokehScale: 2.2,
    });
    composer.addPass(dof);
  }

  const bloom = new PP.BloomEffect({
    mipmapBlur: true,
    luminanceThreshold: 0.85,
    luminanceSmoothing: 0.03,
    intensity: 0.85,
    radius: 0.85,
    levels: 8,
  });
  composer.addPass(bloom);

  composer.addPass(new PP.ToneMappingEffect({ mode: PP.ToneMappingMode.AGX }));

  composer.addPass(new PP.VignetteEffect({ darkness: 0.35, offset: 0.28 }));

  if (tier === 'high') {
    const noise = new PP.NoiseEffect({ premultiply: true });
    noise.blendMode.opacity.value = 0.035;
    composer.addPass(noise);
  }

  composer.addPass(new PP.SMAAEffect());

  if (PP.OutputEffect) composer.addPass(new PP.OutputEffect());

  return {
    composer,
    setFocusTarget(obj) { if (dof && dof.target !== undefined) dof.target = obj; },
    setSize(w, h) { composer.setSize(w, h); },
    active: true,
  };
}
