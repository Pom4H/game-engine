# M3 plastic deformation evaluation

All clips use the same compact M3 model: a parametric macro/structural profile
with an optional quantized high-fidelity exterior shell. The expanded imported
mesh JSON is no longer part of the runtime or repository. No crash-specific morph
target or hand-authored dent is used.

The existing movie scenes still exercise the reduced `PlasticDeformationSystem`
for visual acceptance. In parallel, the structural regression suite derives a
28-node closed collision cage from exactly the same M3 profile and runs XPBD
cage-vs-wall contact at 90 km/h. That path owns nodal mass, plastic strain and
collision projection directly rather than shrinking a rigid OBB. Wheels, tyres,
glass and lights are presentation parts and are not treated as sheet steel.

Clips:

1. 5 m/s low-speed frontal wall contact.
2. 15 m/s (~54 km/h) full frontal wall contact.
3. 25 m/s (~90 km/h) severe full frontal wall contact.
4. 16 m/s offset frontal contact with a narrow block.
5. 13 m/s lateral slide into a narrow pole.
6. 12 m/s rear-first wall contact.
7. 850 kg falling roof press.

The evaluation target is the *shape and locality of permanent crush*: low energy
should create shallow local damage, severe energy should consume more crush space,
offset and pole impacts should remain asymmetric, and roof loading should not turn
into the same front-crash deformation field.


## Model representation

The M3 macro profile serializes to 663 bytes. The optional deduplicated exterior shell stores 700 unique vertices / 1,126 triangles in a 10,956-byte uint16 position+index payload. Together that is 11,619 bytes of model-specific shape data before base64/source-code overhead, versus 241,628 bytes for the original FBX and 1,194,172 bytes for the removed expanded JSON. Structural physics consumes the macro profile, not the packed render shell.
