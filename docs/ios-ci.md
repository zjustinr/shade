# Building and releasing the iOS app without a Mac

A GitHub Actions workflow (`.github/workflows/ios-release.yml`) builds the
Capacitor app on a macOS runner with Xcode 26, so you do not need a Mac that
can run Xcode 26. Since April 2026 the App Store only accepts builds made
with the iOS 26 SDK, which means Xcode 26 or later.

## What it does

| Run | Trigger | What happens | Needs |
|---|---|---|---|
| **Check** | Actions tab → "iOS build and TestFlight upload" → Run workflow, "upload" left off | Builds the web bundle, syncs it into the Xcode project, compiles the app for the iOS Simulator. Nothing is signed or uploaded. | Nothing. No Apple account. |
| **Release** | Push a tag like `ios-v1.0.1`, or Run workflow with "upload" ticked | The check, then archives the app, signs it, and uploads the build to TestFlight. | The four secrets below, an app record in App Store Connect, and a chosen bundle id. |

It never submits for App Review. After a release run, the build shows up in
App Store Connect → TestFlight after a few minutes of Apple processing; you
install it on a phone, try it, and press "Submit for Review" yourself.

## One-time setup for releases

1. **Enroll in the Apple Developer Program** ($99/yr) and wait for approval.
2. **Choose the bundle id on purpose.** It becomes the app's permanent
   identity at the first upload. Set the same value in two places that do not
   sync: `appId` in `capacitor.config.ts`, and `PRODUCT_BUNDLE_IDENTIFIER` in
   `ios/App/App.xcodeproj/project.pbxproj` (two occurrences, Debug and
   Release). The workflow fails if they disagree and refuses to upload while
   it is still the placeholder `org.chinatowncoolcorners.app`. (Claude Code
   can make this edit for you: tell it the bundle id.)
3. **Create the app record** in App Store Connect → My Apps → + → New App,
   using that bundle id. The workflow uploads builds to it; it cannot create
   it.
4. **Create an App Store Connect API key**: App Store Connect → Users and
   Access → Integrations → App Store Connect API → Team Keys → +.
   Give it the **Admin** role. Cloud-managed signing needs it, and a key with
   a narrower role may fail with a certificate or provisioning error. Download
   the `.p8` file **once**; Apple will not show it again. Note the Key ID and
   the Issuer ID shown on that page.
5. **Add four repository secrets** (GitHub repo → Settings → Secrets and
   variables → Actions → New repository secret):

   | Secret | Value |
   |---|---|
   | `APP_STORE_CONNECT_KEY_ID` | the Key ID |
   | `APP_STORE_CONNECT_ISSUER_ID` | the Issuer ID |
   | `APP_STORE_CONNECT_API_KEY` | the entire contents of the `.p8` file, including the `-----BEGIN PRIVATE KEY-----` lines |
   | `APPLE_TEAM_ID` | your 10-character Team ID (developer.apple.com → Membership details) |

   The key is written to a temporary file for the signing step and deleted
   afterwards, and GitHub masks secrets in logs. Treat it like a password:
   anyone who can push to this repository can run the workflow and so use it,
   so keep the repository's write access tight.

## Releasing

```bash
git tag ios-v1.0.1
git push origin ios-v1.0.1
```

(or ask Claude Code: "cut iOS release 1.0.1".) The tag's version becomes the
App Store version, and the build number is derived from the run number so it
only ever goes up, which App Store Connect requires. Watch it under the
Actions tab; the build log is kept as an artifact for two weeks.

Before you tag, regenerate anything that changed (`npm run build:shade`,
`build:network`, `build:exposure`, `build:wind`, `extract:destinations`) and
commit it; the workflow builds exactly what is in the repository.

## What is and is not proven

The check run was tested on a real `macos-26` runner while this was written.
The release half (archive, signing, upload) cannot be tested without Apple
credentials, so it has **not** been run. Expect to need a round or two of
fixes on the first real upload; the usual suspects are a key without the
Admin role, a Team ID typo, an app record that does not exist yet, or a bundle
id that is not available. The logs for each step are saved as the
`ios-build-logs` artifact; paste the failing part to Claude Code.

## Costs

GitHub's standard macOS runners are free for public repositories, as this one
is. If the repository is ever made private, macOS minutes are billed at a
higher rate than Linux and the free allowance is small.
