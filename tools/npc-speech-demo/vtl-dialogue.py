#!/usr/bin/env python3
"""Render an engine-owned dialogue through the external VocalTractLab C API.

Usage: vtl-dialogue.py VTL_LIB SPEAKER PLAN_JSON OUTPUT_DIR

Pitch is an articulatory source target, not a post-production pitch shift.
Pressure controls multiply the backend's existing pressure windows. Mixing only
adds equal-power stereo positioning and one global linear gain.

The pinned backend requires vtl-anatomy-reference.patch before anatomy changes.
Gestures require at least 1 ms; each turn is limited to 55 s to fit the backend's
60 s curve buffer, and the complete recording is limited to 600 s.
"""

import array
import ctypes
import hashlib
import json
import math
import os
from pathlib import Path
import re
import sys
import wave
import xml.etree.ElementTree as ET


SAMPLE_RATE = 44_100
UPSTREAM_COMMIT = "df30392f18dc5e175b577c3ba734caaa65a3927f"
MIN_GESTURE_S = 0.001
ID_PATTERN = re.compile(r"[A-Za-z0-9][A-Za-z0-9_-]{0,63}\Z")
PHONES = frozenset((
    "a: e: i: o: u: E: 2: y: a e i o u E 2 y I O U 9 Y @ 6 "
    "aI aU OY i:6 i6 I6 y:6 y6 Y6 e:6 e6 E6 E:6 2:6 26 96 "
    "a:6 a6 u:6 u6 U6 o:6 o6 O6 ? p b t d k g "
    "f v T D s z S Z C j x r R h pf ts tS dZ m n N l"
).split()) | {""}
ANATOMY_NAMES = (
    "lipWidthCm", "mandibleHeightCm", "lowerMolarsHeightCm",
    "upperMolarsHeightCm", "palateHeightCm", "palateDepthCm",
    "hardPalateLengthCm", "softPalateLengthCm", "pharynxLengthCm",
    "larynxLengthCm", "larynxWidthCm", "vocalFoldLengthCm",
    "oralPharyngealAngleDeg",
)


def number(value, label, lower=None, upper=None):
    if isinstance(value, bool) or not isinstance(value, (int, float)) or not math.isfinite(value):
        raise ValueError(f"{label} must be a finite number")
    if lower is not None and value < lower:
        raise ValueError(f"{label} must be >= {lower}")
    if upper is not None and value > upper:
        raise ValueError(f"{label} must be <= {upper}")
    return float(value)


def identifier(value, label):
    if not isinstance(value, str) or not ID_PATTERN.fullmatch(value):
        raise ValueError(f"{label} must be a safe, nonempty identifier of at most 64 characters")
    return value


def validate_contour(points, label, field, lower, upper, duration):
    if not isinstance(points, list) or not points:
        raise ValueError(f"{label} requires at least one point")
    previous = None
    for i, point in enumerate(points):
        if not isinstance(point, dict):
            raise ValueError(f"{label}[{i}] must be an object")
        time = number(point.get("timeS"), f"{label}[{i}].timeS", 0, duration + 1e-9)
        number(point.get(field), f"{label}[{i}].{field}", lower, upper)
        if i == 0 and time != 0:
            raise ValueError(f"{label} must begin at timeS=0")
        if previous is not None and time - previous < MIN_GESTURE_S - 1e-9:
            raise ValueError(f"{label} times must increase by at least 1 ms")
        previous = time


def validate_plan(plan):
    if not isinstance(plan, dict) or plan.get("schemaVersion") != 1:
        raise ValueError("plan.schemaVersion must be 1")
    if plan.get("sampleRate") != SAMPLE_RATE:
        raise ValueError(f"plan.sampleRate must be {SAMPLE_RATE}")
    speakers = plan.get("speakers")
    turns = plan.get("turns")
    if not isinstance(speakers, list) or not 1 <= len(speakers) <= 32:
        raise ValueError("plan.speakers must contain 1 to 32 speakers")
    if not isinstance(turns, list) or not 1 <= len(turns) <= 256:
        raise ValueError("plan.turns must contain 1 to 256 turns")
    by_id = {}
    for speaker in speakers:
        if not isinstance(speaker, dict):
            raise ValueError("Each speaker must be an object")
        speaker_id = identifier(speaker.get("id"), "speaker.id")
        if speaker_id in by_id:
            raise ValueError(f"Duplicate speaker id: {speaker_id}")
        if not isinstance(speaker.get("name"), str) or not speaker["name"].strip():
            raise ValueError(f"Speaker {speaker_id} requires a name")
        number(speaker.get("pan"), f"speaker {speaker_id}.pan", -1, 1)
        anatomy = speaker.get("anatomy")
        if anatomy is not None:
            if not isinstance(anatomy, dict):
                raise ValueError(f"Speaker {speaker_id}.anatomy must be an object or null")
            age = anatomy.get("ageMonths")
            number(age, f"speaker {speaker_id}.anatomy.ageMonths", 12, 1200)
            if not isinstance(age, int) or not isinstance(anatomy.get("isMale"), bool):
                raise ValueError("Anatomy requires integer ageMonths and boolean isMale")
        by_id[speaker_id] = speaker
    turn_ids = set()
    for turn in turns:
        if not isinstance(turn, dict):
            raise ValueError("Each turn must be an object")
        turn_id = identifier(turn.get("id"), "turn.id")
        if turn_id in turn_ids:
            raise ValueError(f"Duplicate turn id: {turn_id}")
        turn_ids.add(turn_id)
        if turn.get("speakerId") not in by_id:
            raise ValueError(f"Turn {turn_id} refers to an unknown speaker")
        if not isinstance(turn.get("text"), str) or not turn["text"].strip():
            raise ValueError(f"Turn {turn_id} requires its transcript")
        start = number(turn.get("startS"), f"turn {turn_id}.startS", 0, 600)
        segments = turn.get("segments")
        if not isinstance(segments, list) or not segments:
            raise ValueError(f"Turn {turn_id} requires segments")
        duration = 0.0
        has_phone = False
        for segment in segments:
            if not isinstance(segment, dict) or segment.get("phone") not in PHONES:
                raise ValueError(f"Turn {turn_id} contains an unsupported SAMPA segment")
            duration += number(segment.get("durationS"), "segment.durationS", MIN_GESTURE_S, 55)
            has_phone |= bool(segment["phone"])
        if not has_phone or duration > 55 or start + duration > 600:
            raise ValueError(f"Turn {turn_id} must contain speech and fit within 55 s / 600 s total")
        validate_contour(turn.get("pitch"), f"turn {turn_id}.pitch", "hz", 16, 512, duration)
        validate_contour(turn.get("pressure"), f"turn {turn_id}.pressure", "pa", 0, 1600, duration)
    return by_id


def check(rc, operation):
    if rc != 0:
        raise RuntimeError(f"{operation} failed with VTL status {rc}")


def load_backend(path):
    lib = ctypes.CDLL(str(path))
    signatures = {
        "vtlInitialize": [ctypes.c_char_p],
        "vtlClose": [],
        "vtlSegmentSequenceToGesturalScore": [ctypes.c_char_p, ctypes.c_char_p, ctypes.c_bool],
        "vtlGesturalScoreToAudio": [ctypes.c_char_p, ctypes.c_char_p, ctypes.POINTER(ctypes.c_double), ctypes.POINTER(ctypes.c_int), ctypes.c_bool],
        "vtlSetAnatomyFromAge": [ctypes.c_int, ctypes.c_bool],
        "vtlGetAnatomyParams": [ctypes.POINTER(ctypes.c_double)],
        "vtlGetConstants": [ctypes.POINTER(ctypes.c_int)] * 5 + [ctypes.POINTER(ctypes.c_double)],
    }
    for name, args in signatures.items():
        function = getattr(lib, name)
        function.argtypes = args
        function.restype = ctypes.c_int
    lib.vtlGetVersion.argtypes = [ctypes.c_char_p]
    lib.vtlGetVersion.restype = None
    return lib


def digest(path):
    hasher = hashlib.sha256()
    with open(path, "rb") as stream:
        for chunk in iter(lambda: stream.read(1024 * 1024), b""):
            hasher.update(chunk)
    return hasher.hexdigest()


def gesture(value, slope, duration, tau):
    if duration < MIN_GESTURE_S - 1e-9:
        raise ValueError("Generated gesture is shorter than VTL's 1 ms limit")
    return ET.Element("gesture", {
        "value": f"{value:.9f}", "slope": f"{slope:.9f}",
        "duration_s": f"{duration:.9f}", "time_constant_s": f"{tau:.9f}",
        "neutral": "0",
    })


def step_value(points, time, field):
    value = points[0][field]
    for point in points[1:]:
        if point["timeS"] > time + 1e-9:
            break
        value = point[field]
    return value


def apply_prosody(path, turn):
    tree = ET.parse(path)
    root = tree.getroot()
    tiers = {tier.get("type"): tier for tier in root.findall("gesture_sequence")}
    f0 = tiers.get("f0-gestures")
    pressure = tiers.get("lung-pressure-gestures")
    if f0 is None or pressure is None:
        raise ValueError("VTL did not generate its F0 and lung-pressure tiers")
    tier_durations = [sum(float(g.get("duration_s")) for g in tier) for tier in tiers.values()]
    score_end = max(tier_durations + [sum(s["durationS"] for s in turn["segments"])])
    if score_end > 59:
        raise ValueError("Generated VTL score exceeds its safe 60 second curve buffer")

    pitch_points = [(p["timeS"], 12 * math.log2(p["hz"])) for p in turn["pitch"]]
    if score_end - pitch_points[-1][0] > 1e-9:
        if score_end - pitch_points[-1][0] < MIN_GESTURE_S - 1e-9:
            raise ValueError("Final pitch point leaves a gesture shorter than 1 ms")
        pitch_points.append((score_end, pitch_points[-1][1]))
    f0[:] = []
    for (start, value), (end, target) in zip(pitch_points, pitch_points[1:]):
        slope = (target - value) / (end - start)
        if abs(slope) > 80 + 1e-9:
            raise ValueError(f"Turn {turn['id']} F0 slope {slope:.2f} exceeds 80 st/s")
        f0.append(gesture(value, slope, end - start, 0.012))

    # Preserve every converter pressure boundary, including zero-pressure tails.
    # Supplied controls are Pa, while the backend uses dPa with an 800 Pa norm.
    baseline = []
    cursor = 0.0
    for element in pressure:
        end = cursor + float(element.get("duration_s"))
        baseline.append((cursor, end, float(element.get("value")), float(element.get("time_constant_s"))))
        cursor = end
    if not baseline:
        raise ValueError("VTL generated an empty pressure tier")
    if score_end - cursor > 1e-9:
        baseline.append((cursor, score_end, 0.0, 0.012))
    pressure[:] = []
    windows = []
    for start, end, value, tau in baseline:
        if end - start < MIN_GESTURE_S - 1e-9:
            # A tiny padding remainder belongs to the preceding final silence.
            if value == 0 and len(pressure):
                previous = pressure[-1]
                if float(previous.get("value")) == 0:
                    previous.set("duration_s", f"{float(previous.get('duration_s')) + end - start:.9f}")
                    continue
            raise ValueError("Backend pressure window is shorter than 1 ms")
        cuts = [start]
        for point in turn["pressure"]:
            time = point["timeS"]
            if time - cuts[-1] >= MIN_GESTURE_S - 1e-9 and end - time >= MIN_GESTURE_S - 1e-9:
                cuts.append(time)
        cuts.append(end)
        for left, right in zip(cuts, cuts[1:]):
            requested_pa = step_value(turn["pressure"], left, "pa")
            product = value * requested_pa / 800.0
            if not 0 <= product <= 16000:
                raise ValueError("Combined lung-pressure target exceeds VTL's 0..16000 dPa range")
            pressure.append(gesture(product, 0, right - left, tau))
            windows.append({"startS": left, "endS": right, "baselinePa": value / 10, "targetPa": product / 10})
    tree.write(path, encoding="utf-8", xml_declaration=True)
    return {"scoreDurationS": score_end, "pressureWindows": windows,
            "f0TargetMinHz": min(p["hz"] for p in turn["pitch"]),
            "f0TargetMaxHz": max(p["hz"] for p in turn["pitch"])}


def read_pcm(path):
    with wave.open(str(path), "rb") as reader:
        if (reader.getframerate(), reader.getsampwidth(), reader.getnchannels()) != (SAMPLE_RATE, 2, 1):
            raise ValueError(f"Unexpected VTL WAV format in {path.name}")
        pcm = array.array("h")
        pcm.frombytes(reader.readframes(reader.getnframes()))
    if sys.byteorder != "little":
        pcm.byteswap()
    if not pcm:
        raise ValueError(f"VTL produced an empty WAV: {path.name}")
    return pcm


def pcm_metrics(pcm):
    count = len(pcm)
    return {
        "frames": count, "durationS": count / SAMPLE_RATE,
        "peak": max(abs(value) for value in pcm) / 32768,
        "rms": math.sqrt(sum(value * value for value in pcm) / count) / 32768,
        "dc": sum(pcm) / count / 32768,
        "clippedSamples": sum(value <= -32768 or value >= 32767 for value in pcm),
    }


def render_turn(lib, speaker_path, speaker, turn, out):
    stem = turn["id"]
    seg_path, ges_path, wav_path = (out / f"{stem}.{ext}" for ext in ("seg", "ges", "wav"))
    seg_path.write_text("".join(
        f"name = {s['phone']}; duration_s = {s['durationS']:.9f};\n" for s in turn["segments"]
    ), encoding="utf-8")
    check(lib.vtlInitialize(os.fsencode(speaker_path)), "vtlInitialize")
    try:
        constants = [ctypes.c_int() for _ in range(5)]
        internal_rate = ctypes.c_double()
        check(lib.vtlGetConstants(*(ctypes.byref(v) for v in constants), ctypes.byref(internal_rate)), "vtlGetConstants")
        if constants[0].value != SAMPLE_RATE:
            raise ValueError(f"Backend sample rate is {constants[0].value}, expected {SAMPLE_RATE}")
        anatomy = speaker.get("anatomy")
        if anatomy is not None:
            check(lib.vtlSetAnatomyFromAge(anatomy["ageMonths"], anatomy["isMale"]), "vtlSetAnatomyFromAge")
        values = (ctypes.c_double * len(ANATOMY_NAMES))()
        check(lib.vtlGetAnatomyParams(values), "vtlGetAnatomyParams")
        check(lib.vtlSegmentSequenceToGesturalScore(os.fsencode(seg_path), os.fsencode(ges_path), False), "vtlSegmentSequenceToGesturalScore")
        prosody = apply_prosody(ges_path, turn)
        check(lib.vtlGesturalScoreToAudio(os.fsencode(ges_path), os.fsencode(wav_path), None, None, False), "vtlGesturalScoreToAudio")
    finally:
        check(lib.vtlClose(), "vtlClose")
    pcm = read_pcm(wav_path)
    metrics = pcm_metrics(pcm)
    if metrics["peak"] == 0:
        raise RuntimeError(f"Turn {stem} rendered silence")
    if metrics["clippedSamples"]:
        raise RuntimeError(f"Turn {stem} clipped inside VTL; later mix gain cannot repair it")
    start_frame = round(turn["startS"] * SAMPLE_RATE)
    result = {
        "id": stem, "speakerId": speaker["id"], "text": turn["text"],
        "startS": turn["startS"], "startFrame": start_frame,
        "endS": (start_frame + len(pcm)) / SAMPLE_RATE,
        "pan": speaker["pan"], "metrics": metrics, "prosody": prosody,
        "anatomy": dict(zip(ANATOMY_NAMES, values)),
        "files": {ext: {"path": path.name, "sha256": digest(path)}
                  for ext, path in (("segments", seg_path), ("gestures", ges_path), ("wav", wav_path))},
    }
    return pcm, result


def mix_tracks(rendered, output_path):
    count = max(item[1]["startFrame"] + len(item[0]) for item in rendered)
    left, right = array.array("d", [0.0]) * count, array.array("d", [0.0]) * count
    for pcm, info in rendered:
        theta = (info["pan"] + 1) * math.pi / 4
        gl, gr = math.cos(theta) / 32768, math.sin(theta) / 32768
        offset = info["startFrame"]
        for i, value in enumerate(pcm):
            left[offset + i] += value * gl
            right[offset + i] += value * gr
    peak = max(max(map(abs, left)), max(map(abs, right)))
    if not math.isfinite(peak) or peak == 0:
        raise RuntimeError("Mixed dialogue is silent or nonfinite")
    gain = 0.92 / peak
    interleaved = array.array("h")
    channel_pcm = [array.array("h"), array.array("h")]
    for l, r in zip(left, right):
        for channel, value in enumerate((l, r)):
            quantized = round(value * gain * 32768)
            if not -32768 <= quantized <= 32767:
                raise RuntimeError("Global linear gain failed to prevent clipping")
            channel_pcm[channel].append(quantized)
            interleaved.append(quantized)
    if sys.byteorder != "little":
        interleaved.byteswap()
    with wave.open(str(output_path), "wb") as writer:
        writer.setnchannels(2)
        writer.setsampwidth(2)
        writer.setframerate(SAMPLE_RATE)
        writer.writeframes(interleaved.tobytes())
    return {
        "path": output_path.name, "sha256": digest(output_path),
        "sampleRate": SAMPLE_RATE, "channels": 2, "bitsPerSample": 16,
        "frames": count, "durationS": count / SAMPLE_RATE,
        "preGainPeak": peak, "linearGain": gain,
        "left": pcm_metrics(channel_pcm[0]), "right": pcm_metrics(channel_pcm[1]),
    }


def main(argv):
    if len(argv) != 5:
        raise ValueError("usage: vtl-dialogue.py VTL_LIB SPEAKER PLAN_JSON OUTPUT_DIR")
    lib_path, speaker_path, plan_path, out = [Path(value).resolve() for value in argv[1:]]
    for path in (lib_path, speaker_path, plan_path):
        if not path.is_file():
            raise FileNotFoundError(path)
    plan = json.loads(plan_path.read_text(encoding="utf-8"))
    speakers = validate_plan(plan)
    out.mkdir(parents=True, exist_ok=True)
    lib = load_backend(lib_path)
    version = ctypes.create_string_buffer(128)
    lib.vtlGetVersion(version)
    rendered = []
    for turn in plan["turns"]:
        rendered.append(render_turn(lib, speaker_path, speakers[turn["speakerId"]], turn, out))
        print(f"Rendered {turn['id']}: {rendered[-1][1]['metrics']['durationS']:.3f} s", flush=True)
    mixed = mix_tracks(rendered, out / "dialogue.wav")
    diagnostics = {
        "schemaVersion": 1,
        "source": "VocalTractLab articulatory synthesis; no recorded or neural speech",
        "backend": {"upstream": "TUD-STKS/VocalTractLabBackend-dev", "pinnedCommit": UPSTREAM_COMMIT,
                    "requiredPatch": {"path": "vtl-anatomy-reference.patch",
                                      "sha256": digest(Path(__file__).with_name("vtl-anatomy-reference.patch"))},
                    "apiVersion": version.value.decode("utf-8", errors="replace"),
                    "librarySha256": digest(lib_path), "speakerSha256": digest(speaker_path)},
        "planSha256": digest(plan_path), "sampleRate": SAMPLE_RATE,
        "processing": {"pitch": "VTL F0 targets in 12*log2(Hz) semitones",
                       "pressure": "backend pressure windows multiplied by requestedPa/800",
                       "mix": "equal-power pan, summation, one global linear gain, s16 quantization"},
        "speakers": plan["speakers"], "turns": [info for _, info in rendered], "mix": mixed,
    }
    (out / "diagnostics.json").write_text(json.dumps(diagnostics, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    print(json.dumps({"wav": str(out / "dialogue.wav"), "diagnostics": str(out / "diagnostics.json"),
                      "durationS": mixed["durationS"], "sha256": mixed["sha256"]}), flush=True)


if __name__ == "__main__":
    try:
        main(sys.argv)
    except (ValueError, RuntimeError, OSError, KeyError, TypeError, ET.ParseError) as exc:
        raise SystemExit(str(exc)) from exc
