import { defineRoom, defineServer } from "@colyseus/core";
import { GameRoom } from "./rooms/GameRoom";

/** Room registry. Add new room types here. The client imports this file's *type* only. */
const server = defineServer({
  rooms: {
    // One set of rooms per building: players join the one named by their `level` option.
    game: defineRoom(GameRoom).filterBy(["level"]),
  },
});

export default server;
