"""Tiny local server for working on the site.

    python tools/serve.py            # http://localhost:4173/
    python tools/serve.py 8000       # another port

It serves the project folder, turns browser caching off so every save shows
up on reload, and shows 404.html for a wrong address the way GitHub Pages
and Netlify do. Nothing here is needed to publish the site.
"""
import os
import sys
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))


class Handler(SimpleHTTPRequestHandler):
    def end_headers(self):
        self.send_header('Cache-Control', 'no-store, must-revalidate')
        self.send_header('Expires', '0')
        super().end_headers()

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
