# M3 plastic deformation evaluation

All clips use the same imported BMW M3 geometry and the same generic engine
`PlasticDeformationSystem`. No crash-specific morph target or hand-authored dent
is used.

The physics body owns mass, inertia and contact response. Imported render parts
follow that body. Metal body panels receive persistent plastic deformation from
contact energy relative to the steel yield profile; wheels, tyres, glass and lights
follow the body but are not treated as sheet steel.

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
