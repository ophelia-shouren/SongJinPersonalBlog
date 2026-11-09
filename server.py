import base64
import hashlib
import hmac
import json
import os
import re
import secrets
import sqlite3
import time
from contextlib import closing
from http.cookies import SimpleCookie
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path

ROOT = Path(__file__).resolve().parent
OWNER = 'yearnwingwings'
ROUNDS = 600000
LIFETIME = 86400 * 7


def db():
    return sqlite3.connect(ROOT / 'journal.sqlite3')


def digest(password, salt):
    return hashlib.pbkdf2_hmac('sha256', password.encode(), salt, ROUNDS)


def token_hash(token):
    return hashlib.sha256(token.encode()).hexdigest()


def setup():
    with closing(db()) as conn, conn:
        conn.executescript("""
            CREATE TABLE IF NOT EXISTS users (name TEXT PRIMARY KEY, salt BLOB, hash BLOB);
            CREATE TABLE IF NOT EXISTS sessions (token TEXT PRIMARY KEY, name TEXT, expires INTEGER);
            CREATE TABLE IF NOT EXISTS posts (id INTEGER PRIMARY KEY, title TEXT, body TEXT,
                image BLOB, mime TEXT, created TEXT DEFAULT CURRENT_TIMESTAMP);
        """)
        if not conn.execute('SELECT 1 FROM users WHERE name=?', (OWNER,)).fetchone():
            from getpass import getpass
            password = os.environ.get('JOURNAL_OWNER_PASSWORD') or getpass('Initial blogger password: ')
            if not password:
                raise SystemExit('Password required')
            salt = secrets.token_bytes(16)
            conn.execute('INSERT INTO users VALUES (?,?,?)', (OWNER, salt, digest(password, salt)))


class Handler(BaseHTTPRequestHandler):
    def send(self, status, data, mime='application/json; charset=utf-8', cookie=None):
        if not isinstance(data, bytes):
            data = json.dumps(data, ensure_ascii=False).encode()
        self.send_response(status)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(data)))
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Cache-Control', 'no-store')
        self.send_header('Content-Security-Policy', "default-src 'self'; frame-ancestors 'none'; base-uri 'none'")
        if cookie is not None:
            secure = '; Secure' if os.environ.get('JOURNAL_SECURE_COOKIE') == '1' else ''
            age = LIFETIME if cookie else 0
            self.send_header('Set-Cookie', f'journal={cookie}; Path=/; HttpOnly; SameSite=Strict; Max-Age={age}{secure}')
        self.end_headers()
        self.wfile.write(data)

    def token(self):
        cookie = SimpleCookie(self.headers.get('Cookie', ''))
        return token_hash(cookie['journal'].value) if 'journal' in cookie else ''

    def account(self, conn):
        row = conn.execute('SELECT name FROM sessions WHERE token=? AND expires>?',
                           (self.token(), int(time.time()))).fetchone()
        return row[0] if row else None

    def do_GET(self):
        files = {'/': ('index.html', 'text/html'), '/style.css': ('style.css', 'text/css'),
                 '/app.js': ('app.js', 'text/javascript')}
        if self.path in files:
            name, mime = files[self.path]
            return self.send(200, (ROOT / name).read_bytes(), mime + '; charset=utf-8')
        with closing(db()) as conn:
            name = self.account(conn)
            if self.path == '/api/me':
                return self.send(200, {'name': name, 'owner': name == OWNER})
            if not name:
                return self.send(401, {'error': '请先登录。'})
            if self.path == '/api/posts':
                rows = conn.execute('SELECT id,title,body,mime,created FROM posts ORDER BY id DESC')
                return self.send(200, [dict(id=i, title=t, body=b, image=bool(m), created=c)
                                       for i, t, b, m, c in rows])
            match = re.fullmatch(r'/media/(\d+)', self.path)
            if match:
                row = conn.execute('SELECT image,mime FROM posts WHERE id=? AND mime IS NOT NULL',
                                   (match[1],)).fetchone()
                if row:
                    return self.send(200, row[0], row[1])
        self.send(404, {'error': '页面不存在。'})

    def do_POST(self):
        if self.headers.get_content_type() != 'application/json':
            return self.send(415, {'error': '请求格式不正确。'})
        try:
            size = int(self.headers.get('Content-Length', '0'))
            if not 0 < size <= 7200000:
                return self.send(413, {'error': '请求内容过大或为空。'})
            data = json.loads(self.rfile.read(size))
            if not isinstance(data, dict):
                raise ValueError()
            with closing(db()) as conn, conn:
                status, result, cookie = self.action(conn, data)
            return self.send(status, result, cookie=cookie)
        except (ValueError, TypeError, AttributeError):
            return self.send(400, {'error': '请检查输入内容。'})

    def action(self, conn, data):
        if self.path == '/api/logout':
            conn.execute('DELETE FROM sessions WHERE token=?', (self.token(),))
            return 200, {}, ''
        if self.path in ('/api/login', '/api/register'):
            name, password = data.get('name', ''), data.get('password', '')
            if not re.fullmatch(r'[A-Za-z0-9_]{3,32}', name) or not 1 <= len(password) <= 128:
                return 400, {'error': '请检查账号和密码格式。'}, None
            if self.path == '/api/register':
                if len(password) < 8 or name.casefold() == OWNER:
                    return 400, {'error': '请换一个账号，并使用至少 8 位密码。'}, None
                salt = secrets.token_bytes(16)
                cursor = conn.execute('INSERT OR IGNORE INTO users VALUES (?,?,?)',
                                      (name, salt, digest(password, salt)))
                if not cursor.rowcount:
                    return 409, {'error': '这个账号已注册。'}, None
                return 201, {}, None
            row = conn.execute('SELECT salt,hash FROM users WHERE name=?', (name,)).fetchone()
            expected_role = 'owner' if name == OWNER else 'guest'
            salt, expected = row if row else (bytes(16), bytes(32))
            valid = hmac.compare_digest(digest(password, salt), expected)
            if not row or not valid or data.get('role') != expected_role:
                return 401, {'error': '账号、密码或登录身份不正确。'}, None
            token = secrets.token_urlsafe(32)
            now = int(time.time())
            conn.execute('DELETE FROM sessions WHERE token=? OR expires<=?', (self.token(), now))
            conn.execute('INSERT INTO sessions VALUES (?,?,?)', (token_hash(token), name, now + LIFETIME))
            return 200, {}, token
        if self.path == '/api/posts':
            if self.account(conn) != OWNER:
                return 403, {'error': '只有博主可以发布。'}, None
            title, body = data.get('title', '').strip(), data.get('body', '').strip()
            image = base64.b64decode(data.get('image', ''), validate=True)
            mime = None
            if image.startswith(b'\x89PNG\r\n\x1a\n'):
                mime = 'image/png'
            elif image.startswith(b'\xff\xd8\xff'):
                mime = 'image/jpeg'
            elif image[:4] == b'RIFF' and image[8:12] == b'WEBP':
                mime = 'image/webp'
            elif image[:6] in (b'GIF87a', b'GIF89a'):
                mime = 'image/gif'
            if (image and not mime) or len(image) > 5 * 1024 * 1024:
                return 400, {'error': '请选择 5 MB 以内的 PNG、JPEG、WebP 或 GIF 图片。'}, None
            if len(title) > 100 or len(body) > 50000 or not (title or body or image):
                return 400, {'error': '请填写内容，标题最多 100 字，正文最多 50,000 字。'}, None
            conn.execute('INSERT INTO posts (title,body,image,mime) VALUES (?,?,?,?)',
                         (title, body, image or None, mime))
            return 201, {}, None
        return 404, {'error': '页面不存在。'}, None


if __name__ == '__main__':
    setup()
    port = int(os.environ.get('JOURNAL_PORT', '8765'))
    with ThreadingHTTPServer(('127.0.0.1', port), Handler) as server:
        print(f'http://127.0.0.1:{port}', flush=True)
        server.serve_forever()
