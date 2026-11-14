import json
import socket

import httpx
import pytest

from conftest import register
from app.integrations.atlassian import AtlassianError
from app.integrations import public_atlassian as public
from app.integrations import public_http
from app.services import integrations


@pytest.mark.parametrize("url,kind,base,scope,item", [
    ("https://issues.apache.org/jira/projects/KAFKA", "jira", "https://issues.apache.org/jira", "KAFKA", None),
    ("https://issues.apache.org/jira/browse/KAFKA-9119?foo=bar#comment", "jira", "https://issues.apache.org/jira", "KAFKA", "KAFKA-9119"),
    ("https://example.atlassian.net/browse/ENG-4", "jira", "https://example.atlassian.net", "ENG", "ENG-4"),
    ("https://example.atlassian.net/jira/software/c/projects/ENG/boards/1", "jira", "https://example.atlassian.net", "ENG", None),
    ("https://cwiki.apache.org/confluence/display/KAFKA", "confluence", "https://cwiki.apache.org/confluence", "KAFKA", None),
    ("https://cwiki.apache.org/confluence/display/KAFKA/Kafka+Improvement+Proposals", "confluence", "https://cwiki.apache.org/confluence", "KAFKA", "Kafka Improvement Proposals"),
    ("https://cwiki.apache.org/confluence/spaces/KAFKA/pages/42/Index", "confluence", "https://cwiki.apache.org/confluence", "KAFKA", "42"),
    ("https://example.atlassian.net/wiki/spaces/ENG/overview", "confluence", "https://example.atlassian.net/wiki", "ENG", None),
    ("https://cwiki.apache.org/confluence/pages/viewpage.action?pageId=42", "confluence", "https://cwiki.apache.org/confluence", None, "42"),
])
def test_detects_source_from_link(url, kind, base, scope, item):
    s = public.parse_source(url)
    assert (s["kind"], s["base_url"], s["project"] or s["space"], s["issue_key"] or s["page_id"] or s["page_title"]) == (kind, base, scope, item)


@pytest.mark.parametrize("url", [
    "http://issues.apache.org/jira/projects/KAFKA", "https://127.0.0.1/jira/projects/KAFKA",
    "https://[::1]/jira/projects/KAFKA", "https://169.254.169.254/projects/KAFKA",
    "https://localhost/projects/KAFKA", "https://host.internal/projects/KAFKA",
    "https://user:password@example.org/projects/KAFKA", "https://example.org:8000/projects/KAFKA",
    "https://example.org/random", "https://example.org/pages/viewpage.action?pageId=bad",
])
def test_rejects_unsafe_or_unrecognized_links_without_network(url):
    with pytest.raises(AtlassianError):
        public.parse_source(url)


def test_rejects_dns_answers_containing_internal_addresses(monkeypatch):
    monkeypatch.setattr(socket, "getaddrinfo", lambda *a, **k: [
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("93.184.216.34", 443)),
        (socket.AF_INET, socket.SOCK_STREAM, 6, "", ("10.0.0.1", 443)),
    ])
    with pytest.raises(AtlassianError, match="public internet"):
        public_http.public_addresses("example.org")


def test_redirect_to_internal_service_is_blocked_before_second_request():
    calls = []

    def handler(req):
        calls.append(str(req.url))
        assert "authorization" not in req.headers and "cookie" not in req.headers
        return httpx.Response(302, headers={"location": "https://127.0.0.1/private"})

    with pytest.raises(AtlassianError):
        public_http.get_public("https://example.org/projects/KAFKA", transport=httpx.MockTransport(handler))
    assert len(calls) == 1


def test_public_redirects_do_not_forward_cookies():
    def handler(req):
        assert "cookie" not in req.headers and "authorization" not in req.headers
        if req.url.path == "/start":
            return httpx.Response(302, headers={"location": "/finish", "set-cookie": "session=example; Path=/"})
        return httpx.Response(200, text="Public content")

    assert public_http.get_public("https://example.org/start", transport=httpx.MockTransport(handler)).text == "Public content"


@pytest.mark.parametrize("oversized", [False, True])
def test_transport_pins_validated_ip_preserves_tls_hostname_and_bounds_read(monkeypatch, oversized):
    seen = {}

    class TLS:
        def wrap_socket(self, sock, server_hostname):
            seen["tls_host"] = server_hostname
            return sock

    class Response:
        status = 200

        def getheader(self, name, default=None):
            return default

        def getheaders(self):
            return [("content-type", "text/plain")]

        def read(self, size):
            seen["read_limit"] = size
            return b"x" * size if oversized else b"public"

    class Connection:
        def __init__(self, host, **kw):
            seen["host"] = host

        def request(self, method, path, headers):
            seen["path"], seen["headers"] = path, headers

        def getresponse(self):
            return Response()

        def close(self):
            seen["closed"] = True

    monkeypatch.setattr(public_http, "public_addresses", lambda host: ["93.184.216.34"])
    monkeypatch.setattr(public_http.socket, "create_connection", lambda address, timeout: seen.setdefault("address", address))
    monkeypatch.setattr(public_http.ssl, "create_default_context", TLS)
    monkeypatch.setattr(public_http.http.client, "HTTPSConnection", Connection)
    request = httpx.Request("GET", "https://example.org/rest/api/2/search?maxResults=1")
    if oversized:
        with pytest.raises(AtlassianError, match="too large"):
            public_http.PublicTransport().handle_request(request)
    else:
        assert public_http.PublicTransport().handle_request(request).text == "public"
    assert seen["host"] == seen["tls_host"] == "example.org"
    assert seen["address"] == ("93.184.216.34", 443)
    assert seen["path"] == "/rest/api/2/search?maxResults=1"
    assert seen["read_limit"] == public_http.MAX_RESPONSE + 1 and seen["closed"]
    assert "Authorization" not in seen["headers"]


def test_confluence_short_link_resolves_before_detection(monkeypatch):
    final = "https://wiki.example.org/confluence/spaces/KAFKA/pages/42/Design"
    monkeypatch.setattr(public, "get_public", lambda url: httpx.Response(200, request=httpx.Request("GET", final)))
    assert public.resolve_source("https://wiki.example.org/confluence/x/AbCd")["page_id"] == "42"


def test_html_fallback_extracts_only_readable_page_content():
    html = '<title>Architecture</title><nav>Noise</nav><div id="main-content"><p>Keep the public metadata quorum compatible.</p><script>ignore this</script></div><footer>More noise</footer>'
    transport = httpx.MockTransport(lambda req: httpx.Response(404) if "/rest/" in req.url.path else httpx.Response(200, text=html))
    s = public.PublicAtlassian(public.parse_source("https://wiki.example.org/display/ENG/Architecture"), transport).probe()
    assert not s["search_available"] and s["title"] == "Architecture"
    c = public.PublicAtlassian(s, transport)
    text = c.confluence_page_text("ignored")
    assert "metadata quorum" in text and "Noise" not in text and "ignore this" not in text


def test_login_page_is_never_saved_as_public_content():
    transport = httpx.MockTransport(lambda req: httpx.Response(200, text="<title>Log in</title><form>Enter your password to continue</form>"))
    with pytest.raises(AtlassianError, match="No readable public content"):
        public.PublicAtlassian(public.parse_source("https://wiki.example.org/display/ENG/Architecture"), transport).probe()


def issue(key="KAFKA-9119"):
    return {"key": key, "fields": {"summary": "Replace ZooKeeper with a Metadata Quorum", "description": "Real public evidence", "status": {"name": "Done"}}}


def page(pid="42", space="KAFKA"):
    return {"id": pid, "title": "KIP-500", "space": {"key": space}, "body": {"storage": {"value": "<p>Metadata quorum design decision.</p>"}}, "_links": {"webui": f"/spaces/{space}/pages/{pid}"}}


def test_public_jira_anonymous_scoped_search_and_exact_issue():
    calls = []

    def handler(req):
        assert "authorization" not in req.headers
        calls.append(req)
        if "/project/" in req.url.path:
            return httpx.Response(200, json={"key": "KAFKA", "name": "Apache Kafka"})
        if "/issue/" in req.url.path:
            return httpx.Response(200, json=issue())
        assert 'project = "KAFKA"' in req.url.params["jql"]
        return httpx.Response(200, json={"issues": [issue(), issue("OTHER-1")]})

    transport = httpx.MockTransport(handler)
    s = public.PublicAtlassian(public.parse_source("https://issues.example.org/jira/projects/KAFKA"), transport).probe()
    result = public.PublicAtlassian(s, transport).jira_search(["quorum"], ["OTHER-1", "KAFKA-9119"])
    assert [i["key"] for i in result] == ["KAFKA-9119"]
    assert result[0]["url"] == "https://issues.example.org/jira/browse/KAFKA-9119"
    assert any(r.url.path.endswith("/issue/KAFKA-9119") for r in calls)
    assert not any(r.url.path.endswith("/issue/OTHER-1") for r in calls)


def test_public_confluence_resolves_title_and_fetches_exact_question_links():
    calls = []

    def handler(req):
        calls.append(req)
        assert "authorization" not in req.headers
        if req.url.path.endswith("/content"):
            assert req.url.params["spaceKey"] == "KAFKA" and req.url.params["title"] == "Index"
            return httpx.Response(200, json={"results": [page()]})
        if "/content/" in req.url.path:
            return httpx.Response(200, json=page(req.url.path.rsplit("/", 1)[-1]))
        assert 'space = "KAFKA"' in req.url.params["cql"]
        return httpx.Response(200, json={"results": []})

    transport = httpx.MockTransport(handler)
    s = public.PublicAtlassian(public.parse_source("https://wiki.example.org/confluence/display/KAFKA/Index"), transport).probe()
    assert s["page_id"] == "42"
    c = public.PublicAtlassian(s, transport)
    results = c.confluence_search(["quorum"], links=[
        "https://wiki.example.org/confluence/spaces/KAFKA/pages/99/Design",
        "https://wiki.example.org/confluence/spaces/OTHER/pages/100/Secret",
        "https://different.example.org/confluence/spaces/KAFKA/pages/101/Other",
    ])
    assert {p["id"] for p in results} == {"42", "99"}
    assert "design decision" in c.confluence_page_text("99")
    assert not any(r.url.path.endswith(("/100", "/101")) for r in calls)


def test_direct_page_id_still_checks_space_membership():
    source = public.parse_source("https://wiki.example.org/spaces/KAFKA")
    c = public.PublicAtlassian(source, httpx.MockTransport(lambda req: httpx.Response(200, json=page(space="OTHER"))))
    assert c.confluence_search([], links=["https://wiki.example.org/pages/viewpage.action?pageId=42"]) == []


def test_stale_ticket_reference_does_not_prevent_keyword_search():
    def handler(req):
        if "/issue/" in req.url.path:
            return httpx.Response(404)
        return httpx.Response(200, json={"issues": [issue()]})

    c = public.PublicAtlassian(public.parse_source("https://issues.example.org/jira/projects/KAFKA"), httpx.MockTransport(handler))
    assert c.jira_search(["quorum"], ["KAFKA-1"])[0]["key"] == "KAFKA-9119"


def fake_probe(monkeypatch):
    calls = []

    class Probe:
        def __init__(self, source):
            self.source = source

        def probe(self):
            calls.append(self.source)
            return {**self.source, "title": "Apache Kafka", "search_available": True, "access": "public"}

    monkeypatch.setattr(public, "get_public_atlassian", Probe)
    return calls


def test_source_connection_permissions_tenant_isolation_and_disconnect(client, make_client, monkeypatch, env):
    owner = register(client, "owner@x.io")
    calls = fake_probe(monkeypatch)
    invitation = client.post("/api/org/invites", json={"role": "member"}).json()
    member = make_client()
    register(member, "member@x.io", invite_code=invitation["code"])
    body = {"url": "https://issues.example.org/jira/projects/KAFKA"}
    assert member.post("/api/integrations/sources", json=body).status_code == 403
    assert calls == []
    r = client.post("/api/integrations/sources", json=body)
    assert r.status_code == 200, r.text
    source = r.json()
    assert source["access"] == "public" and source["repo_id"] is None
    # Reconnecting a canonical URL updates a connection instead of duplicating it.
    assert client.post("/api/integrations/sources", json=body).json()["id"] == source["id"]
    assert len(member.get("/api/integrations").json()["public_sources"]) == 1
    assert "token" not in json.dumps(source)
    foreign = make_client()
    register(foreign, "foreign@x.io")
    assert foreign.get("/api/integrations").json()["public_sources"] == []
    assert foreign.delete(f"/api/integrations/sources/{source['id']}").status_code == 404
    assert member.delete(f"/api/integrations/sources/{source['id']}").status_code == 403
    assert client.delete(f"/api/integrations/sources/{source['id']}").status_code == 200
    assert client.get("/api/integrations").json()["public_sources"] == []
    assert env["db"].audit_events.count_documents({"type": "integration.public_connected", "tenant_id": owner["org"]["id"]}) == 2


def test_source_cannot_attach_to_foreign_repo_and_run_selection_is_scoped(client, make_client, monkeypatch, env):
    owner = register(client, "owner@x.io")
    other = make_client()
    foreign = register(other, "foreign@x.io")
    db = env["db"]
    db.repos.insert_one({"_id": "repo_local", "org_id": owner["org"]["id"]})
    db.repos.insert_one({"_id": "repo_foreign", "org_id": foreign["org"]["id"]})
    calls = fake_probe(monkeypatch)
    body = {"url": "https://issues.example.org/jira/projects/KAFKA", "repo_id": "repo_foreign"}
    assert client.post("/api/integrations/sources", json=body).status_code == 404
    assert calls == []
    body["repo_id"] = "repo_local"
    assert client.post("/api/integrations/sources", json=body).status_code == 200
    assert client.post("/api/integrations/sources", json={"url": "https://wiki.example.org/spaces/KAFKA"}).status_code == 200
    org_id = owner["org"]["id"]
    assert len(integrations.public_sources(org_id, "repo_local", for_run=True)) == 2
    assert len(integrations.public_sources(org_id, "repo_other", for_run=True)) == 1
    assert len(integrations.public_sources(org_id, None, for_run=True)) == 1


def test_private_source_does_not_sign_out_archmind_session(client, monkeypatch):
    register(client, "owner@x.io")

    class Private:
        def probe(self):
            raise AtlassianError("This source requires sign-in", 401)

    monkeypatch.setattr(public, "get_public_atlassian", lambda s: Private())
    assert client.post("/api/integrations/sources", json={"url": "https://private.example.org/projects/ENG"}).status_code == 409
    assert client.get("/api/integrations").json()["public_sources"] == []
    assert client.get("/api/auth/me").status_code == 200
