import { defineRoom, defineServer } from "@colyseus/core";
import { GameRoom } from "./rooms/GameRoom";

/** Room registry. Add new room types here. The client imports this file's *type* only. */
const server = defineServer({
  rooms: {
    game: defineRoom(GameRoom),
  },
});

export default server;
