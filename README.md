# 宝可梦 · 晶穴深处（Pokémon: Crystal Depths，暂定）

> **以撒式房间制动作肉鸽 × 宝可梦素材 × HD-2D 像素立体绘本** —— 免费浏览器同人游戏（非官方粉丝作品）
>
> 带着皮卡丘下洞窟：走进水晶迷宫，用招式轰开蜂拥的野生宝可梦，捡起技能机和树果滚雪球，
> 打倒把守各层的道馆馆主，最深处等着你的是梦幻。
>
> 立项于 2026-11-02。**当前处于 M0（文档阶段），代码尚未开始**——先出设计文档，再动手写引擎。

## 设计文档（docs/）

| 文档 | 内容 |
| --- | --- |
| [00 总览与决策记录](docs/00-总览与决策记录.md) | 定位、技术/素材决策（ADR）、里程碑、非目标 |
| [01 游戏设计文档](docs/01-游戏设计文档.md) | 核心循环、操作手感、属性/克制、道具构筑、Boss、数值框架 |
| [02 技术设计文档](docs/02-技术设计文档.md) | 模拟/渲染分离架构、HD-2D 渲染管线、以撒地图生成算法、性能预算 |
| [03 美术与视觉规范](docs/03-美术与视觉规范.md) | HD-2D 配方：相机、灯光、精灵面片工艺、后处理参数、验收清单 |
| [04 内容清单](docs/04-内容清单.md) | 首发宝可梦/敌人/Boss/道具/成就全表（名单以素材覆盖定稿） |
| [05 开发路线图](docs/05-开发路线图.md) | M0–M6 里程碑、任务分解、验收标准 |
| [06 素材与版权](docs/06-素材与版权.md) | 素材来源与许可、署名义务、免责声明、下架预案 |

## 技术栈

- **Three.js r187（WebGLRenderer）+ pmndrs/postprocessing**：像素精灵 billboard × 3D 灯光/景深/泛光，
  八方旅人式 HD-2D；画质三档自适应；
- **无构建**：原生 ES 模块 + import map + vendor 锁版本，GitHub Pages 纯静态部署；
- **模拟与渲染分离**：引擎纯函数 + 种子随机 + 固定步长 60Hz，地图生成/伤害结算全部确定性可测；
- **素材管线**：SpriteCollab 8 方向 PMD 动画（Walk/Attack/Hurt…）→ 图集打包；CC0 图块搭场景；
  PokeAPI 叫声 + WebAudio 合成音。

## 运行（M1 交付后可用）

```bash
python3 tools/serve.py 8349    # 预定端口；M1 提交 serve.py 后生效
# 打开 http://127.0.0.1:8349
```

## 同系列作品

- [gym-run《宝可梦·徽章之路》](../gym-run/)：Balatro 式卡牌构筑肉鸽（本工作区第一作）
- [gym-pixel《宝可梦·像素徽章之路》](../gym-pixel/)：上作的像素重制版（第二作）

## 版权声明（重要）

本作品是**非官方、非营利**的粉丝游戏，与任天堂 / Game Freak / Creatures / The Pokémon Company
无关亦未获其授权。

- Pokémon 及全部角色形象 © Nintendo · Creatures · Game Freak
- 宝可梦动画素材来自 [SpriteCollab](https://github.com/PMDCollab/SpriteCollab)（PMDCollab 社区，
  含官方 PMD 拆包件与社区自制件，逐物种署名随包分发）、图标与叫声来自 [PokeAPI](https://pokeapi.dev)
  社区图库，仅供学习交流
- 场景图块来自 CC0 素材（Kenney / 0x72 / ArMM1998 / DCSS 等），字体为
  [缝合像素字体 Fusion Pixel](https://github.com/TakWolf/fusion-pixel-font)（SIL OFL 1.1）
- **严禁商用、严禁再分发素材本身**；若权利方提出要求将在 24 小时内下架（完整预案见
  [docs/06](docs/06-素材与版权.md)）
