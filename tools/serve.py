"""Tiny local server for working on the site.

    python tools/serve.py            # http://localhost:4173/
    python tools/serve.py 8000       # another port

It serves the project folder, turns browser caching off so every save shows
up on reload, and shows 404.html for a wrong address the way GitHub Pages
and Netlify do. Nothing here is needed to publish the site.

It also accepts POST /__capture/<name>.png from the dev pages (the Story
poster capture) and saves the picture under assets/img/story/. This exists
only on this local server; the published site is plain static files.
"""
import os
import re
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
CAPTURE_DIR = os.path.join(ROOT, 'assets', 'img', 'story')
CAPTURE_RE = re.compile(r'^/__capture/([a-z0-9][a-z0-9-]{0,40}\.png)$')


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Expires', '0')
        super().end_headers()

    def from_this_site(self):
        # Only the dev pages served from here may save pictures: another web
        # site open in the same browser must not be able to post to this port.
        port = self.server.server_address[1]
        hosts = ('localhost:%d' % port, '127.0.0.1:%d' % port)
        origin = self.headers.get('Origin')
        site = self.headers.get('Sec-Fetch-Site')
        return (self.headers.get('Host') in hosts
                and (origin is None or origin in tuple('http://' + h for h in hosts))
                and site in (None, 'same-origin'))

    def do_POST(self):
        if not self.from_this_site():
            self.send_response(403)
            self.end_headers()
            return
        m = CAPTURE_RE.match(self.path)
        length = int(self.headers.get('Content-Length') or 0)
        if not m or length <= 0 or length > 4_000_000:
            self.send_response(400)
            self.end_headers()
            return
        data = self.rfile.read(length)
        if not data.startswith(b'\x89PNG'):
            self.send_response(415)
            self.end_headers()
            return
        os.makedirs(CAPTURE_DIR, exist_ok=True)
        with open(os.path.join(CAPTURE_DIR, m.group(1)), 'wb') as f:
            f.write(data)
        self.send_response(204)
        self.end_headers()

    def send_error(self, code, message=None, explain=None):
        page = os.path.join(ROOT, '404.html')
        if code == 404 and os.path.exists(page):
            body = open(page, 'rb').read()
            self.send_response(404)
            self.send_header('Content-Type', 'text/html; charset=utf-8')
            self.send_header('Content-Length', str(len(body)))
            self.end_headers()
            if self.command != 'HEAD':
                self.wfile.write(body)
            return
        super().send_error(code, message, explain)

    def log_message(self, fmt, *args):
        sys.stdout.write('%s %s\n' % (self.command, self.path))
        sys.stdout.flush()


def main():
    port = int(sys.argv[1]) if len(sys.argv) > 1 else 4173
    handler = partial(Handler, directory=ROOT)
    with ThreadingHTTPServer(('127.0.0.1', port), handler) as httpd:
        print('Serving %s at http://localhost:%d/' % (ROOT, port))
        sys.stdout.flush()
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            pass


if __name__ == '__main__':
    main()
