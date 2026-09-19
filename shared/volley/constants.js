// Field geometry and physics tuning for Volley.
// Coordinates are in logical pixels with y pointing UP and the ground at y = 0.
// Everything here is shared by the server, the bots and the browser client.

export const FIELD_W = 800;
export const FIELD_H = 600; // ceiling height above the ground

export const NET_X = FIELD_W / 2;
export const NET_HALF_W = 6;
export const NET_HEIGHT = 270; // y of the rounded net top

export const BALL_R = 24;
export const BALL_GRAVITY = 720; // px/s^2
export const BALL_HIT_SPEED = 780; // px/s, the ball always leaves a blob at this speed
export const BALL_WALL_BOUNCE = 0.92; // restitution against walls, ceiling and net
export const BALL_GROUND_BOUNCE = 0.55; // restitution on the ground (only while a point is being shown)

// A blob is two stacked circles (like the original): a fat lower body and a smaller head.
// Its position is the point between its feet.
export const BLOB_LOWER_R = 33;
export const BLOB_LOWER_Y = 33;
export const BLOB_UPPER_R = 25;
export const BLOB_UPPER_Y = 68;
export const BLOB_HEIGHT = BLOB_UPPER_Y + BLOB_UPPER_R;

export const BLOB_SPEED = 320; // px/s
export const BLOB_JUMP_V = 800; // px/s initial jump velocity
export const BLOB_GRAVITY = 2000; // px/s^2
export const BLOB_FLOAT_GRAVITY = 1400; // px/s^2 while jump is held on the way up: hold to jump higher

export const MAX_TOUCHES = 3; // a fourth consecutive touch by the same team is a fault
export const TICK_RATE = 60;
export const SNAPSHOT_RATE = 30; // snapshots per second the server sends each client
export const DT = 1 / TICK_RATE;

// phase byte carried in the snapshot header (see shared/net/module-contract.md)
export const PHASE = Object.freeze({ PLAY: 0, POINT: 1, OVER: 2 });
export const POINT_PAUSE_TICKS = 90; // ticks between a point and the next serve
export const SERVE_HEIGHT = 420; // the ball is dropped from here at the start of a rally
export const TOUCH_COOLDOWN_TICKS = 10; // one blob cannot register two touches this close together

export const DEFAULT_OPTIONS = Object.freeze({
  teamSize: 2, // 1 => 1v1 with the whole half to move in, 2 => 2v2 with front/back zones
  pointsToWin: 15, // win by two
});

export const TEAM_NAMES = ['Blue', 'Red'];
