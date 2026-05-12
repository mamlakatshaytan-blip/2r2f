# Security Specification - 2R 2F Online

## Data Invariants
1. A Game must have at least Player X. Player O can be a User ID or 'BOT'.
2. Immortal Fields: `createdAt`, `playerX`, `playerO` (after join).
3. Status Flow: `waiting` -> `setting_secrets` -> `playing` -> `X_won`/`O_won`/`draw`.
4. Guesses are only allowed during `playing` status.
5. Only the player whose turn it is can submit a guess.
6. Player X is the coordinator for transition from `setting_secrets` to `playing`.
7. Secrets are private to each player.
8. User profiles are owned by the user.

## The "Dirty Dozen" Payloads (All must be PERMISSION_DENIED)
1. **Identity Spoofing**: Player X trying to create a game with `playerX` set to another user.
2. **State Shortcutting**: Joining a game and setting status directly to `playing` without setting secrets.
3. **ID Poisoning**: Creating/Joining a game with a 2MB string as `gameId`.
4. **Illegal Update**: Player A updating Player B's `guesses` array.
5. **Turn Stealing**: Player A submitting a guess when it's Player B's turn.
6. **Immortal Overwrite**: Changing `playerX` after the game is created.
7. **Ghost Field Injection**: Adding `isVerified: true` to a game document.
8. **Resource Exhaustion**: Sending a guess array with 10,000 elements.
9. **Private Breach**: User A trying to write to User B's `secrets` document.
10. **Terminal State Break**: Updating a game after it's in `X_won` status.
11. **PII Leak**: Non-admin reading all user emails (if they existed, but currently they are public names).
12. **Self-Promotion**: User trying to update their own `lastSeen` with a fake client time instead of server timestamp.

## The Test Runner
(Tests would be implemented in a test file, but here I focus on the rules logic to prevent these)
