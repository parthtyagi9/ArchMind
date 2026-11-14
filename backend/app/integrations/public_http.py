"""Bounded anonymous HTTPS requests to user-supplied public sources.

Resolve and validate every redirect, then connect to a validated IP while retaining
the original hostname for TLS verification. No cookies, credentials or proxy env.
"""
from __future__ import annotations

import http.client
import ipaddress
import socket
import ssl
from urllib.parse import urljoin, urlsplit

import httpx

from app.integrations.atlassian import AtlassianError

MAX_RESPONSE = 2_000_000


def public_url(url: str) -> str:
    try:
        p = urlsplit(url)
        if (p.scheme != "https" or not p.hostname or p.username or p.password
                or p.port not in (None, 443) or "\\" in url or any(ord(c) < 32 for c in url)):
            raise ValueError
        host = p.hostname.encode("idna").decode("ascii").lower()
        if host == "localhost" or host.endswith((".localhost", ".local", ".internal")):
            raise ValueError
        try:
            addr = ipaddress.ip_address(host)
        except ValueError:
            addr = None
        if addr and not addr.is_global:
            raise ValueError
    except (ValueError, UnicodeError):
        raise AtlassianError("Use a public HTTPS Jira or Confluence link (no credentials or custom ports).", 422)
    authority = f"[{host}]" if ":" in host else host
    return p._replace(netloc=authority, fragment="").geturl()


def public_addresses(host: str) -> list[str]:
    try:
        addresses = list(dict.fromkeys(r[4][0] for r in socket.getaddrinfo(host, 443, type=socket.SOCK_STREAM)))
    except OSError as e:
        raise AtlassianError("Could not resolve the source hostname.", 502) from e
    if not addresses or any(not ipaddress.ip_address(a).is_global for a in addresses):
        raise AtlassianError("Source links must resolve only to public internet addresses.", 422)
    return addresses


class PublicTransport(httpx.BaseTransport):
    def handle_request(self, request: httpx.Request) -> httpx.Response:
        url = public_url(str(request.url))
        host = urlsplit(url).hostname
        addresses = public_addresses(host)
        tls = ssl.create_default_context()
        conn = http.client.HTTPSConnection(host, timeout=12, context=tls)
        try:
            # Pin the connection to a validated address; HTTPSConnection still uses
            # `host` as SNI and verifies its certificate, avoiding DNS rebinding.
            conn.sock = tls.wrap_socket(socket.create_connection((addresses[0], 443), timeout=12), server_hostname=host)
            conn.request("GET", request.url.raw_path.decode("ascii"), headers={
                "User-Agent": "ArchMind/1.0", "Accept": "application/json, text/html;q=0.8", "Accept-Encoding": "identity",
            })
            response = conn.getresponse()
            if response.getheader("Content-Encoding", "identity").lower() not in ("", "identity"):
                raise AtlassianError("The source did not honor the bounded, uncompressed download request.", 502)
            data = response.read(MAX_RESPONSE + 1)
            if len(data) > MAX_RESPONSE:
                raise AtlassianError("The public source response is too large.", 502)
            return httpx.Response(response.status, headers=list(response.getheaders()), content=data)
        except (OSError, http.client.HTTPException) as e:
            raise AtlassianError("Could not reach the public source. Check the link and try again.", 502) from e
        finally:
            conn.close()


def get_public(url: str, *, transport: httpx.BaseTransport | None = None) -> httpx.Response:
    with httpx.Client(transport=transport or PublicTransport(), follow_redirects=False, trust_env=False) as client:
        for _ in range(4):
            url = public_url(url)
            client.cookies.clear()
            response = client.get(url)
            if response.status_code not in (301, 302, 303, 307, 308):
                return response
            location = response.headers.get("location")
            if not location:
                break
            url = urljoin(url, location)
    raise AtlassianError("The source redirected too many times.", 502)
