#!/usr/bin/env python3
"""Serve only the application files on this device, without dependencies."""
import argparse
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from urllib.parse import urlsplit
import webbrowser

ROOT = Path(__file__).resolve().parent
FILES = {'/web-updates.js': ('web-updates.js', 'text/javascript; charset=utf-8'),
         '/crypto-vault.js': ('crypto-vault.js', 'text/javascript; charset=utf-8'),
         '/vault-ui.js': ('vault-ui.js', 'text/javascript; charset=utf-8'),
         '/style.css': ('style.css', 'text/css; charset=utf-8'),
         '/app.js': ('app.js', 'text/javascript; charset=utf-8'),
         '/planner.js': ('planner.js', 'text/javascript; charset=utf-8')}

class Handler(BaseHTTPRequestHandler):
    def do_GET(self):
        path = urlsplit(self.path).path
        if path in ('/', '/index.html', '/Mi-economia.html'):
            name = 'Mi-economia.html' if (ROOT / 'Mi-economia.html').is_file() else 'index.html'
            mime = 'text/html; charset=utf-8'
        elif path in FILES:
            name, mime = FILES[path]
        else:
            self.send_error(404)
            return
        target = ROOT / name
        if not target.is_file():
            self.send_error(404)
            return
        body = target.read_bytes()
        self.send_response(200)
        self.send_header('Content-Type', mime)
        self.send_header('Content-Length', str(len(body)))
        self.send_header('Cache-Control', 'no-store')
        self.send_header('X-Content-Type-Options', 'nosniff')
        self.send_header('Referrer-Policy', 'no-referrer')
        self.end_headers()
        self.wfile.write(body)

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Abrir Mi economía solo en este dispositivo.')
    parser.add_argument('--port', type=int, default=8765)
    parser.add_argument('--no-browser', action='store_true')
    args = parser.parse_args()
    try:
        server = ThreadingHTTPServer(('127.0.0.1', args.port), Handler)
    except OSError as error:
        raise SystemExit('No se pudo iniciar. Comprueba si ya está abierto y usa siempre el mismo puerto. ' + str(error))
    address = f'http://127.0.0.1:{args.port}/'
    print('Mi economía está funcionando solo en este dispositivo. Cierra con Ctrl+C.', flush=True)
    if not args.no_browser:
        webbrowser.open(address)
    try:
        server.serve_forever()
    except KeyboardInterrupt:
        pass
    finally:
        server.server_close()
