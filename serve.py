"""Serve the app locally; the application uses the main branch for data."""
import http.server
from urllib.parse import urlsplit


class Handler(http.server.SimpleHTTPRequestHandler):
    def do_GET(self):
        path = urlsplit(self.path).path
        if path == '/.git' or path.startswith('/.git/'):
            self.send_error(404)
            return
        super().do_GET()


if __name__ == '__main__':
    http.server.ThreadingHTTPServer(('0.0.0.0', 8000), Handler).serve_forever()
