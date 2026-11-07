# Seven Years Care — Android app

One app for customers and staff. It opens https://care.sevenyears.in/app:
customers log in with their mobile number, staff with their User ID.

- App ID on Google Play: `in.sevenyears.care` (never change it after the first upload)
- Version: `versionCode` / `versionName` in `app/build.gradle.kts` — raise `versionCode` by 1 for every new upload

## Open in Android Studio
File → Open → choose this `android` folder → wait for "Gradle sync" to finish (first time downloads a few hundred MB).

## Try it on a phone
Turn on Developer options + USB debugging on an Android phone, connect it, press the green ▶ Run button.

## Make the file for Google Play
Build → Generate Signed App Bundle / APK → Android App Bundle → Create new… key store.
Save the key store file and passwords somewhere safe (not in this folder) — every future update must be signed with it.
Choose "release". The file is created at `app/release/app-release.aab`; upload that in Play Console.

## What the app does
- Keeps people logged in; Back button goes back a page
- Camera or gallery for service request photos
- Downloads (warranty PDF) go to the phone's Downloads
- WhatsApp, phone and other websites open in their own apps
- "No internet connection" screen with Try again
