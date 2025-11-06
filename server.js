import Fastify from "fastify";
import { WebSocketServer } from "ws";
import { createServer } from "http";

const fastify = Fastify();

fastify.get("/", async () => ({ ok: true }));

const server = createServer(fastify.server);

const webSocketServer = new WebSocketServer({ server });

webSocketServer.on("connection", (webSocket) => {
    console.log("🟢 Client connected");

    webSocket.on("message", (msg) => {
        const data = JSON.parse(msg);

        console.log("📩", data);

        webSocketServer.clients.forEach((client) => {
            if (client !== webSocket && client.readyState === webSocket.OPEN) {
                client.send(JSON.stringify(data));
            }
        });
    });

    webSocket.on("close", () => console.log("🔴 Client disconnected"));
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Fastify WebSocket server running on port ${PORT}`);
});
