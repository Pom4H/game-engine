# Infinite world

The world coordinate space is unbounded by authored map dimensions. Materialized
tiles are a cache of a deterministic or persistent world source, not the world
itself.

## Separate interest fields

Do not use one radius for every subsystem.

~~~text
camera / aircraft
      |
      +--> render visibility ----> hierarchical world tiles
      |
player/body
      +--> physics interest -----> collision residency
      |
players/interactions
      +--> simulation interest --> detailed/active/aggregate/dormant
~~~

A pilot at 1 km altitude can see roughly 113 km to an Earth-like apparent
horizon. That does not mean 113 km of collision, traffic or NPC simulation should
be active.

## Tile hierarchy

LOD 0 is the base world tile (128 m by default). Every next LOD doubles the tile
edge in both axes:

~~~text
LOD 0    128 m
LOD 1    256 m
LOD 2    512 m
LOD 3   1024 m
...
~~~

VisibilityInterest starts from coarse root tiles and recursively subdivides only
where world detail is useful. Leaves form a non-overlapping quadtree: there is
never a coarse parent rendered underneath one of its detailed children.

The default near-detail band is 1024 m. At higher altitude the number of full
128 m tiles therefore stays roughly stable while additional distance is represented
by increasingly coarse tiles.

## Altitude and horizon

For an Earth-like apparent horizon:

~~~text
d = sqrt(h * (2R + h))
~~~

where h is camera altitude above local ground and R is the configured horizon
radius. The default R is 6,371 km. This is a visibility model only; engine world
coordinates remain planar and physics is not forced onto a sphere.

Set horizonRadiusM to null for a flat-world visibility model. In that mode distance
is bounded by maxDistanceM and optional atmospheric visibility.

Weather can provide atmosphericVisibilityM, so fog can reduce the streaming
horizon without changing terrain generation. Horizontal speed contributes bounded
lookahead to preload world ahead of a fast aircraft or car.

## Ownership

VisibilityInterest owns only the demand calculation.

InfiniteWorld owns:

- a hard resident-tile budget;
- a hard concurrent-generation budget;
- cancellation of unwanted work;
- deterministic demand priority;
- short best-effort retention to prevent churn;
- install/uninstall lifetime;
- inspection counters.

The application owns the tile payload:

~~~text
generate(tile) -> terrain / roads / buildings / vegetation / ...
~~~

A generator receives the requested LOD. A far tile should therefore generate a
macro terrain/building representation instead of constructing the same dense
objects and merely drawing them smaller.

## The Game migration boundary

The old The Game WorldStreaming combines two responsibilities:

1. generic wanted/prefetch/residency mechanics;
2. game-specific worldChunk generation and installation.

Only (1) belongs in the engine. Biomes, roads, settlements, airports, businesses
and other world rules stay in The Game and become the tile generator/installer
adapter.

This also means the existing 256 m simulation-location grid does not need to match
the 128 m render-tile grid. They answer different questions.
