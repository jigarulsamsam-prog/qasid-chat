# Qasid Chat

A lightweight keypad-first chat app for KaiOS phones such as Jazz Digit 4G Bold.

## Run locally

From this folder:

```text
cmd /c npx --yes http-server . -p 4173
```

Open `http://127.0.0.1:4173` in a browser.

## Current MVP

- Inbox with sample conversations
- Contact picker
- Chat composer and local message persistence
- Keyboard navigation with Up/Down, Enter, and Backspace/Escape
- KaiOS `manifest.webapp`

## Next product phase

The current app is an offline UI prototype. Real chat needs a backend and authentication, for example:

1. User registration/login with phone number and OTP
2. Realtime messaging API and delivery status
3. Contact sync and message history
4. Network/offline states and retry queue
5. KaiOS device testing, signed package, icons, privacy policy, and store metadata

## Firebase setup

The app uses Firebase Email/Password Authentication and Realtime Database. Users create an account with a unique username, email, and password. Existing users can log in with their email or username. Messages are stored under a private `chats/{uidA_uidB}/messages` path and remain available in local storage when Firebase is unavailable. The contact list only shows users whose Firebase presence is currently `online: true`; users must log in with this version once to publish their presence.

After login, the app shows a 12-second welcome screen with `assets/welcome.png`, a blur transition, and a `Let's Go` button. To use your own music, place a short MP3 at `assets/welcome.mp3`; it will play for 12 seconds. If the MP3 is missing, the app uses a small generated fallback melody.

In the Firebase console, enable **Authentication > Sign-in method > Email/Password** and import `database.rules.json` into Realtime Database Rules. Do not use open database rules in production. Replace the placeholder developer URL in `manifest.webapp` before store submission.
