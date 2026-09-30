import { project, thegame } from '@rom4/game-engine/games/thegame/project';

export default project({
 id: 'thegame',
 modules: {
  rules: thegame({
   // Shared world: change here, then restart the server.
   seed: 29, walkSpeed: 3.35, runSpeed: 6.8, gravity: 16, jumpSpeed: 5.4,
   // Local presentation: editable during the network game.
   viewRadius: 3, exposure: 1,
  }),
 },
 presets: {compact: {rules: {viewRadius: 2}}, landscape: {rules: {viewRadius: 4}}},
});
