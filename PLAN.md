# Plan: Night shift at the megastore

The goal is a playable game after every step, with each step shipped separately. The first
playtest comes after step 3, because that's when we'll find out whether the game is fun.

## 1. Store and carrying

- Replace the green arena with a fixed, hand-made store: a grid of aisles, plus a loading dock.
- Add `grab` and `drop` actions to `Device`, for both keyboard and controller, with the server
  validating each one.
- A carried item follows its carrier. Dropping it hands it back to Havok, so it tumbles.
- Large items need two carriers, and fall if the carriers get too far apart.
- **Done when:** two players can carry a sofa to the dock, and dropping it looks funny.

## 2. The shift

- Add server-side phases: briefing, shift, then results.
- Each shift has an order list, a dawn timer and items that count once they're on the dock.
- Show the orders and time left in a DOM overlay.
- Players left inside at dawn lose that shift's bonus. Hitting the order target moves the crew to a
  harder night.
- **Done when:** a full shift can be won or lost, and the "one more trip?" decision exists.

## 3. Proximity voice

- Send audio directly between players with WebRTC, using Colyseus messages for connection setup.
- Fade each voice with distance using Web Audio.
- Add a mic permission prompt and a mute control.
- **Main risk:** players on different networks may need a TURN relay server, which we'd have to
  host. Test on the local network first.
- **Done when:** a friend's voice fades as they walk down an aisle. **Then run the first playtest.**

## 4. First monster

- Add one mannequin that moves only when nobody is looking at it.
- It runs on the server, which also checks whether players can see it. It uses simple grid
  pathfinding along the aisles.
- A caught player drops what they're carrying and is out for the shift. Dead players can only talk
  to each other.
- Dim the lights as dawn approaches.
- **Done when:** players get scared, and being caught makes the others laugh.

## 5. Generated stores

- Build each night's layout from a seed, using shared code so the server and clients produce the
  same store.
- `stepMover` currently reads a fixed `LEVEL_BOXES`, so it must take the current level instead to
  stay pure.
- Every layout must keep the items reachable.
- **Done when:** each night has a different layout and nobody gets stuck.

## 6. Content and character

- Add more item types and two or three more monsters, each learnable by sound.
- Add the increasingly unhinged intercom announcer, real models and audio in `/srv/assets`, and
  crew progress saved by player name.

## Decisions

- **Start in the harbour:** players start in a stopped van in the harbour, then move into one of the
  buildings. The walled store in `shared/level.ts` is temporary, so don't polish it. This needs
  collision along the route, a building interior with its own lighting, and a camera that works
  under a roof. Steps 1–5 still describe the old store, and haven't been reworked for this.
- **Online first:** each new feature only needs to work for one player per screen. The splitscreen
  code stays until Emil confirms, and removing it is a small cleanup at any point.
- **Custom movement stays:** players keep using `stepMover`, not Havok, because that protects
  prediction.
- **No monster until step 4:** carrying and the shift need to be fun without one. Otherwise, the
  monster could hide a weak core loop.
