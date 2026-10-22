# BLKROSE Live Trivia Site

A real-time, room-based multiplayer version of the Shaun of the Dead trivia game. It uses Express + Socket.IO and generates a QR code for each host room.

## Features
- Host creates a room and shows a join QR code.
- Players scan the QR code or enter the room code, then enter a display name.
- Host controls question progression; questions time out automatically.
- Correct-answer names and answer explanations appear after each reveal.
- Live and final leaderboard.
- Correct answer = 1,000 points plus up to 500 speed bonus points. The faster a correct answer is submitted, the higher the bonus.
- Includes the existing easy, medium, and hard 10-question banks.

## Run locally
Requires Node.js 18 or newer.

```bash
npm install
npm start
```

Open http://localhost:3000. To test on phones on the same Wi-Fi, use the computer's LAN IP address instead of `localhost` and allow the port through the computer firewall.

## Publish online (recommended)
This project is not public until deployed to a hosting provider. One simple route is Render:
1. Create a GitHub repository and upload the contents of this folder.
2. In Render, create a new **Web Service** connected to that repository.
3. Build command: `npm install`
4. Start command: `npm start`
5. Deploy. Render will give you a public HTTPS URL.
6. Open that URL, choose **Create host room**, and the site will display a QR code that points to your public URL.

Keep the host screen open for the whole game. This starter stores active rooms in server memory, so restarting/redeploying the server ends active rooms. For a single trivia event, this is usually fine.

## Important notes
- Use only music and images you have permission to use.
- Room codes are short and intended for a casual event, not for private or sensitive sessions.
- For a larger or recurring service, add persistent storage, room expiry, reconnection handling, and rate limiting.
