import Fastify from "fastify";
import { WebSocket, WebSocketServer } from "ws";

const fastify = Fastify();
const webSocketServer = new WebSocketServer({ server: fastify.server });

const ROOM_CAPACITY = 2;
const readyClients = new Set();

const sendJson = (client, payload) => {
    if (client.readyState === WebSocket.OPEN) {
        client.send(JSON.stringify(payload));
    }
};

const getRoomStatePayload = () => ({
    type: "roomState",
    participants: readyClients.size,
    capacity: ROOM_CAPACITY,
});

const broadcastRoomState = () => {
    const payload = getRoomStatePayload();
    readyClients.forEach((client) => {
        sendJson(client, payload);
    });
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
        return;
    }

    broadcastRoomState();
};

const relayToRoomPeers = (sourceClient, payload) => {
    readyClients.forEach((client) => {
        if (client !== sourceClient && client.readyState === WebSocket.OPEN) {
            client.send(JSON.stringify(payload));
        }
    });
};

fastify.get("/", async () => ({ ok: true }));

fastify.get("/room-state", async (_request, reply) => {
    reply.header("Access-Control-Allow-Origin", "*");
    reply.header("Cache-Control", "no-store");

    return {
        participants: readyClients.size,
        capacity: ROOM_CAPACITY,
    };
});

webSocketServer.on("connection", (webSocket) => {
    console.log("🟢 Client connected");

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
            removeFromReadyClients(webSocket);
            relayToRoomPeers(webSocket, { type: "hangup" });

            return;
        }

        relayToRoomPeers(webSocket, data);
    });

    webSocket.on("close", () => {
        console.log("🔴 Client disconnected");
        relayToRoomPeers(webSocket, { type: "hangup" });
        removeFromReadyClients(webSocket);
    });
});

const PORT = Number(process.env.PORT) || 3001;

fastify.listen({ port: PORT, host: "0.0.0.0" }, (error) => {
    if (error) {
        console.error(error);
        process.exit(1);
    }

    console.log(`✅ Fastify WebSocket server running on port ${PORT}`);
});
