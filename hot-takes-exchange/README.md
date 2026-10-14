# Hot Takes Exchange

HR said we need team bonding. Hot Takes Exchange is a real-time multiplayer team-lunch game where players predict which side will win a room vote using fictional credits. It uses Node.js, Express and Socket.IO.

## Requirements
- Node.js 18+ (20+ recommended)
- Everyone's phones and the host laptop on the same Wi-Fi, OR deploy the app to a public Node host.

## Run locally
```bash
npm install
npm start
```
On the host laptop, open `http://localhost:3000/?host=1` and enter host PIN `2004`.
For players on the same Wi-Fi, the host opens the app's join QR; phones scan it and open the LAN URL. If the generated URL doesn't work on the network, find the laptop's local IPv4 address and open `http://LAPTOP-IP:3000` from phones.

To enable the host-only chili bot, set `OPENAI_API_KEY` in the server environment. The assistant uses the Responses API and defaults to `gpt-5-mini`; set `OPENAI_MODEL` to use another supported model. The API key stays on the server.

To change the host PIN:
- macOS/Linux: `HOST_PIN=your-pin npm start`
- PowerShell: `$env:HOST_PIN="your-pin"; npm start`

For internet play, deploy the app to a Node.js host and set `PUBLIC_URL` to the public HTTPS URL and `HOST_PIN` to a unique PIN.

## How to play
1. Players join with a nickname and optionally upload a face photo. The image is resized in the browser before upload and appears on the leaderboard and champion reveal.
2. Host opens `/?host=1`, unlocks controls, and starts a round.
3. The market runs for 2 minutes (or until the host closes it). Each player privately invests 100 to 500 credits in AGREE or DISAGREE. The public sees only pooled amounts and calculated odds, never individual picks or stakes.
4. Debate runs for 3 minutes. Players can send a reaction every 2 seconds and optionally vote once for which side argued better.
5. Final voting runs for 1 minute; players privately vote on the take. Each phase advances automatically when its timer ends, or the host can advance early.
6. Final voting closes automatically after 60 seconds. Results and balances are revealed.
7. Between rounds, players can spend 150 fictional credits to submit an anonymous hot take. The host sees the text but not the submitter's identity, and can approve or reject it. Approved takes can be edited, reordered, skipped, and queued from the host dashboard.
8. At the end, the host clicks **Crown the market champion** to display a full-screen winner reveal with the winner's uploaded photo, crown and trophy graphics.

## Scoring and odds
- The winner is the side with the most final votes.
- Investment credits are deducted when a prediction is locked.
- Odds are based on the total credits pooled on each side. The multiplier is `1 + (opposing pool / selected-side pool × 0.5)`, with a 1.05x floor and 3x cap. If no credits are yet pooled on a side, its displayed multiplier starts at 3x once the other side has money in the market.
- A correct prediction returns `stake × multiplier` (rounded to a whole credit); this includes the original stake. A wrong prediction loses the stake. A tied vote returns the original stake.
- A hot-take submission costs 150 credits, whether or not it is approved. Rejected takes are not queued for play.
- All credits are fictional. No real-money stakes, purchases or cash-out are supported.

## Notes / limitations
- This is an MVP, not production-hardened. It stores game state in memory, so restarting the server resets the game.
- There is one in-memory room per server process; keep the Render service at one instance so all players and the host share the same room. Restarting or redeploying resets the room.
- Player sessions can reconnect to the same running server from the same browser. A server restart still clears the room and active sessions.
- A debate-vote feature records which side made the better argument, but that vote does not currently affect balances.
- Uploaded profile images are kept in the server's in-memory game state and shared with participants in the room. Use a photo players are comfortable displaying to the group.
- For a public deployment, configure a unique host PIN, use HTTPS, and consider stronger host authentication and persistent storage.
