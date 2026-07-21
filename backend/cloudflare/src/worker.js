// Communication First — signaling server (Cloudflare Workers + Durable Objects)
//
// Responsibility: introduce two browsers and relay their WebRTC setup messages.
// This server NEVER sees audio or video — media flows peer-to-peer.

import { DurableObject } from "cloudflare:workers";

const VERSION = 1;

const WS_OPEN = 1;

// RFC 6455 close codes
const WS_NORMAL_CLOSE = 1000;
const WS_MESSAGE_TOO_LARGE = 1009;
const WS_INTERNAL_ERROR = 1011;

const MAX_MESSAGE_BYTES = 64 * 1024;

const ROOM_ID_RE = /^[0-9a-f]{32}$/;
const PEER_ID_RE = /^[0-9a-f]{16,64}$/;

function roomIdFromPath(pathname) {
  const parts = pathname.split("/").filter(Boolean);
  return parts[0] === "room" && parts[1] ? parts[1] : null;
}

function isWebSocketUpgrade(request) {
  return (request.headers.get("Upgrade") || "").toLowerCase() === "websocket";
}

export default {
  async fetch(request, env) {
    const url = new URL(request.url);

    if (url.pathname === "/health") {
      return new Response(
        JSON.stringify({
          status: "ok",
          version: VERSION
        }),
        {
          headers: {
            "content-type": "application/json; charset=utf-8"
          }
        }
      );
    }

    const roomId = roomIdFromPath(url.pathname);

    if (roomId) {
      if (!ROOM_ID_RE.test(roomId)) {
        return new Response("Invalid room id", { status: 400 });
      }

      if (!isWebSocketUpgrade(request)) {
        return new Response("Expected websocket upgrade", { status: 426 });
      }

      const id = env.ROOMS.idFromName(roomId);
      return env.ROOMS.get(id).fetch(request);
    }

    return new Response("Communication First signaling", {
      headers: {
        "content-type": "text/plain; charset=utf-8"
      }
    });
  }
};

function attachmentOf(ws) {
  try {
    return ws.deserializeAttachment();
  } catch {
    return null;
  }
}

export class Room extends DurableObject {
  async fetch(request) {
    if (!isWebSocketUpgrade(request)) {
      return new Response("Expected websocket upgrade", { status: 426 });
    }

    const url = new URL(request.url);

    const peerId = url.searchParams.get("peer");

    if (!peerId || !PEER_ID_RE.test(peerId)) {
      return new Response("Invalid peer id", { status: 400 });
    }

    // Replace stale connection for reconnects
    for (const socket of this.ctx.getWebSockets()) {
      const attachment = attachmentOf(socket);

      if (attachment?.peerId === peerId) {
        try {
          socket.close(WS_NORMAL_CLOSE, "replaced");
        } catch {}
      }
    }

    // Allow only two distinct peers
    const peers = new Set();

    for (const socket of this.ctx.getWebSockets()) {
      const attachment = attachmentOf(socket);

      if (
        attachment?.peerId &&
        attachment.peerId !== peerId
      ) {
        peers.add(attachment.peerId);
      }
    }

    if (peers.size >= 2) {
      return new Response("Room full", { status: 409 });
    }

    const pair = new WebSocketPair();

    const client = pair[0];
    const server = pair[1];

    this.ctx.acceptWebSocket(server);

    server.serializeAttachment({
      peerId
    });
    console.log("[ROOM] connect", peerId);

    return new Response(null, {
      status: 101,
      webSocket: client
    });
  }

  webSocketMessage(ws, message) {
      const size =
          typeof message === "string"
              ? message.length
              : message.byteLength;

      if (typeof message === "string") {
          let data = null;

          try {
              data = JSON.parse(message);
          } catch {}

          if (data?.type === "ping") {
              console.log(
                  "[ROOM] ping",
                  attachmentOf(ws)?.peerId ?? "unknown"
              );

              try {
                  ws.send(JSON.stringify({
                      type: "pong"
                  }));
              } catch {}

              return;
          }
      }
      
      const from = attachmentOf(ws)?.peerId ?? "unknown";

      console.log(
          "[ROOM] message",
          from,
          typeof message === "string"
              ? message.slice(0, 80)
              : "<binary>"
      );

    if (size > MAX_MESSAGE_BYTES) {
      try {
        ws.close(
          WS_MESSAGE_TOO_LARGE,
          "message too large"
        );
      } catch {}

      return;
    }

    for (const other of this.ctx.getWebSockets()) {
      if (other === ws) continue;

      if (other.readyState === WS_OPEN) {
        try {
            const to = attachmentOf(other)?.peerId ?? "unknown";

            console.log("[ROOM] relay", from, "->", to);
          other.send(message);
        } catch {}
      }
    }
  }

  webSocketClose(ws) {
    try {
        console.log(
            "[ROOM] close",
            attachmentOf(ws)?.peerId ?? "unknown"
        );
      ws.close();
    } catch {}
  }

  webSocketError(ws) {
    try {
      ws.close(
        WS_INTERNAL_ERROR,
        "error"
      );
    } catch {}
  }
}
