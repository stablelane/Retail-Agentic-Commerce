#!/usr/bin/env python3
"""Scrape the Visit Dubai events calendar once and write the committed catalogue.

Akamai blocks plain HTTP clients and the listing is client-rendered, so the first
step uses Playwright (system Chromium) only to discover the Algolia query the page
fires. Pagination is then replayed against that endpoint. Detail pages are visited
at most once per second for the "From AED" price. Nothing calls the website at
runtime.

Dev-only. Not installed in Docker images.
"""

from __future__ import annotations

import argparse
import asyncio
import json
import re
import time
from datetime import UTC, datetime, timedelta
from pathlib import Path
from urllib.parse import urlparse
from zoneinfo import ZoneInfo

import httpx

ROOT = Path(__file__).resolve().parents[1]
JSON_PATH = ROOT / "src" / "data" / "visitdubai_2026q4.json"
CATALOG_PATH = ROOT / "src" / "data" / "product_catalog.py"
STOREFRONT_PUBLIC = ROOT / "src" / "storefront" / "public"
UI_PUBLIC = ROOT / "src" / "ui" / "public"
DUBAI = ZoneInfo("Asia/Dubai")
CALENDAR_URL = (
    "https://www.visitdubai.com/en/festivals-and-events/dubai-events-calendar"
)
CHROMIUM = "/usr/bin/chromium"
MAX_SESSIONS = 8
# ponytail: mock capacity, replace with vendor inventory when a booking API exists
SEATS = {
    "sports": 500,
    "live-entertainment": 120,
    "family": 200,
    "attractions": 300,
    "tours": 20,
}
CATEGORY_MAP = {
    "sports": ("sports", "sports"),
    "live shows & concerts": ("live-entertainment", "concert"),
    "comedy shows": ("live-entertainment", "comedy"),
    "theatre": ("live-entertainment", "theatre"),
    "family": ("family", "family"),
    "attractions": ("attractions", "attraction"),
    "theme parks": ("attractions", "theme-park"),
    "tours": ("tours", "tour"),
    "festivals": ("live-entertainment", "festival"),
}
PRICE_RE = re.compile(r"from\s+AED\s*([\d,]+)", re.I)
SLUG_RE = re.compile(r"[^a-z0-9]+")


def _slug(value: str) -> str:
    return SLUG_RE.sub("-", value.lower()).strip("-")[:48]


def _map_category(
    raw: list[str] | str | None, tags: list[str] | str | None = None
) -> tuple[str, str]:
    label = raw[0] if isinstance(raw, list) and raw else str(raw or "")
    tag_labels = [str(tag).lower() for tag in tags] if isinstance(tags, list) else []
    if any(tag in {"family", "kids"} for tag in tag_labels):
        return "family", "family"
    return CATEGORY_MAP.get(label.lower(), ("live-entertainment", _slug(label) or "show"))


def _dates(hit: dict, start: datetime, end: datetime) -> list[str]:
    span = hit.get("eventDatesRange") or {}
    raw_from = span.get("from_formatted")
    raw_to = span.get("to_formatted") or raw_from
    if not raw_from:
        return []
    first = datetime.fromisoformat(raw_from).replace(tzinfo=DUBAI)
    last = datetime.fromisoformat(raw_to).replace(tzinfo=DUBAI)
    window_start = max(first, start)
    window_end = min(last, end)
    if window_end < window_start:
        return []
    days = (window_end.date() - window_start.date()).days
    if days <= MAX_SESSIONS - 1:
        chosen = [window_start + timedelta(days=i) for i in range(days + 1)]
    else:
        step = days / (MAX_SESSIONS - 1)
        chosen = [
            window_start + timedelta(days=round(i * step)) for i in range(MAX_SESSIONS)
        ]
    seen: set[str] = set()
    out: list[str] = []
    for day in chosen:
        # Show time is not on the listing; evening is the default performance slot.
        local = day.replace(hour=19, minute=0, second=0, microsecond=0)
        stamp = local.isoformat()
        if stamp not in seen:
            seen.add(stamp)
            out.append(stamp)
    return out


def _discover_algolia() -> tuple[str, dict[str, str]]:
    """Replay the calendar's Algolia query captured from the listing XHR.

    The index, app id and search-only key are public values the page sends.
    Detail pages still go through Playwright because Akamai blocks plain HTTP.
    """
    return (
        "https://v3cv7a7cmc-dsn.algolia.net/1/indexes/prod104_vd_en/query",
        {
            "x-algolia-api-key": "35a59b61c1577464818fdb267015c3d2",
            "x-algolia-application-id": "V3CV7A7CMC",
        },
    )


def _span_bucket(hit: dict, start: datetime, end: datetime) -> str | None:
    """Bucket by how far into Q4 the event reaches (not by its first day)."""
    dates = _dates(hit, start, end)
    if not dates:
        return None
    months = {day[:7] for day in dates}
    if "2026-12" in months:
        return "reaches-dec"
    if "2026-11" in months:
        return "reaches-nov"
    return "oct-only"


def _stratify_hits(
    hits: list[dict], start: datetime, end: datetime, limit: int
) -> list[dict]:
    """Prefer events that reach Nov/Dec, then round-robin with October."""
    buckets: dict[str, list[dict]] = {
        "reaches-dec": [],
        "reaches-nov": [],
        "oct-only": [],
    }
    for hit in hits:
        key = _span_bucket(hit, start, end)
        if key is not None:
            buckets[key].append(hit)
    print(
        "span buckets "
        f"dec={len(buckets['reaches-dec'])} "
        f"nov={len(buckets['reaches-nov'])} "
        f"oct={len(buckets['oct-only'])}",
        flush=True,
    )
    ordered: list[dict] = []
    order = ("reaches-dec", "reaches-nov", "oct-only")
    while any(buckets.values()) and len(ordered) < max(limit * 3, 120):
        for key in order:
            if buckets[key]:
                ordered.append(buckets[key].pop(0))
    return ordered


def _load_price_cache() -> dict[str, dict]:
    """Reuse priced detail pages from a previous scrape of the same JSON path."""
    if not JSON_PATH.exists():
        return {}
    try:
        events = json.loads(JSON_PATH.read_text())
    except json.JSONDecodeError:
        return {}
    cache: dict[str, dict] = {}
    for event in events:
        source = event.get("source_url")
        price = event.get("price_aed_from")
        if source and isinstance(price, int) and price > 0:
            cache[source] = event
    return cache


def _fetch_hits(
    url: str, headers: dict[str, str], start: datetime, end: datetime, limit: int
) -> list[dict]:
    start_ts = int(start.astimezone(UTC).timestamp())
    end_ts = int(end.astimezone(UTC).timestamp())
    hits: list[dict] = []
    page = 0
    with httpx.Client(timeout=30) as client:
        while True:
            body = {
                "query": "",
                "facetFilters": [["type:Event"], ["tags:Leisure events"], ["free:false"]],
                "numericFilters": [
                    f"eventDatesRange.to>={start_ts}",
                    f"eventDatesRange.from<={end_ts}",
                ],
                "hitsPerPage": 40,
                "page": page,
                "attributesToRetrieve": [
                    "title",
                    "englishTitle",
                    "url",
                    "urlSlug",
                    "category",
                    "tags",
                    "address",
                    "image",
                    "introText",
                    "free",
                    "eventDatesRange",
                    "listingvendorswebsite",
                ],
            }
            response = client.post(url, headers=headers, json=body)
            response.raise_for_status()
            payload = response.json()
            batch = payload.get("hits") or []
            if not batch:
                break
            hits.extend(batch)
            page += 1
            if page >= int(payload.get("nbPages") or 0):
                break
            time.sleep(0.2)
    print(
        f"algolia pages={page} raw_hits={len(hits)}",
        flush=True,
    )
    return _stratify_hits(hits, start, end, limit)


async def _detail(page, url: str) -> tuple[int | None, str]:
    await page.goto(url, wait_until="domcontentloaded", timeout=20000)
    await page.wait_for_timeout(800)
    text = await page.inner_text("body")
    match = PRICE_RE.search(text)
    price = int(match.group(1).replace(",", "")) if match else None
    description = ""
    blocks = await page.eval_on_selector_all(
        'script[type="application/ld+json"]',
        "els => els.map(e => e.textContent || '')",
    )
    for block in blocks:
        if '"@type": "Event"' in block or '"@type":"Event"' in block:
            try:
                data = json.loads(block)
            except json.JSONDecodeError:
                continue
            description = str(data.get("description") or "").strip()
            offers = data.get("offers") or {}
            if isinstance(offers, dict) and offers.get("price") and price is None:
                price = int(float(offers["price"]))
    return price, description[:2000]


async def _download(page, image_path: str, dest: Path) -> bool:
    if not image_path:
        return False
    url = image_path if image_path.startswith("http") else f"https://www.visitdubai.com{image_path}"
    try:
        response = await page.request.get(url)
    except Exception:
        return False
    if response.status != 200:
        return False
    body = await response.body()
    if not body:
        return False
    dest.write_bytes(body)
    return True


def write_catalog(events: list[dict]) -> None:
    """Regenerate PRODUCTS in product_catalog.py from the committed JSON."""
    lines = [
        "# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.",
        "# SPDX-License-Identifier: Apache-2.0",
        '"""Dubai events catalogue generated from src/data/visitdubai_2026q4.json.',
        "",
        "Do not edit by hand. Re-run scripts/scrape_visitdubai.py.",
        '"""',
        "",
        "from typing import NotRequired, TypedDict",
        "",
        "",
        "class SessionData(TypedDict):",
        '    id: str',
        '    starts_at: str',
        '    seats: int',
        "",
        "",
        "class ProductData(TypedDict):",
        '    id: str',
        '    sku: str',
        '    name: str',
        '    price_cents: int',
        '    stock_count: int',
        '    min_margin: float',
        '    image_url: str',
        '    category: str',
        '    subcategory: str',
        '    description: str',
        '    attributes: list[str]',
        '    lifecycle: str',
        '    demand_velocity: str',
        "    compare_at_price_cents: NotRequired[int | None]",
        '    venue: str',
        '    source_url: str',
        "    sessions: list[SessionData]",
        "",
        "",
        "PRODUCTS: list[ProductData] = [",
    ]
    for event in events:
        lines.append("    {")
        for key in (
            "id",
            "sku",
            "name",
            "price_cents",
            "stock_count",
            "min_margin",
            "image_url",
            "category",
            "subcategory",
            "description",
            "lifecycle",
            "demand_velocity",
            "venue",
            "source_url",
        ):
            lines.append(f"        {key!r}: {event[key]!r},")
        lines.append(f"        'attributes': {event['attributes']!r},")
        lines.append("        'sessions': [")
        for session in event["sessions"]:
            lines.append(
                "            {"
                f"'id': {session['id']!r}, "
                f"'starts_at': {session['starts_at']!r}, "
                f"'seats': {session['seats']!r}"
                "},"
            )
        lines.append("        ],")
        lines.append("    },")
    lines.append("]")
    lines.append("")
    CATALOG_PATH.write_text("\n".join(lines) + "\n")


def _to_catalog(raw: list[dict]) -> list[dict]:
    products = []
    for event in raw:
        category = event["category"]
        seats = SEATS.get(category, 120)
        sessions = []
        for starts_at in event["dates"]:
            day = starts_at[:10]
            clock = starts_at[11:16].replace(":", "")
            sessions.append(
                {
                    "id": f"{event['id']}_{day}T{starts_at[11:16]}",
                    "starts_at": starts_at,
                    "seats": seats,
                }
            )
            del clock
        if not sessions:
            continue
        products.append(
            {
                "id": event["id"],
                "sku": event["sku"],
                "name": event["name"],
                "price_cents": event["price_aed_from"] * 100,
                "stock_count": seats * len(sessions),
                "min_margin": 0.10,
                "image_url": f"/{event['id']}.jpg",
                "category": category,
                "subcategory": event["subcategory"],
                "description": event["description"][:2000],
                "attributes": event["attributes"],
                "lifecycle": "mature",
                "demand_velocity": "flat",
                "venue": event["venue"],
                "source_url": event["source_url"],
                "sessions": sessions,
            }
        )
    return products


async def scrape(start: datetime, end: datetime, limit: int) -> None:
    url, headers = _discover_algolia()
    hits = _fetch_hits(url, headers, start, end, limit)
    print(f"listing hits: {len(hits)}", flush=True)
    price_cache = _load_price_cache()
    print(f"price cache: {len(price_cache)}", flush=True)
    from playwright.async_api import async_playwright

    kept: list[dict] = []
    skipped = 0
    STOREFRONT_PUBLIC.mkdir(parents=True, exist_ok=True)
    UI_PUBLIC.mkdir(parents=True, exist_ok=True)
    async with async_playwright() as playwright:
        browser = await playwright.chromium.launch(
            executable_path=CHROMIUM, headless=True, args=["--no-sandbox"]
        )
        page = await browser.new_page()
        for hit in hits:
            if len(kept) >= limit:
                break
            source = hit.get("url") or ""
            if not source:
                skipped += 1
                continue
            dates = _dates(hit, start, end)
            if not dates:
                print(f"skip no-date {hit.get('urlSlug')}", flush=True)
                skipped += 1
                continue
            title = hit.get("englishTitle") or (
                hit["title"][0] if isinstance(hit.get("title"), list) else hit.get("title")
            )
            cached = price_cache.get(source)
            if cached:
                price = int(cached["price_aed_from"])
                description = str(cached.get("description") or "")
            else:
                await asyncio.sleep(1)
                try:
                    price, description = await _detail(page, source)
                except Exception as exc:
                    print(f"skip detail-error {source}: {exc}", flush=True)
                    skipped += 1
                    continue
            if not price or price <= 0:
                print(f"skip no-price {title}", flush=True)
                skipped += 1
                continue
            slug = _slug(str(hit.get("urlSlug") or title))
            taken = {event["id"] for event in kept}
            base = slug
            suffix = 2
            while f"evt_{slug}" in taken:
                slug = f"{base}-{suffix}"
                suffix += 1
            sku = "EVT-" + slug.upper().replace("-", "")[:16]
            taken_skus = {event["sku"] for event in kept}
            sku_n = 2
            while sku in taken_skus:
                tail = str(sku_n)
                sku = ("EVT-" + slug.upper().replace("-", ""))[: 20 - len(tail)] + tail
                sku_n += 1
            category, subcategory = _map_category(hit.get("category"), hit.get("tags"))
            image_name = f"evt_{slug}.jpg"
            image_dest = STOREFRONT_PUBLIC / image_name
            if image_dest.exists() and image_dest.stat().st_size > 0:
                image_ok = True
            else:
                image_ok = await _download(
                    page, str(hit.get("image") or ""), image_dest
                )
            if image_ok:
                (UI_PUBLIC / image_name).write_bytes(image_dest.read_bytes())
            venue = str(hit.get("address") or "Dubai")
            domain = urlparse(str(hit.get("listingvendorswebsite") or "")).netloc
            kept.append(
                {
                    "slug": slug,
                    "id": f"evt_{slug}",
                    "sku": sku,
                    "name": str(title).strip(),
                    "category": category,
                    "subcategory": subcategory,
                    "description": (description or str(hit.get("introText") or title))[:2000],
                    "venue": venue,
                    "image_url": f"https://www.visitdubai.com{hit.get('image')}"
                    if hit.get("image")
                    else "",
                    "source_url": source,
                    "price_aed_from": price,
                    "booking_domain": domain,
                    "dates": [{"starts_at": stamp} for stamp in dates],
                    "attributes": [category, subcategory, venue.lower()],
                }
            )
            print(
                f"kept {title} AED {price} sessions={len(dates)} "
                f"through={dates[-1][:10]} image={image_ok}",
                flush=True,
            )
        await browser.close()
    if kept and (STOREFRONT_PUBLIC / f"{kept[0]['id']}.jpg").exists():
        hero = STOREFRONT_PUBLIC / "hero.jpg"
        hero.write_bytes((STOREFRONT_PUBLIC / f"{kept[0]['id']}.jpg").read_bytes())
    # JSON stores the scrape shape (dates as objects). Catalogue is derived.
    JSON_PATH.write_text(json.dumps(kept, indent=2) + "\n")
    catalog_events = []
    for event in kept:
        catalog_events.append(
            {
                **{k: event[k] for k in event if k != "dates"},
                "dates": [item["starts_at"] for item in event["dates"]],
            }
        )
    write_catalog(_to_catalog(catalog_events))
    months = sorted(
        {
            item["starts_at"][:7]
            for event in kept
            for item in event["dates"]
        }
    )
    print(f"wrote {len(kept)} events, skipped {skipped}, months={months}", flush=True)
    if len(kept) < 30:
        raise SystemExit(f"only {len(kept)} priced events; need at least 30")
    if "2026-12" not in months:
        raise SystemExit(
            f"catalogue months {months} do not reach December; raise --limit or check Algolia"
        )


def main() -> None:
    parser = argparse.ArgumentParser()
    parser.add_argument("--from", dest="start", default="2026-10-01")
    parser.add_argument("--to", dest="end", default="2026-12-31")
    parser.add_argument("--limit", type=int, default=90)
    args = parser.parse_args()
    start = datetime.fromisoformat(args.start).replace(tzinfo=DUBAI)
    end = datetime.fromisoformat(args.end).replace(hour=23, minute=59, tzinfo=DUBAI)
    asyncio.run(scrape(start, end, args.limit))


if __name__ == "__main__":
    main()
