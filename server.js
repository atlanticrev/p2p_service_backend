import Fastify from "fastify";
import { WebSocketServer } from "ws";
import { createServer } from "http";

const fastify = Fastify();
fastify.get("/", async () => ({ ok: true }));

const server = createServer(fastify.server);
const webSocketServer = new WebSocketServer({ server });

const readyClients = new Set();

webSocketServer.on("connection", (webSocket) => {
    console.log("🟢 Client connected");

    webSocket.on("message", (msg) => {
        const data = JSON.parse(msg);
        console.log("📩", data);

        // ✅ Когда клиент нажал "Позвонить"
        if (data.type === "ready") {
            readyClients.add(webSocket);

            // Когда готовы двое — запускаем звонок
            if (readyClients.size === 2) {
                const [first] = Array.from(readyClients);

                console.log("🎬 Both clients ready — starting offer phase");

                // Первому отправляем "startOffer"
                first.send(JSON.stringify({ type: "startOffer" }));

                // Обоим сообщаем, что соединение начинается
                readyClients.forEach((client) =>
                    client.send(JSON.stringify({ type: "status", message: "Connecting..." }))
                );
            }

            return;
        }

        webSocketServer.clients.forEach((client) => {
            if (client !== webSocket && client.readyState === webSocket.OPEN) {
                client.send(JSON.stringify(data));
            }
        });
    });

    webSocket.on("close", () => {
        console.log("🔴 Client disconnected");
        readyClients.delete(webSocket);
    });
});

const PORT = process.env.PORT || 3001;

server.listen(PORT, "0.0.0.0", () => {
    console.log(`✅ Fastify WebSocket server running on port ${PORT}`);
});
