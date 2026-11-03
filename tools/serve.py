#!/usr/bin/env python3
"""开发服务器：静态文件（禁缓存）+ 云端周榜 API（JSON 文件存储）

API:
  POST /api/score   {key, name, score, result, fightsWon, maxHit, date, variant}
  GET  /api/board?key=2026-W44  -> {board: [entry...]}  （该周 Top 10）
"""
import http.server
import socketserver
import os
import sys
import json
import threading
from urllib.parse import urlsplit, parse_qs

PORT = int(sys.argv[1]) if len(sys.argv) > 1 else 8349
ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
SCORES_FILE = os.path.join(ROOT, 'scores.json')
LOCK = threading.Lock()
MAX_ENTRIES = 200
RATE_MAX_PER_HOUR = 30       # 每 IP 每小时最多提交次数
RATE_MIN_GAP = 5             # 两次提交最小间隔（秒）

os.chdir(ROOT)

_ip_hits = {}  # ip -> [timestamps]


def load_scores():
    try:
        with open(SCORES_FILE, encoding='utf-8') as f:
            return json.load(f)
    except Exception:
        return []


def save_scores(data):
    with open(SCORES_FILE, 'w', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False)


class Handler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Pragma', 'no-cache')
        super().end_headers()

    def log_message(self, fmt, *args):
        pass

    # ---------- API ----------
    def _json(self, code, obj):
        body = json.dumps(obj, ensure_ascii=False).encode('utf-8')
        self.send_response(code)
        self.send_header('Content-Type', 'application/json; charset=utf-8')
        self.send_header('Content-Length', str(len(body)))
        self.end_headers()
        self.wfile.write(body)

    def do_POST(self):
        if self.path != '/api/score':
            return self._json(404, {'error': 'not found'})
        try:
            # IP 限流：每小时上限 + 最小间隔
            import time as _time
            now = _time.time()
            ip = self.client_address[0]
            with LOCK:
                hits = [t for t in _ip_hits.get(ip, []) if now - t < 3600]
                if len(hits) >= RATE_MAX_PER_HOUR:
                    return self._json(429, {'error': '提交过于频繁，稍后再试'})
                if hits and now - hits[-1] < RATE_MIN_GAP:
                    return self._json(429, {'error': '提交太急了，稍后再试'})
                hits.append(now)
                _ip_hits[ip] = hits
            length = int(self.headers.get('Content-Length', 0))
            data = json.loads(self.rfile.read(length).decode('utf-8'))
            token = str(data.get('token', ''))[:32]
            key = str(data.get('key', ''))[:20]
            if not key:
                return self._json(400, {'error': 'missing key'})
            entry = {
                'id': str(data.get('id', ''))[:24],
                'token': token,
                'key': key,
                'name': str(data.get('name', '训练师'))[:16],
                'score': max(0, min(9_999_999, int(data.get('score', 0)))),
                'result': str(data.get('result', ''))[:8],
                'fightsWon': max(0, min(99, int(data.get('fightsWon', 0)))),
                'maxHit': max(0, min(9_999_999, int(data.get('maxHit', 0)))),
                'date': str(data.get('date', ''))[:10],
                'variant': str(data.get('variant', ''))[:12],
            }
            with LOCK:
                scores = load_scores()
                # 令牌去重：同一局重复提交直接拒绝
                if token and any(e.get('key') == key and e.get('token') == token for e in scores):
                    return self._json(409, {'error': 'duplicate'})
                scores.append(entry)
                scores.sort(key=lambda e: -e['score'])
                scores = scores[:MAX_ENTRIES]
                save_scores(scores)
                week = [i for i, e in enumerate(scores) if e.get('key') == entry['key']]
                rank = next((i + 1 for i in week if scores[i].get('id') == entry['id']), 0)
            return self._json(200, {'ok': True, 'rank': rank})
        except Exception as e:
            return self._json(400, {'error': str(e)})

    def do_GET(self):
        if self.path.startswith('/api/board'):
            q = parse_qs(urlsplit(self.path).query)
            key = (q.get('key') or [''])[0][:20]
            with LOCK:
                scores = load_scores()
            board = [e for e in scores if not key or e.get('key') == key]
            board.sort(key=lambda e: -e['score'])
            return self._json(200, {'board': board[:10]})
        return super().do_GET()


class ThreadingServer(socketserver.ThreadingTCPServer):
    daemon_threads = True
    allow_reuse_address = True


if __name__ == '__main__':
    with ThreadingServer(('127.0.0.1', PORT), Handler) as httpd:
        print(f'serving at http://127.0.0.1:{PORT}')
        httpd.serve_forever()
