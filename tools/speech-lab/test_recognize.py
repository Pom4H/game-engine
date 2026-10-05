"""Decoder and evaluator regressions without importing/downloading an ASR model."""
import importlib.util
from pathlib import Path
import tempfile
import unittest
import wave

import numpy as np

spec = importlib.util.spec_from_file_location('recognize', Path(__file__).with_name('recognize.py'))
recognizer = importlib.util.module_from_spec(spec)
spec.loader.exec_module(recognizer)


class DecoderTests(unittest.TestCase):
    def write_wav(self, path, rate, samples):
        samples = np.asarray(samples, dtype='<i2')
        with wave.open(str(path), 'wb') as writer:
            writer.setnchannels(samples.shape[1] if samples.ndim == 2 else 1)
            writer.setsampwidth(2)
            writer.setframerate(rate)
            writer.writeframes(samples.tobytes())

    def test_mono_16k_preserves_every_pcm_sample(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'mono.wav'
            source = (np.arange(1600, dtype=np.int16) - 800) * 20
            self.write_wav(path, 16000, source)
            result = recognizer.decode_pcm(path)
            self.assertEqual(result.dtype, np.float32)
            np.testing.assert_array_equal(result, source.astype(np.float32)/32768)

    def test_stereo_downmix_does_not_discard_a_channel_or_trim(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'stereo.wav'
            t = np.arange(4410)/44100
            a = (8000*np.sin(2*np.pi*440*t)).astype(np.int16)
            self.write_wav(path, 44100, np.column_stack((a, -a)))
            result = recognizer.decode_pcm(path)
            self.assertEqual(len(result), 1600)
            np.testing.assert_array_equal(result, np.zeros(1600, dtype=np.float32))

    def test_truncation_is_an_error_not_an_asr_score(self):
        with tempfile.TemporaryDirectory() as folder:
            path = Path(folder) / 'truncated.wav'
            self.write_wav(path, 44100, np.zeros((4410, 2), dtype=np.int16))
            path.write_bytes(path.read_bytes()[:-100])
            with self.assertRaisesRegex(ValueError, 'Truncated'):
                recognizer.decode_pcm(path)

    def test_word_errors_preserve_insertions_deletions_and_substitutions(self):
        self.assertEqual(recognizer.edits(['tea'], []), 1)
        self.assertEqual(recognizer.edits(['tea'], ['tea', 'tea', 'tea']), 2)
        self.assertEqual(recognizer.edits(['tea'], ['key']), 1)
        self.assertEqual(recognizer.words('Give me tea!'), ['give', 'me', 'tea'])


if __name__ == '__main__':
    unittest.main()
