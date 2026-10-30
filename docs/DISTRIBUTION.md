# Where ZebraApp is published (for maintainers)

Pushing a tag such as `v1.0.1` does everything. Downloads (`.exe`, `.dmg`, `.AppImage`, `.deb`, `SHA256SUMS.txt`) are built and published by `release.yml`. The package channels below need a one-time setup each; until then their jobs skip themselves or stay switched off.

| Channel | Workflow | One-time setup | Users run |
|---|---|---|---|
| GitHub release | `release.yml` | none | download from the Releases page |
| PyPI | `pypi.yml` | pypi.org account, *pending publisher*, repository variable `PUBLISH_PYPI=true` | `pipx install "zebraapp[all]"` |
| apt (Debian, Ubuntu, Raspberry Pi OS) | `distribute.yml` | GPG key as secret `APT_GPG_PRIVATE_KEY`, GitHub Pages from branch `gh-pages` | see `docs/apt-index.html` |
| Homebrew (macOS) | `distribute.yml` | repository `homebrew-zebraapp`, secret `TAP_TOKEN` | `brew install --cask TroubledKezoo1/zebraapp/zebraapp` |
| npm | `distribute.yml` | npmjs.com account, secret `NPM_TOKEN` | `npx zebraapp` |

## PyPI
1. Create an account on pypi.org and turn on two-factor authentication.
2. *Your projects > Publishing > Add a new pending publisher*: project `zebraapp`, owner `TroubledKezoo1`, repository `ZebraDesignApp`, workflow `pypi.yml`, environment `pypi`.
3. GitHub: *Settings > Secrets and variables > Actions > Variables*: add `PUBLISH_PYPI` = `true`.
No token is stored anywhere (trusted publishing).

## apt
1. Make a signing key without passphrase: `gpg --batch --quick-generate-key "ZebraApp apt <TroubledKezoo1@users.noreply.github.com>" rsa3072 sign never --passphrase ''`
2. Export it: `gpg --armor --export-secret-keys "ZebraApp apt" ` and store the output as the secret `APT_GPG_PRIVATE_KEY`.
3. After the first run create *Settings > Pages > Deploy from a branch > gh-pages / (root)*.
4. Test on a clean Ubuntu: `sudo apt install zebraapp` after adding the repository (commands on the Pages site).

## Homebrew
1. Create an empty public repository `homebrew-zebraapp` under the same account.
2. Create a fine-grained token with *Contents: read and write* for that repository only; store it as the secret `TAP_TOKEN`.
The app is not signed with an Apple certificate; the cask removes the quarantine flag after installing.

## npm
1. Create an npmjs.com account (two-factor on) and a granular access token that may publish `zebraapp`; store it as the secret `NPM_TOKEN`.
The npm package is only a launcher: on first run it downloads the app from the GitHub release and checks it against `SHA256SUMS.txt`.

## Checking by hand
`distribute.yml` can be started for an existing tag from the Actions tab (*Run workflow*, tag `v1.0.1`).


## Scoop and winget (Windows)

`packaging/make-scoop.py` and `packaging/make-winget.py` write the manifests for a release.

**Scoop.** Create an empty public repository `scoop-zebraapp` (same owner). The `scoop` job in `distribute.yml` then writes `bucket/zebraapp.json` after every release, using the same `TAP_TOKEN` secret as Homebrew (the token must also have access to this repository). Users run:

```
scoop bucket add zebraapp https://github.com/TroubledKezoo1/scoop-zebraapp
scoop install zebraapp
```

**winget.** The job also leaves the three manifest files as the `winget-manifests` build artifact. The first version has to be submitted by hand as a pull request to `microsoft/winget-pkgs` (for example `wingetcreate submit` or `komac`, with a token of your own); Microsoft's bot validates it and a moderator approves it, usually within a few days. Later versions: `wingetcreate update TroubledKezoo1.ZebraApp --version X --urls <x64 url> <arm64 url> --submit`. Users then run `winget install TroubledKezoo1.ZebraApp`.

Both are untested against real Scoop and winget (no Windows machine in the build environment): check the first install yourself.

## Release signing (desktop self-update)

The app installs an update only when `SHA256SUMS.txt` is signed with the project's Ed25519 key. The public key is `SIGNING_PUBKEY` in `zebraapp/updates.py`; the private key is the repository secret `RELEASE_SIGNING_KEY` (PEM text). The release workflow signs the checksums, writes `SHA256SUMS.txt.sig` (base64) and stops if the signature does not match the key built into the app.

Create a key once: `openssl genpkey -algorithm ED25519 -out release-signing.pem`, add it with `gh secret set RELEASE_SIGNING_KEY < release-signing.pem`, and put the public half (`openssl pkey -in release-signing.pem -pubout -outform DER | tail -c 32 | xxd -p`) into `SIGNING_PUBKEY`. Keep a backup of the PEM: with a new key, installed apps cannot self-update across the change (they fall back to the download link).
