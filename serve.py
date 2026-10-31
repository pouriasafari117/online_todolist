"""Serve the app locally with the branch of this checkout, not a hard-coded ref."""
import http.server
import json
import subprocess
from urllib.parse import urlsplit


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/.git' or path.startswith('/.git/'):
            self.send_error(404)
            return
        if path == '/runtime-config.js':
            result = subprocess.run(['git', 'branch', '--show-current'], capture_output=True, text=True, check=False)
            branch = result.stdout.strip() if result.returncode == 0 else ''
            data = ('window.ROOZANEH_BRANCH = ' + json.dumps(branch or None, ensure_ascii=True) + ';\n').encode()
            self.send_response(200)
            self.send_header('Content-Type', 'application/javascript; charset=utf-8')
            self.send_header('Cache-Control', 'no-store')
            self.send_header('Content-Length', str(len(data)))
            self.end_headers()
            self.wfile.write(data)
            return
        super().do_GET()


if __name__ == '__main__':
    http.server.ThreadingHTTPServer(('0.0.0.0', 8000), Handler).serve_forever()
