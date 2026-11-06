import { defineRoom, defineServer } from "@colyseus/core";
import { GameRoom } from "./rooms/GameRoom";

/** Room registry. Add new room types here. The client imports this file's *type* only. */
const server = defineServer({
  rooms: {
    // One set of rooms per building and mode: players join the one their `level` and `mode` name.
    game: defineRoom(GameRoom).filterBy(["level", "mode"]),
  },
});

export default server;
