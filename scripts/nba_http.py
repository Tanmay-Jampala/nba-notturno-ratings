"""Tiny HTTP client for stats.nba.com / cdn.nba.com (stdlib only).

stats.nba.com sits behind Akamai and drops requests that don't look like a
browser XHR from www.nba.com, so we send the full header set, keep requests
paced, and retry with exponential backoff.
"""
from __future__ import annotations

import gzip
import json
import random
import time
import urllib.error
import urllib.parse
import urllib.request
import zlib

STATS_HEADERS = {
    "User-Agent": (
        "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 "
        "(KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36"
    ),
    "Referer": "https://www.nba.com/",
    "Origin": "https://www.nba.com",
    "Accept": "application/json, text/plain, */*",
    "Accept-Language": "en-US,en;q=0.9",
    "Accept-Encoding": "gzip, deflate",
    "Connection": "keep-alive",
    "Sec-Fetch-Site": "same-site",
    "Sec-Fetch-Mode": "cors",
    "Sec-Fetch-Dest": "empty",
    "x-nba-stats-origin": "stats",
    "x-nba-stats-token": "true",
}

PACE_SECONDS = 1.6
_last_call = 0.0


def _decode(resp) -> bytes:
    raw = resp.read()
    enc = (resp.headers.get("Content-Encoding") or "").lower()
    if enc == "gzip":
        return gzip.decompress(raw)
    if enc == "deflate":
        return zlib.decompress(raw)
    return raw


def get_json(url: str, *, timeout: float = 45, retries: int = 4, headers: dict | None = None):
    """GET a JSON document with pacing + exponential backoff. Raises on final failure."""
    global _last_call
    hdrs = headers or STATS_HEADERS
    err: Exception | None = None
    for attempt in range(retries):
        wait = PACE_SECONDS - (time.time() - _last_call)
        if wait > 0:
            time.sleep(wait)
        _last_call = time.time()
        try:
            req = urllib.request.Request(url, headers=hdrs)
            with urllib.request.urlopen(req, timeout=timeout) as resp:
                return json.loads(_decode(resp))
        except (urllib.error.URLError, TimeoutError, ConnectionError, json.JSONDecodeError, OSError) as e:
            err = e
            backoff = (2 ** attempt) * 3 + random.uniform(0, 2)
            print(f"  ! attempt {attempt + 1}/{retries} failed for {url[:90]}… ({e}); retry in {backoff:.0f}s")
            time.sleep(backoff)
    raise RuntimeError(f"giving up on {url}: {err}")


def stats_url(endpoint: str, **params) -> str:
    return f"https://stats.nba.com/stats/{endpoint}?" + urllib.parse.urlencode(params, quote_via=urllib.parse.quote)


def result_sets(doc: dict) -> dict[str, list[dict]]:
    """Normalise stats.nba.com payloads into {name: [row-dicts]}."""
    rs = doc.get("resultSets", doc.get("resultSet"))
    if isinstance(rs, dict):
        rs = [rs]
    out: dict[str, list[dict]] = {}
    for s in rs or []:
        headers = s["headers"]
        # some endpoints (leaguedashptdefend etc.) use flat headers; a few use grouped headers
        if headers and isinstance(headers[0], dict):
            headers = headers[-1]["columnNames"]
        out[s["name"]] = [dict(zip(headers, row)) for row in s["rowSet"]]
    return out
