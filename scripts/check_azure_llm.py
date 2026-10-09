#!/usr/bin/env python3
"""Check that the Azure OpenAI (Responses API) endpoint used by the storefront chat works.

Usage (from the repo root):
    python3 scripts/check_azure_llm.py            # reads ./.env
    python3 scripts/check_azure_llm.py --env path/to/.env

Reads AZURE_OPENAI_BASE_URL, AZURE_OPENAI_API_KEY and AZURE_OPENAI_MODEL (process
environment wins over the .env file). Runs three checks: a plain reply, a streamed
reply, and a function (tool) call. Exits 0 when all pass, 1 otherwise. The API key is
never printed.
"""

from __future__ import annotations

import argparse
import ipaddress
import json
import os
import socket
import sys
import time
import urllib.error
import urllib.request
from pathlib import Path
from urllib.parse import urlparse

TIMEOUT_SECONDS = 60


def load_env(path: Path) -> dict[str, str]:
    values: dict[str, str] = {}
    if not path.is_file():
        return values
    for line in path.read_text().splitlines():
        line = line.strip()
        if not line or line.startswith("#") or "=" not in line:
            continue
        key, _, value = line.partition("=")
        values[key.strip()] = value.strip().strip('"').strip("'")
    return values


def responses_url(base_url: str) -> str:
    base = base_url.rstrip("/")
    if base.endswith("/responses"):
        base = base[: -len("/responses")]
    return f"{base}/responses"


def auth_headers(base_url: str, api_key: str) -> dict[str, str]:
    host = urlparse(base_url).hostname or ""
    if host.endswith(".azure.com"):
        return {"api-key": api_key}
    return {"Authorization": f"Bearer {api_key}"}


def post(url: str, headers: dict[str, str], body: dict[str, object]):
    request = urllib.request.Request(
        url,
        data=json.dumps(body).encode(),
        headers={"Content-Type": "application/json", **headers},
        method="POST",
    )
    return urllib.request.urlopen(request, timeout=TIMEOUT_SECONDS)


def public_ip() -> str:
    try:
        with urllib.request.urlopen("https://api.ipify.org", timeout=5) as response:
            return response.read().decode().strip()
    except OSError:
        return "unknown"


def resolved_ip(base_url: str) -> str:
    try:
        return socket.gethostbyname(urlparse(base_url).hostname or "")
    except OSError:
        return "unresolved"


def is_private(ip: str) -> bool:
    try:
        return ipaddress.ip_address(ip).is_private
    except ValueError:
        return False


def explain_http_error(error: urllib.error.HTTPError, base_url: str) -> str:
    detail = error.read().decode(errors="replace")[:300]
    hint = ""
    if error.code == 401:
        hint = "Check AZURE_OPENAI_API_KEY."
    elif error.code == 403:
        ip = resolved_ip(base_url)
        hint = (
            f"The hostname resolved to public IP {ip}, so the request skipped the private "
            "endpoint. On the VPN, DNS must come from Azure DNS (168.63.129.16), e.g. "
            "`sudo resolvectl dns <vpn-interface> 168.63.129.16`. Off the VPN, allow this "
            f"machine's public IP ({public_ip()}) under Networking in the Azure portal."
            if not is_private(ip)
            else f"Resolved to private IP {ip} but still blocked; check the resource's network rules."
        )
    elif error.code == 404:
        hint = "Check AZURE_OPENAI_BASE_URL and that AZURE_OPENAI_MODEL matches a deployment name."
    elif error.code == 429:
        hint = "Rate limited or quota exhausted; retry later."
    return f"HTTP {error.code}: {detail}" + (f"\n    hint: {hint}" if hint else "")


def output_text(payload: dict[str, object]) -> str:
    parts: list[str] = []
    for item in payload.get("output", []) or []:
        if isinstance(item, dict) and item.get("type") == "message":
            for content in item.get("content", []) or []:
                if isinstance(content, dict) and isinstance(content.get("text"), str):
                    parts.append(content["text"])
    return "".join(parts)


def check_basic(url, headers, model) -> str:
    with post(
        url,
        headers,
        {
            "model": model,
            "input": "Reply with exactly: pong",
            "max_output_tokens": 300,
            "reasoning": {"effort": "low"},
            "store": False,
        },
    ) as response:
        payload = json.loads(response.read())
    text = output_text(payload).strip()
    if not text:
        raise RuntimeError(f"no text in response (status={payload.get('status')})")
    return f"model={payload.get('model')} reply={text[:60]!r}"


def check_stream(url, headers, model) -> str:
    deltas = 0
    completed = False
    with post(
        url,
        headers,
        {
            "model": model,
            "input": "Count from 1 to 5.",
            "max_output_tokens": 300,
            "reasoning": {"effort": "low"},
            "store": False,
            "stream": True,
        },
    ) as response:
        for raw in response:
            line = raw.decode(errors="replace").strip()
            if not line.startswith("data:"):
                continue
            data = line[5:].strip()
            if not data or data == "[DONE]":
                continue
            event = json.loads(data)
            if event.get("type") == "response.output_text.delta":
                deltas += 1
            elif event.get("type") == "response.completed":
                completed = True
            elif event.get("type") in ("response.failed", "error"):
                raise RuntimeError(f"stream failed: {json.dumps(event)[:300]}")
    if deltas == 0 or not completed:
        raise RuntimeError(
            f"incomplete stream (deltas={deltas}, completed={completed})"
        )
    return f"{deltas} text deltas, completed"


def check_tool_call(url, headers, model) -> str:
    with post(
        url,
        headers,
        {
            "model": model,
            "input": "What events are on in Dubai on 2026-10-17? Use the tool.",
            "tools": [
                {
                    "type": "function",
                    "name": "list_catalog",
                    "description": "List events, optionally filtered by date (YYYY-MM-DD).",
                    "parameters": {
                        "type": "object",
                        "properties": {
                            "date_from": {"type": "string"},
                            "date_to": {"type": "string"},
                        },
                    },
                    "strict": False,
                }
            ],
            "tool_choice": "auto",
            "max_output_tokens": 1000,
            "reasoning": {"effort": "low"},
            "store": False,
        },
    ) as response:
        payload = json.loads(response.read())
    calls = [
        item
        for item in payload.get("output", []) or []
        if isinstance(item, dict) and item.get("type") == "function_call"
    ]
    if not calls:
        raise RuntimeError("model did not call the tool")
    return f"{calls[0].get('name')}({calls[0].get('arguments')})"


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    parser.add_argument(
        "--env", default=".env", help="path to the .env file (default: ./.env)"
    )
    args = parser.parse_args()

    file_env = load_env(Path(args.env))

    def setting(name: str, default: str = "") -> str:
        return os.environ.get(name) or file_env.get(name) or default

    base_url = setting("AZURE_OPENAI_BASE_URL")
    api_key = setting("AZURE_OPENAI_API_KEY")
    model = setting("AZURE_OPENAI_MODEL", "gpt-5.3-codex")

    missing = [
        name
        for name, value in (
            ("AZURE_OPENAI_BASE_URL", base_url),
            ("AZURE_OPENAI_API_KEY", api_key),
        )
        if not value
    ]
    if missing:
        print(f"FAIL  missing {', '.join(missing)} (env or {args.env})")
        return 1

    url = responses_url(base_url)
    headers = auth_headers(base_url, api_key)
    print(f"Endpoint: {url}")
    ip = resolved_ip(base_url)
    print(f"Resolves: {ip} ({'private endpoint' if is_private(ip) else 'public'})")
    print(f"Model:    {model}")
    print(f"Key:      set ({len(api_key)} chars)\n")

    failures = 0
    for name, check in (
        ("basic reply", check_basic),
        ("streaming", check_stream),
        ("tool call", check_tool_call),
    ):
        started = time.monotonic()
        try:
            detail = check(url, headers, model)
            print(f"PASS  {name:<12} {time.monotonic() - started:5.1f}s  {detail}")
        except urllib.error.HTTPError as error:
            failures += 1
            print(f"FAIL  {name:<12} {explain_http_error(error, base_url)}")
            if error.code in (401, 403, 404):
                break
        except (urllib.error.URLError, TimeoutError, OSError) as error:
            failures += 1
            print(f"FAIL  {name:<12} network error: {error}")
            break
        except (RuntimeError, json.JSONDecodeError) as error:
            failures += 1
            print(f"FAIL  {name:<12} {error}")

    print(
        "\nAzure endpoint is working."
        if failures == 0
        else "\nAzure endpoint is NOT working."
    )
    return 0 if failures == 0 else 1


if __name__ == "__main__":
    sys.exit(main())
