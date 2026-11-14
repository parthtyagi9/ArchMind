import json

import httpx
import pytest

from app.integrations.atlassian import Atlassian, AtlassianError, adf_to_text, html_to_text


def client(handler, **kw):
    return Atlassian("https://x.atlassian.net", "me@x.io", "tok", transport=httpx.MockTransport(handler), **kw)


def test_adf_and_html_to_text():
    adf = {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Token audience"}, {"type": "text", "text": " missing"}]},
                                      {"type": "paragraph", "content": [{"type": "text", "text": "Fixed in PR 377"}]}]}
    assert adf_to_text(adf) == "Token audience missing\nFixed in PR 377\n"
    assert html_to_text("<h1>Title</h1><p>Every service <b>must</b> verify aud.</p>") == "Title\nEvery service must verify aud."


def test_jira_search_builds_jql_with_projects_and_keys_and_parses_issues():
    seen = {}

    def handler(req: httpx.Request):
        seen["auth"] = req.headers["authorization"]
        seen["path"] = req.url.path
        seen["body"] = json.loads(req.content)
        return httpx.Response(200, json={"issues": [{"key": "AUTH-311", "fields": {
            "summary": "Tokens accepted without audience check", "status": {"name": "Done"}, "issuetype": {"name": "Bug"},
            "description": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "A token for notify worked on payments."}]}]},
            "comment": {"comments": [{"author": {"displayName": "Ana"}, "body": {"type": "doc", "content": [{"type": "paragraph", "content": [{"type": "text", "text": "Fixed in PR 377"}]}]}}]},
            "updated": "2026-07-20"}}]})

    issues = client(handler, jira_projects=["AUTH"]).jira_search(["audience", 'qu"ote'], ["AUTH-311", "bad key"])
    assert seen["auth"].startswith("Basic ") and seen["path"] == "/rest/api/3/search/jql"
    jql = seen["body"]["jql"]
    assert jql.startswith("project in (AUTH) AND (") and 'text ~ "audience"' in jql and r'text ~ "qu\"ote"' in jql and "key in (AUTH-311)" in jql
    i = issues[0]
    assert i["key"] == "AUTH-311" and i["status"] == "Done" and "notify" in i["description"] and i["comments"][0]["author"] == "Ana"
    assert i["url"] == "https://x.atlassian.net/browse/AUTH-311"


def test_jira_search_falls_back_to_legacy_endpoint():
    calls = []

    def handler(req):
        calls.append(req.url.path)
        return httpx.Response(404 if req.url.path.endswith("/search/jql") else 200, json={"issues": []})

    assert client(handler).jira_search(["x"]) == []
    assert calls == ["/rest/api/3/search/jql", "/rest/api/3/search"]


def test_confluence_search_and_page_text():
    def handler(req):
        if req.url.path == "/wiki/rest/api/search":
            assert 'text ~ "audience"' in req.url.params["cql"] and 'space in ("ENG")' in req.url.params["cql"]
            return httpx.Response(200, json={"results": [{"title": "Authentication architecture", "excerpt": "every @@@hl@@@service@@@endhl@@@ must verify",
                                                          "content": {"id": "42", "_links": {"webui": "/spaces/ENG/pages/42"}}, "resultGlobalContainer": {"title": "Engineering"}}]})
        return httpx.Response(200, json={"body": {"storage": {"value": "<p>Every service must verify <code>aud</code>.</p>"}}})

    c = client(handler, confluence_spaces=["ENG"])
    pages = c.confluence_search(["audience"])
    assert pages[0]["id"] == "42" and pages[0]["url"] == "https://x.atlassian.net/wiki/spaces/ENG/pages/42" and pages[0]["space"] == "Engineering"
    assert "must verify aud" in c.confluence_page_text("42")


def test_validate_accepts_one_product_and_rejects_bad_credentials():
    ok_jira_only = lambda req: httpx.Response(200, json={}) if "/rest/api/3/myself" in req.url.path else httpx.Response(404, json={})
    assert client(ok_jira_only).validate() == {"jira": True, "confluence": False}
    with pytest.raises(AtlassianError) as e:
        client(lambda req: httpx.Response(401, json={})).validate()
    assert "rejected" in str(e.value)
