#!/usr/bin/env python3
"""生成 Service Worker（sw.js）：预缓存清单 + 哈希版本号 + 运行时回填。

预缓存 = 站点全部静态资源（约 5.6MB；orig 换皮包与 credits 一并入列，离线 selfcheck 可用）。
版本号 = 清单内容联合 md5 前 10 位——资源变动即换版本，activate 时清旧缓存。
改任何前端资源后重跑本脚本（同 gym 系 make-sw 流程）。

用法：python3 tools/make-sw.py   （输出体积统计）
"""
import hashlib
import os

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

INCLUDE_DIRS = ['css', 'js', 'vendor', 'assets/tiles', 'assets/items', 'assets/atlas',
                'assets/cries', 'assets/fonts', 'assets/orig', 'assets/credits']
INCLUDE_FILES = ['index.html', 'lab.html', 'sw.js']      # sw.js 自身不入缓存清单
EXCLUDE_SUFFIX = ('.DS_Store', '.md')

# URL 子路径前缀：GitHub Pages 子路径部署（/pokecard-depths/）与本地根路径都兼容——
# 相对路径让 SW 在任意 base 下工作。
SW_TEMPLATE = '''// 由 tools/make-sw.py 生成，勿手改。VERSION 变更即全量换缓存。
const VERSION = '__VERSION__';
const PRECACHE = __MANIFEST__;

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(VERSION);
    await cache.addAll(PRECACHE.map((p) => new Request(p, { cache: 'reload' })));
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k)));
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // 同源 GET：缓存优先，未命中走网络并回填（图鉴叫声等懒加载资源渐进离线化）
  e.respondWith((async () => {
    const cache = await caches.open(VERSION);
    const hit = await cache.match(e.request, { ignoreSearch: true });
    if (hit) return hit;
    try {
      const res = await fetch(e.request);
      if (res.ok) cache.put(e.request, res.clone());
      return res;
    } catch (err) {
      return hit || Response.error();
    }
  })());
});
'''


def main():
    files = []
    for d in INCLUDE_DIRS:
        base = os.path.join(ROOT, d)
        if not os.path.isdir(base):
            continue
        for dirpath, _, names in os.walk(base):
            for n in sorted(names):
                rel = os.path.relpath(os.path.join(dirpath, n), ROOT)
                if n.endswith(EXCLUDE_SUFFIX):
                    continue
                files.append(rel)
    for f in INCLUDE_FILES:
        if f == 'sw.js':
            continue
        if os.path.exists(os.path.join(ROOT, f)):
            files.append(f)
    files.sort()

    h = hashlib.md5()
    total = 0
    for f in files:
        p = os.path.join(ROOT, f)
        data = open(p, 'rb').read()
        h.update(f.encode()); h.update(data)
        total += len(data)

    version = h.hexdigest()[:10]
    manifest = '[\n' + ',\n'.join(f'  "{f}"' for f in files) + ',\n]'
    sw = SW_TEMPLATE.replace('__VERSION__', version).replace('__MANIFEST__', manifest)
    with open(os.path.join(ROOT, 'sw.js'), 'w') as fp:
        fp.write(sw)

    print(f'sw.js：{len(files)} 个文件，预缓存 {total / 1024 / 1024:.2f} MB，版本 {version}')


if __name__ == '__main__':
    main()
