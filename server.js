import Fastify from "fastify";
import { WebSocket, WebSocketServer } from "ws";

const fastify = Fastify();
const webSocketServer = new WebSocketServer({ server: fastify.server });

const ROOM_CAPACITY = 2;
const HEARTBEAT_INTERVAL_MS = 10_000;
const connectedClients = new Set();
const readyClients = new Set();

const sendJson = (client, payload) => {
    if (client.readyState !== WebSocket.OPEN) {
        return false;
    }

    try {
        client.send(JSON.stringify(payload));
        return true;
    } catch (error) {
        console.warn("Failed to send WS message", error);
        return false;
    }
};

const getRoomStatePayload = () => ({
    type: "roomState",
    participants: readyClients.size,
    capacity: ROOM_CAPACITY,
});

const broadcastRoomState = () => {
    const payload = getRoomStatePayload();
    connectedClients.forEach((client) => {
        sendJson(client, payload);
    });
};

const removeConnectionClient = (client) => {
    connectedClients.delete(client);
};

const startOfferIfRoomReady = () => {
    if (readyClients.size !== ROOM_CAPACITY) {
        return;
    }

    const [offerOwner] = Array.from(readyClients);

    console.log("🎬 Both clients ready — starting offer phase");
    sendJson(offerOwner, { type: "startOffer" });
    readyClients.forEach((client) => {
        sendJson(client, { type: "status", message: "Connecting..." });
    });
};

const removeFromReadyClients = (client) => {
    const wasInRoom = readyClients.delete(client);

    if (!wasInRoom) {
        return false;
    }

    broadcastRoomState();
    return true;
};

const cleanUpClient = (client, options = {}) => {
    const { notifyPeers = false, reason = "unknown" } = options;
    const wasInRoom = removeFromReadyClients(client);
    const wasConnected = connectedClients.has(client);

    removeConnectionClient(client);

    if (wasInRoom || wasConnected) {
        console.log("🧹 Client cleanup", {
            reason,
            wasInRoom,
            wasConnected,
            notifyPeers,
            readyState: client.readyState,
            roomParticipants: readyClients.size,
        });
    }

    if (notifyPeers && wasInRoom) {
        relayToRoomPeers(client, { type: "hangup" });
    }

    return wasInRoom;
};

const pruneClosedClients = () => {
    connectedClients.forEach((client) => {
        if (client.readyState === WebSocket.CLOSING || client.readyState === WebSocket.CLOSED) {
            cleanUpClient(client, { notifyPeers: true, reason: "prune-not-open" });
        }
    });
};

const relayToRoomPeers = (sourceClient, payload) => {
    readyClients.forEach((client) => {
        if (client === sourceClient) {
            return;
        }

        if (client.readyState !== WebSocket.OPEN) {
            cleanUpClient(client, { reason: "relay-target-not-open" });
            return;
        }

        sendJson(client, payload);
    });
};

fastify.get("/", async () => ({ ok: true }));

const heartbeatTimer = setInterval(() => {
    connectedClients.forEach((client) => {
        if (client.readyState !== WebSocket.OPEN) {
            cleanUpClient(client, { notifyPeers: true, reason: "heartbeat-not-open" });
            return;
        }

        if (client.isAlive === false) {
            console.log("💀 Stale WebSocket detected, terminating");
            cleanUpClient(client, { notifyPeers: true, reason: "heartbeat-timeout" });
            client.terminate();
            return;
        }

        client.isAlive = false;

        try {
            client.ping();
        } catch (error) {
            console.warn("Failed to ping client", error);
            cleanUpClient(client, { notifyPeers: true, reason: "heartbeat-ping-error" });
            client.terminate();
        }
    });
}, HEARTBEAT_INTERVAL_MS);

heartbeatTimer.unref?.();

webSocketServer.on("connection", (webSocket) => {
    console.log("🟢 Client connected");
    connectedClients.add(webSocket);
    webSocket.isAlive = true;
    sendJson(webSocket, getRoomStatePayload());

    webSocket.on("pong", () => {
        webSocket.isAlive = true;
    });

    webSocket.on("message", (msg) => {
        let data;

        try {
            data = JSON.parse(msg.toString());
        } catch {
            sendJson(webSocket, { type: "error", message: "Invalid JSON payload" });

            return;
        }

        if (!data?.type) {
            sendJson(webSocket, { type: "error", message: "Missing message type" });

            return;
        }

        console.log("📩", data);

        // ✅ Когда клиент нажал "Присоединиться к комнате"
        if (data.type === "ready") {
            pruneClosedClients();

            if (readyClients.has(webSocket)) {
                sendJson(webSocket, getRoomStatePayload());

                return;
            }

            if (readyClients.size >= ROOM_CAPACITY) {
                sendJson(webSocket, { type: "roomFull", message: "Room is full" });
                sendJson(webSocket, getRoomStatePayload());

                return;
            }

            readyClients.add(webSocket);
            broadcastRoomState();
            startOfferIfRoomReady();

            return;
        }

        if (data.type === "hangup" || data.type === "leave") {
            const wasInRoom = removeFromReadyClients(webSocket);

            if (wasInRoom) {
                console.log("🧹 Room slot released", {
                    reason: `client-${data.type}`,
                    roomParticipants: readyClients.size,
                });
                relayToRoomPeers(webSocket, { type: "hangup" });
            }

            return;
        }

        relayToRoomPeers(webSocket, data);
    });

    webSocket.on("close", (code, reasonBuffer) => {
        console.log("🔴 Client disconnected", {
            code,
            reason: reasonBuffer?.toString() || null,
        });
        cleanUpClient(webSocket, { notifyPeers: true, reason: "socket-close" });
    });

    webSocket.on("error", (error) => {
        console.warn("WebSocket connection error", error);
    });
});

webSocketServer.on("close", () => {
    clearInterval(heartbeatTimer);
});

const PORT = Number(process.env.PORT) || 3001;

fastify.listen({ port: PORT, host: "0.0.0.0" }, (error) => {
    if (error) {
        console.error(error);
        process.exit(1);
    }

    console.log(`✅ Fastify WebSocket server running on port ${PORT}`);
});
