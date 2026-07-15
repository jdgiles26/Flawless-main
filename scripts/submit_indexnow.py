#!/usr/bin/env python3
"""Notify IndexNow after the canonical Flawless blog deploys."""

from __future__ import annotations

import argparse
import json
import urllib.error
import urllib.parse
import urllib.request

from build_blog import BLOG_ROOT, load_posts


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument(
        "--base-url",
        default="https://william-lu-stack.github.io/Flawless",
    )
    args = parser.parse_args()
    base_url = args.base_url.rstrip("/")
    parsed = urllib.parse.urlparse(base_url)
    key = (BLOG_ROOT / "indexnow-key.txt").read_text(encoding="utf-8").strip()
    urls = [f"{base_url}/", f"{base_url}/feed.xml", f"{base_url}/llms.txt"]
    urls.extend(post["url"] for post in load_posts(base_url))
    payload = {
        "host": parsed.netloc,
        "key": key,
        "keyLocation": f"{base_url}/indexnow-key.txt",
        "urlList": urls,
    }
    request = urllib.request.Request(
        "https://api.indexnow.org/indexnow",
        data=json.dumps(payload).encode("utf-8"),
        method="POST",
        headers={"content-type": "application/json; charset=utf-8"},
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            print(f"IndexNow accepted {len(urls)} URLs ({response.status}).")
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise SystemExit(f"IndexNow failed ({exc.code}): {detail}") from exc


if __name__ == "__main__":
    main()
