from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from http.cookiejar import CookieJar
from urllib.error import HTTPError
from urllib.parse import urljoin
from urllib.request import HTTPCookieProcessor, ProxyHandler, Request, build_opener


@dataclass
class SmokeResponse:
    status_code: int
    text: str

    def json(self) -> dict[str, object]:
        return json.loads(self.text)


class SmokeClient:
    def __init__(self, base_url: str, token: str, timeout: float = 10.0) -> None:
        self.base_url = base_url.rstrip("/")
        self.token = token
        self.timeout = timeout
        self.opener = build_opener(HTTPCookieProcessor(CookieJar()), ProxyHandler({}))

    def get(self, path: str, *, auth: bool = False) -> SmokeResponse:
        return self.request("GET", path, auth=auth)

    def post(self, path: str, *, body: dict[str, object] | None = None, auth: bool = False) -> SmokeResponse:
        return self.request("POST", path, body=body, auth=auth)

    def put(self, path: str, *, body: dict[str, object], auth: bool = False) -> SmokeResponse:
        return self.request("PUT", path, body=body, auth=auth)

    def delete(self, path: str, *, auth: bool = False) -> SmokeResponse:
        return self.request("DELETE", path, auth=auth)

    def request(
        self,
        method: str,
        path: str,
        *,
        body: dict[str, object] | None = None,
        auth: bool = False,
    ) -> SmokeResponse:
        data = None
        headers: dict[str, str] = {"User-Agent": "DocferrySmoke/0.0.6"}
        if body is not None:
            data = json.dumps(body).encode("utf-8")
            headers["Content-Type"] = "application/json"
        if auth:
            headers["Authorization"] = f"Bearer {self.token}"
        request = Request(
            urljoin(f"{self.base_url}/", path.lstrip("/")),
            data=data,
            headers=headers,
            method=method,
        )
        try:
            response = self.opener.open(request, timeout=self.timeout)
            return SmokeResponse(response.status, response.read().decode("utf-8"))
        except HTTPError as exc:
            return SmokeResponse(exc.code, exc.read().decode("utf-8"))


def payload(
    title: str,
    markdown: str,
    *,
    source_path: str = "Smoke/hello.md",
    source_hash: str = "sha256:smoke",
    **overrides: object,
) -> dict[str, object]:
    data: dict[str, object] = {
        "source_path": source_path,
        "source_hash": source_hash,
        "title": title,
        "markdown": markdown,
        "html_snapshot": None,
        "css_asset_id": None,
        "assets": [],
        "expires_at": None,
        "client": {
            "plugin_id": "docferry",
            "plugin_version": "0.0.6",
            "obsidian_version": "smoke-test",
        },
    }
    data.update(overrides)
    return data


def assert_status(response: SmokeResponse, expected: int, label: str) -> None:
    if response.status_code != expected:
        raise AssertionError(f"{label}: expected {expected}, got {response.status_code}: {response.text[:500]}")


def assert_error_code(response: SmokeResponse, expected_status: int, expected_code: str, label: str) -> None:
    assert_status(response, expected_status, label)
    code = response.json().get("error", {}).get("code")  # type: ignore[union-attr]
    if code != expected_code:
        raise AssertionError(f"{label}: expected error code {expected_code}, got {code}: {response.text[:500]}")


def run_quota_smoke(client: SmokeClient) -> None:
    quota_shares: list[dict[str, object]] = []
    for index in range(5):
        created = client.post(
            "/v0/shares",
            body=payload(
                f"Smoke quota {index}",
                f"# Smoke quota {index}\n\nQuota lifecycle check.",
                source_path=f"Smoke/quota-{index}.md",
                source_hash=f"sha256:smoke-quota-{index}",
            ),
            auth=True,
        )
        assert_status(created, 200, f"quota create {index + 1}")
        quota_shares.append(created.json())

    blocked = client.post(
        "/v0/shares",
        body=payload(
            "Smoke quota blocked",
            "# Smoke quota blocked\n\nThis should exceed the active-share quota.",
            source_path="Smoke/quota-blocked.md",
            source_hash="sha256:smoke-quota-blocked",
        ),
        auth=True,
    )
    assert_error_code(blocked, 403, "share_quota_exceeded", "quota create 6")

    first = quota_shares.pop(0)
    deleted = client.delete(f"/v0/shares/{first['share_id']}", auth=True)
    assert_status(deleted, 200, "quota stop first share")

    replacement = client.post(
        "/v0/shares",
        body=payload(
            "Smoke quota replacement",
            "# Smoke quota replacement\n\nStop should release active-share quota.",
            source_path="Smoke/quota-replacement.md",
            source_hash="sha256:smoke-quota-replacement",
        ),
        auth=True,
    )
    assert_status(replacement, 200, "quota replacement")
    quota_shares.append(replacement.json())

    for share in quota_shares:
        cleanup = client.delete(f"/v0/shares/{share['share_id']}", auth=True)
        assert_status(cleanup, 200, f"quota cleanup {share['share_id']}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Run a live Docferry API smoke test.")
    parser.add_argument("--base-url", default="http://127.0.0.1:8787")
    parser.add_argument("--token", default="dev-token")
    parser.add_argument("--skip-quota", action="store_true", help="Skip the 5-share quota lifecycle check.")
    args = parser.parse_args()

    client = SmokeClient(args.base_url.rstrip("/"), args.token)
    health = client.get("/v0/health")
    assert_status(health, 200, "health")

    account = client.get("/v0/account", auth=True)
    assert_status(account, 200, "account")
    account_text = json.dumps(account.json()).lower()
    if "token_hash" in account_text or args.token.lower() in account_text:
        raise AssertionError("account response exposed token material")

    created = client.post(
        "/v0/shares",
        body=payload("Smoke note", "# Smoke note\n\nLocal POC is alive.", password="secret"),
        auth=True,
    )
    assert_status(created, 200, "create share")
    share = created.json()
    share_id = str(share["share_id"])
    slug = str(share["slug"])
    if share["status"] != "password_protected":
        raise AssertionError("created share did not report password_protected status")

    status = client.get(f"/v0/shares/{share_id}", auth=True)
    assert_status(status, 200, "share status")
    if status.json()["source_path"] != "Smoke/hello.md":
        raise AssertionError("share status did not return the expected single source path")

    locked = client.get(f"/s/{slug}")
    assert_status(locked, 401, "locked viewer")

    bad_password = client.post(f"/s/{slug}/password", body={"password": "wrong"})
    assert_status(bad_password, 401, "wrong password")

    good_password = client.post(f"/s/{slug}/password", body={"password": "secret"})
    assert_status(good_password, 200, "correct password")

    opened = client.get(f"/s/{slug}")
    assert_status(opened, 200, "opened viewer")
    if "Local POC is alive." not in opened.text:
        raise AssertionError("opened viewer did not include markdown content")

    updated = client.put(
        f"/v0/shares/{share_id}",
        body=payload("Smoke note updated", "# Smoke note updated\n\nUpdate path works.", password_mode="clear"),
        auth=True,
    )
    assert_status(updated, 200, "update share")
    if updated.json()["slug"] != slug:
        raise AssertionError("update changed slug")
    if updated.json()["status"] != "published":
        raise AssertionError("updated share did not clear password status")

    updated_view = client.get(f"/s/{slug}")
    assert_status(updated_view, 200, "updated viewer")
    if "Update path works." not in updated_view.text:
        raise AssertionError("updated viewer did not include new markdown content")

    events = client.get(f"/v0/shares/{share_id}/events?limit=10", auth=True)
    assert_status(events, 200, "share events")
    event_types = [event["event_type"] for event in events.json()["events"]]  # type: ignore[index]
    if "password_failed" not in event_types or "view" not in event_types:
        raise AssertionError("share events did not include expected access events")

    imported = client.get(f"/s/{slug}/import")
    assert_status(imported, 200, "import payload")
    if imported.json()["markdown"] != "# Smoke note updated\n\nUpdate path works.":
        raise AssertionError("import payload did not include canonical markdown")

    deleted = client.delete(f"/v0/shares/{share_id}", auth=True)
    assert_status(deleted, 200, "delete share")

    stopped_status = client.get(f"/v0/shares/{share_id}", auth=True)
    assert_status(stopped_status, 200, "stopped status")
    if stopped_status.json()["status"] != "stopped":
        raise AssertionError("stopped share did not report stopped status")

    stopped = client.get(f"/s/{slug}")
    assert_status(stopped, 410, "stopped viewer")

    if not args.skip_quota:
        run_quota_smoke(client)

    print("Smoke test passed.")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(main())
    except Exception as exc:
        print(f"Smoke test failed: {exc}", file=sys.stderr)
        raise SystemExit(1)
