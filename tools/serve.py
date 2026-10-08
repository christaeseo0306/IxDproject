#!/usr/bin/env python3
"""큰 영상을 끊김 없이 내보내기 위한 로컬 서버.

표준 `python3 -m http.server` 는 구간 요청(Range)을 지원하지 않습니다.
그래서 187MB 짜리 영상이면 전체를 받아야 재생이 시작되고, 되감기를 할 때마다
다시 받습니다. 이 서버는 206 Partial Content 로 답해 즉시 재생되고,
되감기와 탐색도 바로 됩니다.
"""
import os
import re
import sys
import webbrowser
from functools import partial
from http import HTTPStatus
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer

RANGE_RE = re.compile(r"bytes=(\d*)-(\d*)$")

# 브라우저가 알아듣는 형식으로 확실히 내보냅니다
SimpleHTTPRequestHandler.extensions_map.update({
    ".m4v": "video/mp4",
    ".mp4": "video/mp4",
    ".mov": "video/quicktime",
    ".webm": "video/webm",
    ".ogv": "video/ogg",
    ".js": "text/javascript",
    ".json": "application/json",
})


class RangeHandler(SimpleHTTPRequestHandler):
    protocol_version = "HTTP/1.1"

    def end_headers(self):
        self.send_header("Accept-Ranges", "bytes")
        self.send_header("Cache-Control", "no-store")
        super().end_headers()

    def send_head(self):
        rng = self.headers.get("Range")
        if not rng:
            return super().send_head()

        path = self.translate_path(self.path)
        if os.path.isdir(path):
            return super().send_head()
        try:
            f = open(path, "rb")
        except OSError:
            self.send_error(HTTPStatus.NOT_FOUND, "File not found")
            return None

        size = os.fstat(f.fileno()).st_size
        m = RANGE_RE.match(rng.strip())
        if not m:
            f.close()
            self.send_error(HTTPStatus.BAD_REQUEST, "Invalid Range")
            return None

        start_s, end_s = m.groups()
        if start_s:
            start = int(start_s)
            end = int(end_s) if end_s else size - 1
        else:                                   # bytes=-500 : 끝에서 500바이트
            if not end_s:
                f.close()
                self.send_error(HTTPStatus.BAD_REQUEST, "Invalid Range")
                return None
            start = max(0, size - int(end_s))
            end = size - 1
        end = min(end, size - 1)

        if start >= size or start > end:
            f.close()
            self.send_response(HTTPStatus.REQUESTED_RANGE_NOT_SATISFIABLE)
            self.send_header("Content-Range", f"bytes */{size}")
            self.send_header("Content-Length", "0")
            self.end_headers()
            return None

        self.send_response(HTTPStatus.PARTIAL_CONTENT)
        self.send_header("Content-Type", self.guess_type(path))
        self.send_header("Content-Range", f"bytes {start}-{end}/{size}")
        self.send_header("Content-Length", str(end - start + 1))
        self.end_headers()
        f.seek(start)
        return _Slice(f, end - start + 1)

    def log_message(self, fmt, *args):          # 조용히
        pass


class _Slice:
    """copyfile 이 읽어 갈 만큼만 내주는 래퍼."""

    def __init__(self, fp, remaining):
        self.fp = fp
        self.remaining = remaining

    def read(self, n=-1):
        if self.remaining <= 0:
            return b""
        if n is None or n < 0 or n > self.remaining:
            n = self.remaining
        data = self.fp.read(n)
        self.remaining -= len(data)
        return data

    def close(self):
        self.fp.close()


def pick_port(want):
    """비어 있는 포트에 자리를 잡고 서버를 돌려줍니다."""
    handler = partial(RangeHandler, directory=os.getcwd())
    last = None
    for port in range(want, want + 40):
        try:
            httpd = ThreadingHTTPServer(("127.0.0.1", port), handler)
        except OSError as err:
            last = err
            continue
        return httpd, port
    raise SystemExit(f"✗ {want}~{want + 39} 번 포트를 모두 쓸 수 없습니다. ({last})")


def main():
    arg = sys.argv[1] if len(sys.argv) > 1 else ""
    want = int(arg) if arg.strip().isdigit() else 7777

    httpd, port = pick_port(want)
    httpd.daemon_threads = True
    url = f"http://localhost:{port}/"

    if port != want:
        print(f"\n⚠ {want} 번 포트를 다른 프로그램이 쓰고 있어 {port} 번으로 띄웁니다.")
    bar = "─" * 46
    print(f"""
┌{bar}┐
   브라우저 주소창에 이 주소가 맞는지 확인하세요

       {url}

   다른 주소가 열렸으면 위 주소를 직접 입력하세요.
   종료는 이 창에서 Control + C
└{bar}┘
""")

    try:
        webbrowser.open(url)
    except Exception:
        pass

    try:
        httpd.serve_forever()
    except KeyboardInterrupt:
        print("\n서버를 종료합니다.")
    finally:
        httpd.server_close()


if __name__ == "__main__":
    main()
