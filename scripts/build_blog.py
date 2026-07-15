#!/usr/bin/env python3
"""Build the Flawless bilingual static blog."""

from __future__ import annotations

import argparse
import html
import json
import re
import shutil
from datetime import date, datetime, timezone
from email.utils import format_datetime
from pathlib import Path
import markdown
import yaml
from jinja2 import Environment, FileSystemLoader, select_autoescape
from markupsafe import Markup


ROOT = Path(__file__).resolve().parents[1]
BLOG_ROOT = ROOT / "blog"
POSTS_ROOT = BLOG_ROOT / "posts"
REPOSITORY_URL = "https://github.com/William-Lu-stack/Flawless"
AUTHOR = "陆宣宇"
AUTHOR_EN = "Xuanyu Lu"


def parse_front_matter(path: Path) -> tuple[dict, str]:
    text = path.read_text(encoding="utf-8")
    match = re.match(r"\A---\s*\n(.*?)\n---\s*\n(.*)\Z", text, re.DOTALL)
    if not match:
        raise ValueError(f"Missing YAML front matter: {path}")
    metadata = yaml.safe_load(match.group(1)) or {}
    return metadata, match.group(2).strip()


def normalize_date(value: object) -> date:
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    return date.fromisoformat(str(value))


def reading_time(markdown_text: str) -> int:
    chinese_chars = len(re.findall(r"[\u4e00-\u9fff]", markdown_text))
    english_words = len(re.findall(r"\b[A-Za-z][A-Za-z'-]*\b", markdown_text))
    return max(1, round(chinese_chars / 420 + english_words / 230))


def load_posts(base_url: str) -> list[dict]:
    renderer = markdown.Markdown(
        extensions=["fenced_code", "tables", "toc", "attr_list"],
        output_format="html5",
    )
    posts: list[dict] = []
    required = {
        "slug",
        "title",
        "title_en",
        "description",
        "description_en",
        "date",
        "series",
        "tags",
        "cover",
    }

    for path in sorted(POSTS_ROOT.glob("*.md")):
        metadata, body = parse_front_matter(path)
        missing = sorted(required - metadata.keys())
        if missing:
            raise ValueError(f"Missing {', '.join(missing)} in {path}")
        if not metadata.get("published", False):
            continue

        published_on = normalize_date(metadata["date"])
        slug = str(metadata["slug"]).strip("/")
        cover_path = "/" + str(metadata["cover"]).lstrip("/")
        canonical_url = f"{base_url}/posts/{slug}/"
        cover_url = f"{base_url}{cover_path}"
        rendered = renderer.reset().convert(body)
        post = {
            **metadata,
            "source_path": path,
            "body_markdown": body,
            "html": Markup(rendered),
            "published_on": published_on,
            "date_display": published_on.strftime("%Y.%m.%d"),
            "date_iso": published_on.isoformat(),
            "url": canonical_url,
            "cover_url": cover_url,
            "reading_time": reading_time(body),
            "cover_alt": metadata.get(
                "cover_alt",
                "Flawless operational loop from alert to verified recovery",
            ),
        }
        posts.append(post)

    return sorted(posts, key=lambda post: post["published_on"], reverse=True)


def write_text(path: Path, content: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")


def build_site(output_root: Path, base_url: str) -> None:
    if output_root.exists():
        shutil.rmtree(output_root)
    output_root.mkdir(parents=True)

    env = Environment(
        loader=FileSystemLoader(BLOG_ROOT / "templates"),
        autoescape=select_autoescape(["html", "xml"]),
        trim_blocks=True,
        lstrip_blocks=True,
    )
    base_template = env.get_template("base.html")
    index_template = env.get_template("index.html")
    post_template = env.get_template("post.html")
    posts = load_posts(base_url)
    hero_image = f"{base_url}/assets/images/luxyai-agenticops-loop.png"

    index_content = index_template.render(
        posts=posts,
        repository_url=REPOSITORY_URL,
        hero_image=hero_image,
    )
    index_schema = {
        "@context": "https://schema.org",
        "@type": "Blog",
        "name": "Flawless Field Notes",
        "description": "Bilingual field notes on AgenticOps, AI SRE, Kubernetes, and safe infrastructure automation.",
        "url": f"{base_url}/",
        "author": {
            "@type": "Person",
            "name": f"{AUTHOR} ({AUTHOR_EN})",
            "homeLocation": "Shanghai, China",
        },
    }
    index_page = base_template.render(
        lang="zh-CN",
        page_title="Flawless Field Notes · From alert to verified recovery",
        description="Flawless 中英文实战手记：AgenticOps、AI SRE、Kubernetes 安全修复与可验证恢复。",
        canonical_url=f"{base_url}/",
        base_url=base_url,
        repository_url=REPOSITORY_URL,
        og_type="website",
        og_image=hero_image,
        json_ld=json.dumps(index_schema, ensure_ascii=False),
        body_class="home-page",
        content=Markup(index_content),
    )
    write_text(output_root / "index.html", index_page)

    for post in posts:
        post_schema = {
            "@context": "https://schema.org",
            "@type": "BlogPosting",
            "headline": post["title"],
            "alternativeHeadline": post["title_en"],
            "description": post["description_en"],
            "image": [post["cover_url"]],
            "datePublished": post["date_iso"],
            "dateModified": post["date_iso"],
            "inLanguage": ["zh-CN", "en"],
            "mainEntityOfPage": post["url"],
            "author": {
                "@type": "Person",
                "name": f"{AUTHOR} ({AUTHOR_EN})",
                "homeLocation": "Shanghai, China",
            },
            "publisher": {
                "@type": "Organization",
                "name": "Flawless",
                "url": REPOSITORY_URL,
            },
            "keywords": post["tags"],
        }
        post_content = post_template.render(post=post, repository_url=REPOSITORY_URL)
        post_page = base_template.render(
            lang="zh-CN",
            page_title=f"{post['title']} · Flawless",
            description=post["description"],
            canonical_url=post["url"],
            base_url=base_url,
            repository_url=REPOSITORY_URL,
            og_type="article",
            og_image=post["cover_url"],
            json_ld=json.dumps(post_schema, ensure_ascii=False),
            body_class="post-page",
            content=Markup(post_content),
        )
        write_text(output_root / "posts" / post["slug"] / "index.html", post_page)

    shutil.copytree(BLOG_ROOT / "assets", output_root / "assets")
    shutil.copy2(BLOG_ROOT / "indexnow-key.txt", output_root / "indexnow-key.txt")
    write_text(output_root / ".nojekyll", "")
    build_machine_files(output_root, base_url, posts)


def build_machine_files(output_root: Path, base_url: str, posts: list[dict]) -> None:
    now = datetime.now(timezone.utc)
    sitemap_urls = [(f"{base_url}/", now.date().isoformat())]
    sitemap_urls.extend((post["url"], post["date_iso"]) for post in posts)
    sitemap = [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">',
    ]
    for url, last_modified in sitemap_urls:
        sitemap.extend(
            [
                "  <url>",
                f"    <loc>{html.escape(url)}</loc>",
                f"    <lastmod>{last_modified}</lastmod>",
                "  </url>",
            ]
        )
    sitemap.append("</urlset>")
    write_text(output_root / "sitemap.xml", "\n".join(sitemap) + "\n")

    robots = f"""User-agent: *
Allow: /

Sitemap: {base_url}/sitemap.xml
"""
    write_text(output_root / "robots.txt", robots)

    feed_items = []
    for post in posts:
        published = datetime.combine(post["published_on"], datetime.min.time(), timezone.utc)
        feed_items.append(
            "\n".join(
                [
                    "  <item>",
                    f"    <title>{html.escape(post['title_en'])}</title>",
                    f"    <link>{html.escape(post['url'])}</link>",
                    f"    <guid isPermaLink=\"true\">{html.escape(post['url'])}</guid>",
                    f"    <pubDate>{format_datetime(published)}</pubDate>",
                    f"    <description>{html.escape(post['description_en'])}</description>",
                    "  </item>",
                ]
            )
        )
    feed = f"""<?xml version="1.0" encoding="UTF-8"?>
<rss version="2.0">
<channel>
  <title>Flawless Field Notes</title>
  <link>{base_url}/</link>
  <description>Bilingual field notes on AgenticOps and AI SRE.</description>
  <language>zh-CN</language>
{chr(10).join(feed_items)}
</channel>
</rss>
"""
    write_text(output_root / "feed.xml", feed)

    llms_lines = [
        "# Flawless",
        "",
        "> An AI-native SRE control plane for Kubernetes and cloud infrastructure.",
        "> 面向 Kubernetes 与云基础设施的 AI 原生 SRE 控制平面。",
        "",
        "Flawless connects alerts, evidence, topology, human approval, controlled remediation, and recovery verification.",
        "The project is written in Shanghai by 陆宣宇 (Xuanyu Lu).",
        "",
        f"- Repository: {REPOSITORY_URL}",
        f"- Blog: {base_url}/",
        f"- RSS: {base_url}/feed.xml",
        f"- Sitemap: {base_url}/sitemap.xml",
        "",
        "## Articles",
        "",
    ]
    for post in posts:
        llms_lines.append(f"- [{post['title_en']}]({post['url']}): {post['description_en']}")
    write_text(output_root / "llms.txt", "\n".join(llms_lines) + "\n")

    index_data = {
        "project": "Flawless",
        "repository": REPOSITORY_URL,
        "author": {"name": AUTHOR, "name_en": AUTHOR_EN, "location": "Shanghai, China"},
        "articles": [
            {
                "title": post["title"],
                "title_en": post["title_en"],
                "description": post["description"],
                "description_en": post["description_en"],
                "date": post["date_iso"],
                "url": post["url"],
                "tags": post["tags"],
            }
            for post in posts
        ],
    }
    write_text(
        output_root / "content-index.json",
        json.dumps(index_data, ensure_ascii=False, indent=2) + "\n",
    )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--output", type=Path, default=ROOT / "public")
    parser.add_argument(
        "--base-url",
        default="https://william-lu-stack.github.io/Flawless",
    )
    args = parser.parse_args()
    build_site(args.output.resolve(), args.base_url.rstrip("/"))
    print(f"Built Flawless blog at {args.output.resolve()}")


if __name__ == "__main__":
    main()
