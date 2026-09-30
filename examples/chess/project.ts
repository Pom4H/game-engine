import {project,chess} from '@rom4/game-engine/games/chess/project';

export default project({
  id: 'chess',
  modules: {
    rules: chess({
      fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1',
      historyLimit: 4096,
    }),
    // No physics, GPU, audio, networking or frame loop.
  },
  presets: {
    endgame: {
      rules: { fen: '7k/8/8/8/8/8/8/R5K1 w - - 0 1' },
    },
  },
});
