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
3. **Load:** loot counts once it's inside the truck. Players can make as many trips as they dare
   before dawn.
4. **Leave:** the crew drives off when everyone alive is in the truck, or at dawn at the latest.
   Anyone left behind at dawn is lost, along with what they were carrying.
5. **Results and shop:** the loot is sold, the crew sees what it earned, and spends it on gear.
   Money is shared by the crew.

**A timer counts down to dawn, and the building gets harder as it runs out:** more enemies, faster
and more aggressive, and lights failing. The first trips are fairly safe; the last ones are where
crews die for a TV that wasn't worth it.

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
bought in the shop is kept between rounds, as long as someone brings it back to the truck.

## Death

A dead player leaves a ragdoll, with everything they held lying beside it for anyone to pick up.
Whatever killed them doesn't die with them and is still nearby, so getting the gear back is a risk
of its own. Dead players are out for the rest of the round and can only talk to each other.

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

### 1. Hands ✓

- Replace `grab` and `drop` with one action per hand on `Device`, for both keyboard and controller,
  and validate them on the server.
- Items say whether they take one hand, two hands or two players. Two-player carrying already
  exists for the sofa.
- **Done when:** a player can hold a phone in each hand, or a TV in both, and two players can carry
  a sofa.
- **Done:** F and G on the keyboard, LB and RB on a controller, each press letting go of what that
  hand holds or grabbing with it. Phones and TVs are placeholder boxes in the store, and
  `scripts/hands.ts` checks all of the above with bots. Players step over one-handed things instead
  of kicking them away, and a carried item now rights itself instead of staying tilted. The
  triggers are kept free for using what's in each hand: the flashlight, a weapon.
- **Changed:** one grab (E, RB) and one drop (Q, LB) instead of a button per hand. A grab uses the
  right hand if it's free, else the left; a drop lets go of the last thing grabbed.

### 2. Truck and the round

- Add the truck in the harbour and the route to the building, with collision.
- Add server-side phases: truck, raid, results. Loot inside the truck counts towards the quota.
- A timer to dawn ends the raid. Players outside the truck at dawn are lost.
- Show the quota, the loot so far, the time left and the results in a DOM overlay.
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

- Health, and death: a ragdoll on the server, with the player's items dropped beside it.
- Ticks and worms on the server, with simple pathfinding through the shelving.
- More and faster enemies, and failing lights, as dawn approaches.
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

- **First person:** each player sees through their own character's eyes. Grabbing takes what's in
  front of you, and carried things stay in view.
- **The walled store in `shared/level.ts` is temporary,** so don't polish it. It becomes the first
  building's ground floor.
- **Online only, one player per screen.** Splitscreen has been removed.
- **Custom movement stays:** players keep using `stepMover`, not Havok, because that protects
  prediction.
- **No enemies until step 5:** carrying and the round need to be fun without them. Otherwise,
  enemies could hide a weak core loop.
- **Money is shared by the crew.** `persist.ts` keys state by player name, so the crew needs a
  name of its own to save money under.
- **Gear survives death:** it stays by the ragdoll until someone picks it up. It's only lost if
  nobody brings it back to the truck before dawn.
