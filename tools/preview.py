#!/usr/bin/env python3
"""Preview the public site and a local export without exposing private project files."""
import argparse
import functools
from http.server import HTTPServer, SimpleHTTPRequestHandler
from pathlib import Path
from urllib.parse import unquote, urlparse

ROOT = Path(__file__).resolve().parents[1]


class Handler(SimpleHTTPRequestHandler):
    bundle = ROOT / 'publish/site'

    def translate_path(self, path):
        parts = Path(unquote(urlparse(path).path).lstrip('/')).parts
        if any(part.startswith('.') for part in parts):
            return str(ROOT / '__not_public__')
        relative = Path(*parts) if parts else Path('index.html')
        if parts and parts[0] in ('data', 'media'):
            base = self.bundle
        elif str(relative) in ('index.html', 'search.html', 'instance.html', 'about.html', 'privacy.html', '404.html', 'guestbook-admin.html', 'styles.css', 'background.js', 'app.js', 'stats.js', 'guestbook.js', 'guestbook-admin.js', 'config/site.json') or (parts and parts[0] == 'assets'):
            base = ROOT
        else:
            return str(ROOT / '__not_public__')
        target = (base / relative).resolve()
        try:
            target.relative_to(base.resolve())
        except ValueError:
            return str(ROOT / '__not_public__')
        return str(target)

    def list_directory(self, path):
        self.send_error(404)
        return None

    def end_headers(self):
        block = (ROOT / '_headers').read_text(encoding='utf-8').split('\n\n')[0]
        for line in block.splitlines()[1:]:
            if ': ' in line:
                key, value = line.strip().split(': ', 1)
                self.send_header(key, value)
        self.send_header('Cache-Control', 'no-cache')
        super().end_headers()


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--port', type=int, default=4174)
    parser.add_argument('--bind', default='127.0.0.1')
    parser.add_argument('--bundle', type=Path, default=ROOT / 'publish/site')
    args = parser.parse_args()
    Handler.bundle = args.bundle.resolve()
    print('Public preview: http://%s:%d' % (args.bind, args.port), flush=True)
    HTTPServer((args.bind, args.port), Handler).serve_forever()
