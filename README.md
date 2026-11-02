# p2p Burako - Play Burako online without a server

<img src="logo.webp" width="160" alt="">

<img width="2239" height="1586" alt="Screenshot_20261030_073747" src="https://github.com/user-attachments/assets/a85db78b-ea37-4b62-b1b6-3b9d89384cee" />

Two-player (or 2 vs 2 with bots) tile Burako, browser to browser (WebRTC via Trystero/Nostr, no server). The UI is in English, or Spanish if the browser language is Spanish.

Live: https://franciscocarloserra.github.io/burako/ — opening it creates a `#room:key` link; send the whole link to the other player.

The game is saved on each device (localStorage) and re-syncs on reconnect, so you can reload or redeploy without losing the hand. To ship a new version, bump the version in `index.html` (`VERSION` and the `?v=` imports), `bot.js` and `version.txt`; see `AGENTS.md`. Open clients show "update".

Limitation: both browsers hold the full game; the opponent's hand is only hidden on screen.
