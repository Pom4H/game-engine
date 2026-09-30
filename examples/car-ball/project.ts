import {project,arena} from '@rom4/game-engine/games/car-ball/project';

export default project({
  id: 'car-ball',
  modules: {
    rules: arena({
      gravity: 16,
      matchSeconds: 300,
      kickoffSeconds: 1.5,
    }),
  },
  presets: {
    moon: { rules: { gravity: 2 } },
    sprint: { rules: { matchSeconds: 60, kickoffSeconds: 0 } },
  },
});
