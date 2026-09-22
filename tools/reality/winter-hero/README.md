# Winter Hero reality target

This directory is the end-to-end photorealism target for the complete winter game scene.

It complements — and does **not** replace — Stanford-ORB:

- **Stanford-ORB** is the controlled external truth for the production renderer on held-out real captures.
- **Winter Hero** is the complete-world appearance target: vehicle, glass, road, snow, buildings, indirect light, reflections, contact and composition.
- **Performance** remains a separate hard guard.

A renderer change is acceptable only when it does not regress Stanford-ORB, moves the fixed winter hero capture toward `reference.jpg`, and stays inside the runtime budget.

The reference is intentionally stored as an AI-generated visual target. It is not physical ground truth and must never be used to calibrate Stanford-ORB or replace measured radiance. Its job is to prevent the exact failure mode we observed: a green controlled renderer benchmark while the actual game scene still looks synthetic.
