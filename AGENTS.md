# Shakar 2R2F - Project Rules

## Game Info
- Name: 2R 2F Online (Kurdish Bulls and Cows)
- Project Theme: Black & Orange (#F27D26)
- Fonts: IBM Plex Sans Arabic (Main Kurdish)

## Firebase Configuration (DO NOT CHANGE)
- Project ID: `shakar-3068d`
- Database: `(default)`
- Auth: Google & Anonymous (Guest)

## Technical Details
- Full-stack: Express + Vite
- Real-time: Firestore onSnapshot
- Security: Hardened ABAC rules in `firestore.rules`

## Deployment Checklist
1. Firebase Console: Enable Google Auth.
2. Firebase Console: Enable Anonymous Auth (Guest Mode).
3. Firebase Console: Add `https://ais-pre-kvijcye4dzv4q4i362gnqy-753072270005.europe-west2.run.app` to Authorized Domains.
4. Google Cloud Console: Ensure API Key is not restricted or allows Identity Toolkit API.
