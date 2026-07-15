#!/usr/bin/env python3
"""Idempotently syndicate Flawless blog posts through official platform APIs."""

from __future__ import annotations

import argparse
import json
import os
import urllib.error
import urllib.request

from build_blog import AUTHOR, AUTHOR_EN, REPOSITORY_URL, load_posts


DEV_API = "https://dev.to/api"


def dev_request(api_key: str, method: str, path: str, payload: dict | None = None):
    data = None if payload is None else json.dumps(payload).encode("utf-8")
    request = urllib.request.Request(
        f"{DEV_API}{path}",
        data=data,
        method=method,
        headers={
            "accept": "application/vnd.forem.api-v1+json",
            "api-key": api_key,
            "content-type": "application/json",
            "user-agent": "Flawless-Blog-Syndicator/1.0",
        },
    )
    try:
        with urllib.request.urlopen(request, timeout=30) as response:
            return json.load(response)
    except urllib.error.HTTPError as exc:
        detail = exc.read().decode("utf-8", errors="replace")
        raise RuntimeError(f"DEV API {method} {path} failed ({exc.code}): {detail}") from exc


def find_dev_article(api_key: str, canonical_url: str, title: str) -> dict | None:
    articles = dev_request(api_key, "GET", "/articles/me/all?per_page=1000")
    for article in articles:
        if article.get("canonical_url") == canonical_url:
            return article
    for article in articles:
        if article.get("title") == title:
            return article
    return None


def publish_to_dev(api_key: str, base_url: str, draft: bool) -> None:
    posts = load_posts(base_url)
    for post in reversed(posts):
        if not post.get("publish_to_dev", False):
            continue
        body = (
            f"> Written in Shanghai by {AUTHOR} ({AUTHOR_EN}).  \n"
            f"> Canonical edition: {post['url']}  \n"
            f"> Source code: {REPOSITORY_URL}\n\n"
            f"{post['body_markdown']}"
        )
        article_payload = {
            "article": {
                "title": post["title_en"],
                "body_markdown": body,
                "published": bool(post.get("published")) and not draft,
                "main_image": post["cover_url"],
                "canonical_url": post["url"],
                "description": post["description_en"],
                "tags": [str(tag).lower() for tag in post["tags"][:4]],
                "series": "Flawless Field Notes",
            }
        }
        existing = find_dev_article(api_key, post["url"], post["title_en"])
        if existing:
            result = dev_request(
                api_key,
                "PUT",
                f"/articles/{existing['id']}",
                article_payload,
            )
            action = "updated"
        else:
            result = dev_request(api_key, "POST", "/articles", article_payload)
            action = "published" if article_payload["article"]["published"] else "drafted"
        print(f"DEV {action}: {result.get('url') or post['title_en']}")


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--platform", choices=["devto"], default="devto")
    parser.add_argument(
        "--base-url",
        default="https://william-lu-stack.github.io/Flawless",
    )
    parser.add_argument("--draft", action="store_true")
    parser.add_argument("--allow-missing-token", action="store_true")
    args = parser.parse_args()

    api_key = os.getenv("DEVTO_API_KEY", "").strip()
    if not api_key:
        if args.allow_missing_token:
            print("DEV syndication skipped: DEVTO_API_KEY is not configured.")
            return
        raise SystemExit("DEVTO_API_KEY is required")
    publish_to_dev(api_key, args.base_url.rstrip("/"), args.draft)


if __name__ == "__main__":
    main()
