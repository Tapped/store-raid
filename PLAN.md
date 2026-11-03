# Plan: Store raid

A crew arrives in a truck at the harbour at night, breaks into one of the buildings, and carries out
whatever they can sell. The deeper and higher they go, the darker it gets and the better the loot.
Between rounds they spend the money in a shop. Each level is a new building with new enemies.

The goal is a playable game after every step, with each step shipped separately.

## The round

1. **Truck:** the crew starts in a large truck parked in the harbour, with no equipment the first
   time.
2. **Raid:** they go into the building, a maze of shelving over several floors. It's lit near the
   entrance and quickly gets dark further in.
3. **Load:** loot counts once it's inside the truck. Players can make as many trips as they dare.
4. **Leave:** the crew drives off when everyone is in the truck. Anyone left behind is lost for
   the round, along with what they were carrying.
5. **Results and shop:** the loot is sold, the crew sees what it earned, and spends it on gear.

**To clear a level, the truck must hold loot worth at least the level's quota.** That's the "X"
players must pick up: a sum of money, not a specific item, so every item counts and the crew
decides what's worth the risk. Missing the quota means replaying the level, poorer.

## Loot in the first building

The first building is a megastore. Item value rises with how far in, how high up and how dark it
is, so the safe, lit floor near the entrance only holds small change.

| Size        | Hands            | Examples                                 | Value       |
| ----------- | ---------------- | ---------------------------------------- | ----------- |
| Small       | one              | phone, headphones, perfume, spirits      | low         |
| Large       | two              | TV, microwave, game console, drill case  | medium      |
| Huge        | two players      | sofa, fridge, arcade cabinet             | high        |
| Jackpot     | two players      | the safe in the manager's office, top floor | very high |

The jackpot is optional: it alone can meet the quota, but it's heavy, slow and in the darkest part
of the building.

## Hands

- Each player has two hands. A one-handed thing takes one hand; a two-handed thing takes both.
- Weapons and tools use hands too. A shovel needs two hands, so whoever holds it carries nothing.
  A flashlight takes one, leaving one hand for small loot.
- This is the main tension: someone has to light the way and someone has to fight, and they aren't
  carrying anything while they do. Crews split into roles by themselves.
- Weapons can be found inside the building (shovels, to begin with) as well as bought.

## Shop

Flashlight, shovel, grenade, pistol, and a camera whose flash kills ghosts. More to come. Gear
bought in the shop is kept between rounds unless its owner is lost in a building.

## Enemies

Each enemy should be learnable by sound, and should push on the loot choices rather than only on
health.

First building:

- **Large ticks** drop from the tops of shelves in the dark and latch on, draining health. Pulling
  one off takes a free hand, or a teammate. Light makes them back off.
- **Worms** burrow under the floor and hunt vibration. Running and dragging heavy loot draws them;
  standing still is safe.

Later buildings: ghosts (the camera kills them), large spiders, a snake, and a witch who can
possess a player without the others knowing. The witch relies on every player having their own
screen.

## Steps

### 1. Hands

- Replace `grab` and `drop` with one action per hand on `Device`, for both keyboard and controller,
  and validate them on the server.
- Items say whether they take one hand, two hands or two players. Two-player carrying already
  exists for the sofa.
- **Done when:** a player can hold a phone in each hand, or a TV in both, and two players can carry
  a sofa.

### 2. Truck and the round

- Add the truck in the harbour and the route to the building, with collision.
- Add server-side phases: truck, raid, results. Loot inside the truck counts towards the quota.
- Show the quota, the loot so far and the results in a DOM overlay.
- **Done when:** a round can be cleared or failed, and the "one more trip?" decision exists.

### 3. The dark building and proximity voice

- A building interior with its own lighting: lit at the entrance, dark further in.
- A flashlight, held in one hand, lighting a cone in front of the player.
- Proximity voice: audio sent directly between players with WebRTC, connection setup over Colyseus
  messages, each voice fading with distance through Web Audio. Players on different networks may
  need a TURN relay we'd have to host, so test on the local network first.
- **Done when:** a friend's voice fades as they walk off into the dark with the only flashlight.
  **Then run the first playtest.**

### 4. Floors

- Several floors joined by stairs or ramps. `stepMover` is 2D today and reads a fixed
  `LEVEL_BOXES`, so it must gain height and take the current level as input, and stay pure.
- Place loot so value rises with depth, height and darkness.
- **Done when:** the crew can carry a sofa down a flight of stairs.

### 5. First enemies

- Health, and what happens when a player dies: they drop everything and are out for the round.
  Dead players can only talk to each other.
- Ticks and worms on the server, with simple pathfinding through the shelving.
- The shovel as the first weapon, found in the building.
- **Done when:** players get scared, and someone dies for a TV that wasn't worth it.

### 6. Shop and money

- The shop between rounds, with the flashlight, shovel, grenade and pistol.
- Money and gear saved through `server/src/persist.ts`.
- **Done when:** a crew can buy a flashlight with what it earned in the first round.

### 7. Later buildings

- New buildings, each with new loot and enemies, starting with ghosts and the camera.
- Generated layouts from a seed, shared by server and clients, keeping all loot reachable.

## Decisions

- **The walled store in `shared/level.ts` is temporary,** so don't polish it. It becomes the first
  building's ground floor.
- **Online first:** each new feature only needs to work for one player per screen. The splitscreen
  code stays until Emil confirms, and removing it is a small cleanup at any point.
- **Custom movement stays:** players keep using `stepMover`, not Havok, because that protects
  prediction.
- **No enemies until step 5:** carrying and the round need to be fun without them. Otherwise,
  enemies could hide a weak core loop.

## Open questions

- Is money shared by the crew or earned per player? Shared is simpler and keeps the crew
  cooperating; per player makes the witch and betrayal more interesting.
- Is gear lost when its owner dies, or only when they're left behind at the end of the round?
