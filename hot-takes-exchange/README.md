# Hot Takes Exchange

A real-time multiplayer team-lunch game. Players invest fictional credits in a prediction about which side will win a room vote. It uses Node.js, Express and Socket.IO.

## Requirements
- Node.js 18+ (20+ recommended)
- Everyone's phones and the host laptop on the same Wi-Fi, OR deploy the app to a public Node host.

## Run locally
```bash
npm install
npm start
```
On the host laptop, open `http://localhost:3000/?host=1` and enter host PIN `2468`.
For players on the same Wi-Fi, the host opens the app's join QR; phones scan it and open the LAN URL. If the generated URL doesn't work on the network, find the laptop's local IPv4 address and open `http://LAPTOP-IP:3000` from phones.

To change the host PIN:
- macOS/Linux: `HOST_PIN=your-pin npm start`
- PowerShell: `$env:HOST_PIN="your-pin"; npm start`

For internet play, deploy the app to a Node.js host and set `PUBLIC_URL` to the public HTTPS URL and `HOST_PIN` to a unique PIN.

## How to play
1. Players join with a nickname and optionally upload a face photo. The image is resized in the browser before upload and appears on the leaderboard and champion reveal.
2. Host opens `/?host=1`, unlocks controls, and starts a round.
3. Market is open for 30 seconds by default. Each player privately invests 100–500 credits in AGREE or DISAGREE. The public sees only pooled amounts and calculated odds, never individual picks or stakes.
4. Host closes the market and facilitates the debate.
5. Host opens final voting; players privately vote on the take itself.
6. Voting closes automatically after 20 seconds. Results and balances are revealed.
7. Between rounds, players can spend 150 fictional credits to submit an anonymous hot take. The host sees the text but not the submitter's identity, and can approve or reject it. Approved takes enter the queue and will be used when the host starts a round with the prompt box blank.
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
- There is one room per server process; this is intended for one team-lunch session.
- The app currently has no persistent player accounts or reconnect recovery. Players should keep their browser tab open during the game.
- A debate-vote feature records which side made the better argument, but that vote does not currently affect balances.
- Uploaded profile images are kept in the server's in-memory game state and shared with participants in the room. Use a photo players are comfortable displaying to the group.
- For a public deployment, configure a unique host PIN, use HTTPS, and consider stronger host authentication and persistent storage.
