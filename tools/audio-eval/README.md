# Audio evaluation suite

Every clip is rendered by the production WebGPU runtime and receives offline audio
from the same deterministic simulation. No recorded impact/footstep samples and no
music are mixed into these clips.

Listen for:

1. **01 dry snow** — crisp irregular grain failures after heel pressure.
2. **02 wet snow** — fewer bright grains, slower low-frequency squish/suction.
3. **03 thin steel knock** — panel resonance should outlive the dull wooden excitation.
4. **04 heavy steel hit** — same panel character, much stronger excitation and metal contact.
5. **05 glass tap** — resonant glass response below the fracture threshold.
6. **06 glass fracture** — initial contact followed by crack/shard energy.
7. **07 steel on concrete** — dense metallic body plus short hard concrete contact.
8. **08 wood on concrete** — lower, more damped response than steel at similar scale.

The suite is deliberately dry: one dominant cause per clip so subjective feedback
can be tied back to material/geometry/contact parameters instead of cinematic mix.
