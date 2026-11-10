#!/usr/bin/env python3
"""
setup-infra-secrets.py
======================
Uploads Azure ARM credentials (and optionally a Terraform Cloud token) as
GitHub Actions secrets to SymphonySensa/cloudhub-infra-as-code.

Requirements:
    pip install PyNaCl

Usage:
    export GITHUB_PAT=<your-pat-with-secrets:write-on-SymphonySensa>
    python3 scripts/setup-infra-secrets.py

Or inline:
    GITHUB_PAT=<token> python3 scripts/setup-infra-secrets.py

The script reads Azure credentials from the local .env file.
You can also override any value via environment variables.

Required GitHub PAT scopes:
    - Fine-grained: repo → "Secrets: Read and write" for SymphonySensa/cloudhub-infra-as-code
    - Classic PAT: repo scope (includes secrets)
"""

import base64
import json
import os
import sys
import urllib.request
import urllib.error

try:
    from nacl import encoding, public
except ImportError:
    print("ERROR: PyNaCl is required.  Run: pip install PyNaCl")
    sys.exit(1)

REPO = "SymphonySensa/cloudhub-infra-as-code"
API  = "https://api.github.com"


def load_env(path: str = ".env") -> dict[str, str]:
    """Load key=value pairs from a .env file."""
    result: dict[str, str] = {}
    if not os.path.isfile(path):
        return result
    with open(path) as fh:
        for line in fh:
            line = line.strip()
            if line and not line.startswith("#") and "=" in line:
                k, _, v = line.partition("=")
                result[k.strip()] = v.strip()
    return result


def github_request(method: str, path: str, token: str, body: dict | None = None):
    url = f"{API}{path}"
    data = json.dumps(body).encode() if body else None
    req  = urllib.request.Request(
        url, data=data, method=method,
        headers={
            "Authorization": f"Bearer {token}",
            "Accept":        "application/vnd.github+json",
            "Content-Type":  "application/json",
            "X-GitHub-Api-Version": "2022-11-28",
        }
    )
    with urllib.request.urlopen(req) as resp:
        return json.load(resp)


def get_repo_public_key(token: str) -> tuple[str, str]:
    """Returns (key_id, public_key_base64)."""
    data = github_request("GET", f"/repos/{REPO}/actions/secrets/public-key", token)
    return data["key_id"], data["key"]


def encrypt_secret(public_key_b64: str, secret_value: str) -> str:
    """Encrypt secret_value using the repo's public key (libsodium sealed box)."""
    pk_bytes  = base64.b64decode(public_key_b64)
    pk        = public.PublicKey(pk_bytes)
    sealed    = public.SealedBox(pk)
    encrypted = sealed.encrypt(secret_value.encode())
    return base64.b64encode(encrypted).decode()


def put_secret(token: str, key_id: str, public_key_b64: str, secret_name: str, secret_value: str) -> None:
    encrypted = encrypt_secret(public_key_b64, secret_value)
    try:
        github_request(
            "PUT",
            f"/repos/{REPO}/actions/secrets/{secret_name}",
            token,
            {"encrypted_value": encrypted, "key_id": key_id},
        )
        print(f"  ✅  {secret_name} — set")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode()
        print(f"  ❌  {secret_name} — HTTP {exc.code}: {body}")
        raise


def main() -> None:
    # ── Resolve GitHub PAT ─────────────────────────────────────────────────────
    pat = os.environ.get("GITHUB_PAT", "").strip()
    if not pat:
        print("ERROR: GITHUB_PAT environment variable is not set.")
        print()
        print("Generate a PAT at: https://github.com/settings/tokens")
        print("  • Fine-grained: select SymphonySensa/cloudhub-infra-as-code, grant 'Secrets: Read and write'")
        print("  • Classic: select 'repo' scope")
        print()
        print("Then run:")
        print("  GITHUB_PAT=<token> python3 scripts/setup-infra-secrets.py")
        sys.exit(1)

    # ── Load credentials from .env ─────────────────────────────────────────────
    env = load_env(".env")

    def resolve(env_key: str, fallback_key: str = "") -> str:
        """Return os.environ override, then .env value, then empty string."""
        return (
            os.environ.get(env_key)
            or env.get(env_key)
            or (os.environ.get(fallback_key) if fallback_key else "")
            or env.get(fallback_key, "")
        )

    secrets_to_set: dict[str, str] = {
        "ARM_CLIENT_ID":       resolve("ARM_CLIENT_ID",       "AZURE_CLIENT_ID"),
        "ARM_CLIENT_SECRET":   resolve("ARM_CLIENT_SECRET",   "AZURE_CLIENT_SECRET"),
        "ARM_TENANT_ID":       resolve("ARM_TENANT_ID",       "AZURE_TENANT_ID"),
        "ARM_SUBSCRIPTION_ID": resolve("ARM_SUBSCRIPTION_ID", "AZURE_SUBSCRIPTION_ID"),
    }

    # Optional: Terraform Cloud token
    tfc_token = resolve("TF_TOKEN_app_terraform_io")
    if tfc_token:
        secrets_to_set["TF_TOKEN_app_terraform_io"] = tfc_token
    else:
        print("ℹ️  TF_TOKEN_app_terraform_io not found in .env — skipping.")
        print("   Add it if your Terraform modules are sourced from app.terraform.io.")
        print()

    # Validate all required secrets are present
    missing = [k for k, v in secrets_to_set.items() if not v]
    if missing:
        print(f"ERROR: The following secrets have no value: {missing}")
        print("Set them as environment variables or add them to .env:")
        for m in missing:
            print(f"  export {m}=<value>")
        sys.exit(1)

    # ── Fetch repo public key ──────────────────────────────────────────────────
    print(f"Fetching public key for {REPO}...")
    try:
        key_id, pub_key = get_repo_public_key(pat)
        print(f"  key_id = {key_id}")
    except urllib.error.HTTPError as exc:
        body = exc.read().decode()
        print(f"ERROR: Cannot fetch public key — HTTP {exc.code}: {body}")
        print()
        print("Check that your GITHUB_PAT has 'Secrets: Read and write' permission")
        print(f"for the repository {REPO}.")
        sys.exit(1)

    # ── Upload secrets ─────────────────────────────────────────────────────────
    print(f"\nUploading {len(secrets_to_set)} secrets to {REPO}...")
    for name, value in secrets_to_set.items():
        put_secret(pat, key_id, pub_key, name, value)

    print(f"\n✅  All secrets uploaded to {REPO}")
    print()
    print("Next steps:")
    print("  1. Merge the PR: https://github.com/SymphonySensa/cloudhub-infra-as-code/pull/new/feat/cloudhub-portal-aks-plan-workflow")
    print("  2. The aks-plan.yaml workflow will be available after merge.")
    print("  3. Test by triggering a plan from the Backstage portal.")


if __name__ == "__main__":
    main()
