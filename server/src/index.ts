import server from "./app";

const port = Number(process.env.SERVER_PORT ?? 2567);

// Localhost only: browsers reach it through the Vite proxy.
await server.listen(port, "127.0.0.1");
console.log(`Game server listening on 127.0.0.1:${port}`);
