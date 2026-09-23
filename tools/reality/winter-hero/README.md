# Winter Hero reality target

This directory is the end-to-end photorealism target for the complete winter game scene.

It complements — and does **not** replace — Stanford-ORB:

- **Stanford-ORB** is the controlled external truth for the production renderer on held-out real captures.
- **Winter Hero** is the complete-world appearance target: vehicle, glass, road, snow, buildings, indirect light, reflections, contact and composition.
- **Performance** remains a separate hard guard.

A renderer change is acceptable only when it does not regress Stanford-ORB, moves the fixed winter hero capture toward `reference.jpg`, and stays inside the runtime budget.

The reference is intentionally stored as an AI-generated visual target. It is not physical ground truth and must never be used to calibrate Stanford-ORB or replace measured radiance. Its job is to prevent the exact failure mode we observed: a green controlled renderer benchmark while the actual game scene still looks synthetic.

`reference.jpg` is a 960×720 LANCZOS resize of the source image `Winter BMW M3 on a Snowy City Street.png` (source SHA-256 `ffa84b3519bebd0d4f90718252d4bfa6d8d41f1c6d582ae75f66f391211619c4`), saved as baseline JPEG at quality 88 with 4:4:4 chroma. Decode it completely before measuring similarity: an earlier truncated JPEG silently filled the bottom half with gray and distorted the metric.
