# Real-Time Card Game Architecture

This game structure centers on "Hidden Information" and "Targeted Interaction," making it perfect for a social tabletop-style experience on mobile.

## Game Mechanics Summary

    Lobby System: Players join a secure, private room using a unique code.

    The Deck: Each player starts with three cards whose values are known only to them. These are stored on the server but filtered out of the public data stream.

    The Action: A player chooses one of their hidden cards and targets another player in the lobby.

    The Reveal: Once triggered, that card becomes publicly visible. The server updates the lobby state to show the card value and a visual link (the "tag") between the sender and the recipient.

    Public Board: All participants can see a real-time leaderboard showing how many cards each player has revealed and a history of who has been tagged by whom.

## PWA + FCM Implementation Plan

1. Backend: The Engine (FastAPI + Redis)

   - Lobby State: Use Redis to store the game state as a JSON object. Use Redis Pub/Sub to broadcast changes to all WebSocket clients in a specific room.
   - Data Filtering: Implement a "View Filter" in your FastAPI WebSocket handler.
     - When broadcasting the state, the server strips out the value of any card where status == "hidden", unless the recipient's ID matches the owner_id.
   - Notification Trigger: When a play_card action is processed, the backend looks up the target player's FCM Token (stored in Redis/DB) and sends a POST request to the Firebase Admin SDK to fire the push notification.

2. Frontend: The PWA (React/Vue/Svelte)

   - Web Manifest: Create a manifest.json so users on iOS and Android can "Install" the app. This is the only way to enable push notifications on iOS.
   - Service Worker: Write a sw.js file to handle background tasks. It will listen for the push event from FCM and display the browser's native notification UI.
   - Token Registration: When a user joins a lobby, the frontend requests notification permission. If granted, it retrieves an FCM device token and sends it to your FastAPI backend to be linked to their session.

3. Real-Time Sync (WebSockets)

    - Connection: On app mount, the client opens a WSS (Secure WebSocket) connection to the FastAPI server.
    - Synchronization: The backend sends the full filtered state upon connection. Every subsequent action (joining, submitting, tagging) triggers a partial or full state update to all lobby members instantly.

4. Deployment & Security

    - Authentication: Generate a short-lived JWT for each player when they join a lobby. The WebSocket handshake should require this token to prevent unauthorized access to the room's data.
    - Infrastructure: Containerize the FastAPI and Redis services using Docker. This allows for easy deployment to cloud providers (like AWS or GCP) where you can manage HTTPS/WSS certificates via a Load Balancer or Reverse Proxy (like Nginx).
