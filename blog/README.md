# Flawless Field Notes

This directory is the canonical source for the Flawless blog.

## Publishing model

- GitHub Pages hosts the canonical edition at `https://jdgiles26.github.io/Flawless-main/`.
- Every post includes a canonical URL, Open Graph metadata, and `BlogPosting` structured data.
- The build produces `feed.xml`, `sitemap.xml`, `robots.txt`, `llms.txt`, and `content-index.json`.
- IndexNow is notified after a successful Pages deployment.
- DEV Community syndication uses the official Forem API and preserves the canonical URL.
- Platforms without a stable official publishing API are intentionally left as manual distribution channels.

Search engines and AI services decide independently whether and when to crawl or cite public content. These outputs improve discoverability but cannot guarantee indexing.

## Add an article

Create a Markdown file in `blog/posts/` with YAML front matter. Posts are English-only. Set `published: true` when the canonical edition is ready to go live.

Build locally:

```bash
python -m pip install -r blog/requirements.txt
python scripts/build_blog.py --output public
python -m http.server 18081 --directory public
```

## Enable DEV syndication

Create a DEV Community API key and add it to the GitHub repository as the Actions secret `DEVTO_API_KEY`. Do not commit the key or paste it into an issue.

The publisher is idempotent: it updates an existing article with the same canonical URL instead of creating a duplicate.

Run a local no-secret check:

```bash
python scripts/publish_blog.py --allow-missing-token
```
