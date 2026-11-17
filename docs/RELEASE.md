# Release Process

Apogee has no server and no separate staging deployment. A release candidate is the packaged extension installed by hand in a clean browser profile. Production is that same extension delivered through the GitHub Release and then the browser stores.

Versions, tags, and `CHANGELOG.md` belong to [Release Please](https://github.com/googleapis/release-please). Do not bump versions or push tags by hand.

## Pipeline at a glance

| Stage | Trigger | What happens | Result |
| --- | --- | --- | --- |
| Pull request | Every PR | Tests, build, package smoke test, security scans, consistency checks | Required checks on the PR |
| Release candidate | Manual: run **Staging** | Tests, package both browsers, lint the Firefox package, write checksums | `apogee-rc-X.Y.Z` workflow artifact |
| Release | `v*` tag pushed by Release Please | Package, sign with Cosign, upload assets and release notes | GitHub Release |
| Store publication | Manual | Upload the release assets to each store | User-facing update |

`main` is protected: changes land through pull requests, the required checks must pass on the latest commit, and force pushes and deletions are blocked.

## Versioning

Release Please reads conventional commit subjects on `main`:

| Commit type | Version effect |
| --- | --- |
| `fix:`, `perf:` | Patch (`0.2.5` → `0.2.6`) |
| `feat:` | Minor (`0.2.6` → `0.3.0`). While the project is pre-1.0, `release-please-config.json` maps this to a patch |
| `security:` | Patch, shown under Security |
| `docs:`, `chore:`, `test:`, `refactor:`, `ci:`, `build:`, `style:` | No release by themselves |

A release PR updates all version carriers at once: `package.json`, `apogee-extension/package.json`, `apogee-extension/manifest.json`, `.release-please-manifest.json`, the release badge, and the `docs/STORE-LISTING.md` version stamp. `npm run check:consistency` fails when they drift.

## 1. Land the change

Use the commit type that matches the change; the squash-merged PR title becomes the commit subject. Release Please groups `feat:` under Added, `fix:` under Fixed, and hides the housekeeping types.

## 2. Review the release PR

Release Please opens or updates a branch named `release-please--branches--main--components--apogee`. It contains the version bump, the changelog, and the regenerated version files.

Before merging:

- The proposed version matches the commits since the last tag.
- `CHANGELOG.md` lists every user-visible change and no hidden housekeeping entries.
- Required checks are green on the release PR.

Do not edit version files to pick a different number. Land the right commit type instead.

## 3. Build and test the release candidate

1. Open **Actions → Staging → Run workflow**.
2. In the **Use workflow from** dropdown, select the release PR branch from step 2, not `main`. The package must carry the version the release PR is about to tag.
3. Run the workflow. It installs from the lockfile, runs the full test suite, packages Chrome and Firefox, lints the Firefox package, and writes `SHA256SUMS.txt`.
4. Download the `apogee-rc-X.Y.Z` artifact from the run page. It contains:
   - `apogee-X.Y.Z-chrome.zip`
   - `apogee-X.Y.Z-mozilla.xpi`
   - `SHA256SUMS.txt`
5. Verify the download with `sha256sum -c SHA256SUMS.txt` (`shasum -a 256 -c SHA256SUMS.txt` on macOS).

The Staging workflow does not tag or publish. It uploads a workflow artifact that is kept for 14 days. Release Please owns the `v*` tag range, and a pre-release would interfere with the changelog range it computes.

### Install the candidate

Use a clean profile so old storage, permissions, and model caches cannot hide regressions.

- **Chrome / Edge**: unzip `apogee-X.Y.Z-chrome.zip`, open `chrome://extensions`, enable Developer mode, choose **Load unpacked**, and select the unzipped folder.
- **Firefox**: open `about:debugging#/runtime/this-firefox`, choose **Load Temporary Add-on**, and select `apogee-X.Y.Z-mozilla.xpi`.

For the upgrade check on Chromium:

1. Load the previous release into a folder with **Load unpacked**.
2. Use the extension so it writes settings, history, and a cached summary.
3. Replace the folder contents with the release candidate, then press **Reload** on `chrome://extensions`.
4. Confirm the state survived.

### Release candidate checklist

Packaging:

- [ ] `sha256sum -c SHA256SUMS.txt` passes.
- [ ] `manifest.json` version matches the release PR.
- [ ] Chrome package loads with no manifest warnings.
- [ ] Firefox temporary add-on loads and the sidebar opens.

Core flows:

- [ ] Article page summarizes to completion.
- [ ] PDF URL extraction works.
- [ ] DOCX extraction works.
- [ ] YouTube transcript path works.
- [ ] One site-specific extractor still picks its site.

Execution backends:

- [ ] WebGPU runs when the browser exposes it.
- [ ] WebAssembly fallback runs when WebGPU is unavailable.
- [ ] Ollama connects and summarizes.
- [ ] `llama-server` connects and summarizes.
- [ ] A configured remote provider sends nothing before explicit consent.

Privacy and upgrade:

- [ ] The Network panel shows only allow-listed hosts for local generation.
- [ ] Sensitive-site exclusions still skip disk caching.
- [ ] Upgrade keeps settings, history, and cached summaries.
- [ ] A fresh install starts with remote generation off.

If a check fails, fix it on `main` before the release PR merges. Do not merge the release PR just to get a build; the release PR only changes versions.

## 4. Publish the release

Squash-merge the release PR once every required check is green. Release Please then creates the `vX.Y.Z` tag and the GitHub Release, and the tag push starts the **Release** workflow.

The workflow:

1. Installs from the lockfile and packages both browsers.
2. Signs each artifact with Cosign and writes a `.sigstore.json` bundle next to it.
3. Writes `SHA256SUMS.txt`.
4. Uploads the zips, bundles, and checksums to the GitHub Release.
5. Replaces the release notes with contributor-aware notes.

Staging and Release both package the same tree, but the packaging step is not a byte-for-byte reproducible build, so do not compare hashes between the two. Test behavior in the candidate; verify the release asset against its own `SHA256SUMS.txt` and signature. The store upload is the release asset.

Do not create tags by hand. Do not move a published tag: the Cosign certificate binds the signature to the workflow and the tag ref.

## 5. Verify the release

The release page should list:

- `apogee-X.Y.Z-chrome.zip`
- `apogee-X.Y.Z-mozilla.xpi`
- `apogee-X.Y.Z-chrome.zip.sigstore.json`
- `apogee-X.Y.Z-mozilla.xpi.sigstore.json`
- `SHA256SUMS.txt`

Verify a download and its signature (replace `X.Y.Z`):

```bash
cosign verify-blob \
  --bundle apogee-X.Y.Z-chrome.zip.sigstore.json \
  --certificate-identity "https://github.com/darshi1337/apogee/.github/workflows/release.yml@refs/tags/vX.Y.Z" \
  --certificate-oidc-issuer https://token.actions.githubusercontent.com \
  apogee-X.Y.Z-chrome.zip

sha256sum -c SHA256SUMS.txt
```

## Store publication

Store uploads are manual on purpose. The Chrome Web Store OAuth client and the AMO submission flow are not part of CI, so a broken credential cannot turn a good tag red.

Upload the files downloaded from the GitHub Release, never a local rebuild. The stores receive the exact bytes that were signed and published.

### Chrome Web Store

1. Open the [Chrome Web Store Developer Dashboard](https://chrome.google.com/webstore/devconsole).
2. Select Apogee → **Package** → **Upload new package**, and choose `apogee-X.Y.Z-chrome.zip`.
3. Paste the user-facing changes from `CHANGELOG.md` into the "What's new" field.
4. Submit for review. If you use a staged rollout, start small and increase it after a few days.

If a version is already in review, cancel that review before uploading a new package.

### Firefox Add-ons

1. Open the [Firefox Add-ons Developer Hub](https://addons.mozilla.org/developers/).
2. Select Apogee → **Upload a New Version**, and choose `apogee-X.Y.Z-mozilla.xpi`.
3. Use the same release notes and submit for review.
4. If the validator asks for source, attach an archive of the tagged commit; the build is reproducible from `npm ci && npm run package`.

A pending submission must be cancelled in the dashboard before a new version can be uploaded.

### Microsoft Edge Add-ons (optional)

Edge uses the Chromium package. Upload `apogee-X.Y.Z-chrome.zip` with the Edge listing copy from [`docs/STORE-LISTING.md`](STORE-LISTING.md); it links Microsoft's publishing and listing guides.

## Rollback

Stores do not support downgrades, so a rollback is a forward fix, not a rewind.

1. **Fix forward (default).** Revert or fix the problem on `main` with a `fix:` commit, merge the new release PR, and publish the next patch. Required checks still apply; there is no bypass even when a release is urgent.
2. **Stop distribution.** If the published build is unsafe, remove or disable the version in the store dashboard while the fix ships:
   - Chrome Web Store: unpublish the item.
   - Firefox Add-ons: disable the version in the Developer Hub.
   - Edge Add-ons: unpublish the listing in Partner Center.

   Existing installs are not recalled by either store.

3. **Repair user data.** If a bad migration changed stored data, a downgrade does not restore it. Ship a migration that detects and repairs the broken state, and say what changed in the release notes.

You can edit or delete the GitHub Release, but that does not remove copies that were already downloaded. Never reuse a tag name for different code.

## Release recovery

### The Release workflow failed

- **Transient failure** (network, runner shutdown): open the failed run and choose **Re-run failed jobs**. The tag and the signing identity do not change, and the upload step overwrites assets with `--clobber`.
- **Workflow bug**: do not move the tag to retry; it pins the workflow that failed. Land the fix on `main` and publish the next patch. If the failed release has no assets, say so in its notes so nobody waits for a download.

### Release Please failed

Re-run the **Release Please** workflow from the Actions tab. If it keeps failing, check the `SYNC_TOKEN` secret: it needs a fine-grained token with Contents and Pull requests write access, and it must be allowed to create pull requests.

Do not hand-edit versions or create a tag to work around a broken Release Please. A hand-made tag bypasses the changelog range and leaves `.release-please-manifest.json` out of sync.

## Guardrails

- `main` requires a pull request and these checks: CodeQL, `build-and-test`, `Build + package smoke`, Dependency Review, Gitleaks, Consistency, actionlint, and zizmor.
- Required checks must pass on the latest commit, so the release PR has to be up to date with `main`.
- The project has one maintainer, so `required_approving_review_count` is 0. Raise it to 1 when a second maintainer joins.
- The `release` environment is attached to the tag workflow. Store credentials are not used by CI anymore.
