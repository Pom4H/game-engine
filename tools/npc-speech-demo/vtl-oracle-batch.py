#!/usr/bin/env python3
import ctypes, pathlib, sys

if len(sys.argv)!=4:
    raise SystemExit("usage: vtl-oracle-batch.py VTL_LIB SPEAKER OUT_DIR")
lib_path,speaker_path,out_dir=sys.argv[1:]
out=pathlib.Path(out_dir);out.mkdir(parents=True,exist_ok=True)
lib=ctypes.cdll.LoadLibrary(lib_path)
lib.vtlInitialize.argtypes=[ctypes.c_char_p];lib.vtlInitialize.restype=ctypes.c_int
lib.vtlSegmentSequenceToGesturalScore.argtypes=[ctypes.c_char_p,ctypes.c_char_p];lib.vtlSegmentSequenceToGesturalScore.restype=ctypes.c_int
lib.vtlGesturalScoreToAudio.argtypes=[ctypes.c_char_p,ctypes.c_char_p,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_int];lib.vtlGesturalScoreToAudio.restype=ctypes.c_int
lib.vtlClose.restype=ctypes.c_int

cases={
  "nana":["n","a","n","a"],
  "lala":["l","a","l","a"],
  "papa":["p","a","p","a"],
  "ala":["a","l","a"],
  "ana":["a","n","a"],
  "mama":["m","a","m","a"],
}
for name,phones in cases.items():
    seg=out/f"{name}.seg";ges=out/f"{name}.ges";wav=out/f"{name}.wav"
    lines=["name = ; duration_s = 0.120000;"]
    for phone in phones:
        dur=.18 if phone in {"m","n","l","p"} else .30
        lines.append(f"name = {phone}; duration_s = {dur:.6f};")
    lines.append("name = ; duration_s = 0.180000;")
    seg.write_text("\n".join(lines)+"\n")
    rc=lib.vtlInitialize(speaker_path.encode())
    if rc: raise SystemExit(f"init failed {rc}")
    try:
        rc=lib.vtlSegmentSequenceToGesturalScore(str(seg).encode(),str(ges).encode())
        if rc: raise SystemExit(f"segment->gesture failed {name}: {rc}")
        rc=lib.vtlGesturalScoreToAudio(str(ges).encode(),str(wav).encode(),None,None,0)
        if rc: raise SystemExit(f"gesture->wav failed {name}: {rc}")
    finally:
        lib.vtlClose()
print(out)
