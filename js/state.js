// Single shared game state object. Every system hangs itself off G.
export const G = {
  time: 0,          // real elapsed (s)
  gtime: 0,         // game elapsed (scaled)
  timeScale: 1,
  paused: true,
  started: false,
  mode: 'foot',     // 'foot' | 'bike'
};
