import Fastify from "fastify";
import { WebSocketServer } from "ws";
import { createServer } from "http";

const fastify = Fastify();

fastify.get("/", async () => ({ ok: true }));

const server = createServer(fastify.server);

const wss = new WebSocketServer({ server });

wss.on("connection", (ws) => {
    console.log("🟢 Client connected");

    ws.on("message", (msg) => {
        const data = JSON.parse(msg);

        console.log("📩", data);

        wss.clients.forEach((client) => {
            if (client !== ws && client.readyState === ws.OPEN) {
                client.send(JSON.stringify(data));
            }
        });
    });

    ws.on("close", () => console.log("🔴 Client disconnected"));
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Fastify WebSocket server running on port ${PORT}`);
});
