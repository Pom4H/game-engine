#!/usr/bin/env python3
import ctypes, pathlib, sys

if len(sys.argv)!=5:
    raise SystemExit("usage: vtl-oracle.py VTL_LIB SPEAKER SEGMENT_FILE OUT_WAV")
lib_path,speaker_path,segment_path,out_wav=sys.argv[1:]
lib=ctypes.cdll.LoadLibrary(lib_path)

lib.vtlInitialize.argtypes=[ctypes.c_char_p]
lib.vtlInitialize.restype=ctypes.c_int
lib.vtlSegmentSequenceToGesturalScore.argtypes=[ctypes.c_char_p,ctypes.c_char_p]
lib.vtlSegmentSequenceToGesturalScore.restype=ctypes.c_int
lib.vtlGesturalScoreToAudio.argtypes=[ctypes.c_char_p,ctypes.c_char_p,ctypes.c_void_p,ctypes.c_void_p,ctypes.c_int]
lib.vtlGesturalScoreToAudio.restype=ctypes.c_int
lib.vtlClose.restype=ctypes.c_int

gesture=str(pathlib.Path(out_wav).with_suffix(".ges"))
for path in [speaker_path,segment_path]:
    if not pathlib.Path(path).exists(): raise FileNotFoundError(path)

rc=lib.vtlInitialize(speaker_path.encode())
if rc: raise SystemExit(f"vtlInitialize failed: {rc}")
try:
    rc=lib.vtlSegmentSequenceToGesturalScore(segment_path.encode(),gesture.encode())
    if rc: raise SystemExit(f"vtlSegmentSequenceToGesturalScore failed: {rc}")
    rc=lib.vtlGesturalScoreToAudio(gesture.encode(),out_wav.encode(),None,None,1)
    if rc: raise SystemExit(f"vtlGesturalScoreToAudio failed: {rc}")
finally:
    lib.vtlClose()
print(out_wav)
