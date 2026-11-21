// 学习表校验（ADR-19「加宝可梦三件套」）：node --test tools/test-learn.mjs
// 规则：
//   ① TM 的 effect.tm 引用招式必须存在且可发射（kind=projectile/beam）
//   ② TM 的 learn 数组非空，且引用的物种 id 必须存在于 species 表
//   ③ 每只可操作搭档（非进化）可学 TM ≥2（防 0 可学死角）
//   ④ 开局三选一（species.startTMs）：恰好 3 件、全部存在且该物种可学
//   ⑤ 弹道原语覆盖：spread / pierce / homing / boomerang 各至少 1 件 TM 载体
//   ⑥ TM 图标 PNG 存在
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, existsSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const read = (f) => JSON.parse(readFileSync(join(ROOT, 'js/data', f), 'utf8'));
const items = read('items.json').items;
const species = read('species.json').species;
const moves = read('moves.json').moves;

const TMS = Object.entries(items).filter(([, it]) => it.effect && it.effect.tm);
const learners = Object.keys(species).filter((id) => !species[id].evolved);

test('TM 引用招式存在且可发射（kind=projectile/beam）', () => {
  for (const [id, it] of TMS) {
    const mv = moves[it.effect.tm];
    assert.ok(mv, `${id} → 招式 ${it.effect.tm} 不存在`);
    assert.ok(['projectile', 'beam'].includes(mv.kind), `${id} 招式 ${it.effect.tm} kind=${mv.kind} 不可作为 B 槽弹`);
    assert.ok(mv.power > 0, `${id} 招式 ${it.effect.tm} 威力为 0（敌版招式不能上 TM）`);
  }
});

test('TM learn 表非空且引用物种存在', () => {
  for (const [id, it] of TMS) {
    assert.ok(Array.isArray(it.learn) && it.learn.length >= 1, `${id} learn 表为空`);
    for (const sp of it.learn) {
      assert.ok(species[sp], `${id} learn 引用未知物种 ${sp}`);
    }
  }
});

test('每只可操作搭档可学 TM ≥2（防 0 可学死角）', () => {
  for (const sp of learners) {
    const learnable = TMS.filter(([id, it]) => it.learn.includes(sp));
    assert.ok(learnable.length >= 2, `${sp} 只能学 ${learnable.length} 件 TM（${learnable.map(([id]) => id).join(',')}）`);
  }
});

test('开局三选一（startTMs）：恰好 3 件、全部存在且可学', () => {
  for (const [sp, spec] of Object.entries(species)) {
    if (spec.evolved) continue;
    assert.ok(Array.isArray(spec.startTMs) && spec.startTMs.length === 3, `${sp} startTMs 不是 3 件`);
    for (const id of spec.startTMs) {
      const it = items[id];
      assert.ok(it && it.effect && it.effect.tm, `${sp} 开局件 ${id} 不是 TM`);
      assert.ok(it.learn.includes(sp), `${sp} 开局件 ${id} 不可学（learn 表缺）`);
    }
  }
});

test('弹道原语覆盖：spread/pierce/homing/boomerang 各至少 1 件 TM 载体', () => {
  for (const flag of ['spread', 'pierce', 'homing', 'boomerang']) {
    const carriers = TMS.filter(([id, it]) => moves[it.effect.tm][flag]);
    assert.ok(carriers.length >= 1, `弹道原语 ${flag} 没有 TM 载体`);
  }
});

test('TM 图标 PNG 存在', () => {
  for (const [id, it] of TMS) {
    assert.ok(existsSync(join(ROOT, 'assets/items', it.icon + '.png')), `${id} 图标缺失`);
  }
});
