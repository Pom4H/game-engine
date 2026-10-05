/** Numerical observations from Story (2008), Table I/II, DOI
 * 10.1121/1.2805683; https://pmc.ncbi.nlm.nih.gov/articles/PMC2377017/
 * MRI acquisition: one adult male speaker, 2002. Not universal phoneme anatomy:
 * the paper documents pharyngealized/yawny vowel settings.
 * Area [cm²], glottis-to-lips; length [cm]; calculated formants [Hz].
 * These are measurements, not copied synthesis code or stored speech audio.
 */
export const NATIVE_VOWEL_SECTIONS=44;
export type MeasuredVowel='i'|'ih'|'e'|'eh'|'ae'|'uh'|'aa'|'aw'|'o'|'uu'|'u';
export const NATIVE_VOWEL_REFERENCE=Object.freeze({
  i:Object.freeze({lengthCm:16.9,formantsHz:Object.freeze([325,2139,2976]),areaCm2:Object.freeze([0.51,0.59,0.62,0.72,1.24,2.3,3.3,3.59,3.22,2.86,3.0,3.61,4.39,4.95,5.17,5.16,5.18,5.26,5.2,5.02,4.71,4.13,3.43,2.83,2.32,1.83,1.46,1.23,1.08,0.94,0.8,0.67,0.55,0.46,0.4,0.36,0.35,0.35,0.38,0.51,0.74,0.92,0.96,0.91])}),
  ih:Object.freeze({lengthCm:16.55,formantsHz:Object.freeze([413,2103,2626]),areaCm2:Object.freeze([0.28,0.21,0.21,0.3,0.47,0.71,1.12,1.48,1.35,1.05,0.92,0.92,1.19,1.94,2.83,3.31,3.48,3.6,3.64,3.49,3.2,2.9,2.59,2.21,1.87,1.54,1.2,0.92,0.74,0.59,0.52,0.54,0.59,0.65,0.71,0.67,0.61,0.57,0.5,0.48,0.54,0.73,0.93,0.82])}),
  e:Object.freeze({lengthCm:16.98,formantsHz:Object.freeze([484,1887,2404]),areaCm2:Object.freeze([0.29,0.26,0.3,0.4,0.55,0.74,0.99,1.09,0.9,0.69,0.77,1.31,2.13,2.74,3.03,3.23,3.33,3.27,3.09,2.84,2.66,2.46,2.14,1.79,1.44,1.17,1.0,0.88,0.8,0.81,0.85,0.84,0.86,0.96,1.18,1.35,1.48,1.62,1.49,1.29,1.24,1.17,1.04,0.95])}),
  eh:Object.freeze({lengthCm:17.3,formantsHz:Object.freeze([565,1595,2200]),areaCm2:Object.freeze([0.37,0.3,0.24,0.23,0.29,0.41,0.58,0.82,0.97,0.82,0.62,0.54,0.54,0.68,1.09,1.62,2.03,2.35,2.51,2.39,2.22,2.13,2.0,1.78,1.58,1.43,1.31,1.23,1.24,1.38,1.61,1.82,1.96,2.01,2.0,1.95,1.77,1.48,1.3,1.21,1.1,0.99,0.91,0.78])}),
  ae:Object.freeze({lengthCm:16.11,formantsHz:Object.freeze([810,1655,2310]),areaCm2:Object.freeze([0.31,0.21,0.18,0.23,0.33,0.5,0.78,0.96,0.85,0.63,0.46,0.36,0.33,0.46,0.73,1.0,1.3,1.66,1.97,2.06,2.03,2.01,1.89,1.66,1.49,1.42,1.37,1.34,1.41,1.58,1.82,2.19,2.63,2.97,3.17,3.4,3.56,3.57,3.58,3.44,3.15,3.38,3.99,4.17])}),
  uh:Object.freeze({lengthCm:17.14,formantsHz:Object.freeze([593,836,3099]),areaCm2:Object.freeze([0.23,0.34,0.47,0.6,0.77,1.06,1.26,1.09,0.8,0.65,0.56,0.47,0.37,0.24,0.17,0.18,0.23,0.27,0.28,0.29,0.33,0.52,0.97,1.5,1.91,2.23,2.65,3.29,4.13,5.0,5.77,6.33,6.61,6.63,6.45,6.04,5.39,4.42,3.29,2.37,1.74,1.36,1.17,0.99])}),
  aa:Object.freeze({lengthCm:17.09,formantsHz:Object.freeze([694,942,2948]),areaCm2:Object.freeze([0.56,0.62,0.66,0.78,0.97,1.16,1.12,0.82,0.55,0.45,0.37,0.29,0.21,0.15,0.16,0.25,0.34,0.43,0.54,0.61,0.67,0.98,1.76,2.75,3.52,4.08,4.74,5.61,6.6,7.61,8.48,9.06,9.29,9.26,9.06,8.64,7.91,6.98,6.02,5.13,4.55,4.52,4.71,4.72])}),
  aw:Object.freeze({lengthCm:17.4,formantsHz:Object.freeze([557,709,3176]),areaCm2:Object.freeze([0.27,0.43,0.54,0.67,0.83,0.92,0.89,0.73,0.55,0.44,0.37,0.28,0.18,0.14,0.15,0.14,0.13,0.14,0.18,0.2,0.23,0.49,1.03,1.58,2.06,2.61,3.35,4.34,5.51,6.7,7.75,8.63,9.29,9.59,9.42,8.78,7.82,6.5,4.95,3.47,2.15,1.38,1.11,0.9])}),
  o:Object.freeze({lengthCm:18.33,formantsHz:Object.freeze([499,768,2421]),areaCm2:Object.freeze([0.38,0.45,0.57,0.77,1.31,1.92,1.74,1.11,0.75,0.59,0.57,0.68,0.73,0.67,0.58,0.49,0.44,0.42,0.49,0.53,0.38,0.3,0.45,0.61,0.71,0.79,0.86,1.01,1.41,2.09,3.0,4.1,5.16,6.22,7.34,8.15,8.61,8.37,6.76,4.37,2.3,1.06,0.58,0.47])}),
  uu:Object.freeze({lengthCm:19.34,formantsHz:Object.freeze([477,789,2499]),areaCm2:Object.freeze([0.37,0.38,0.49,0.62,0.85,1.28,1.62,1.47,1.04,0.81,1.03,1.44,1.49,1.28,1.06,0.85,0.69,0.56,0.42,0.27,0.27,0.41,0.51,0.49,0.47,0.5,0.58,0.8,1.19,1.62,2.27,3.24,4.16,5.0,5.7,6.11,6.21,6.29,6.24,4.91,2.61,1.09,0.63,0.59])}),
  u:Object.freeze({lengthCm:19.59,formantsHz:Object.freeze([314,702,2298]),areaCm2:Object.freeze([0.54,0.61,0.66,0.75,1.13,1.99,2.83,2.9,2.52,2.4,2.83,3.56,3.99,3.89,3.5,3.04,2.64,2.44,2.31,2.07,1.8,1.52,1.14,0.74,0.42,0.22,0.14,0.2,0.47,0.89,1.15,1.42,2.17,3.04,3.69,4.7,5.74,5.41,3.82,2.34,1.35,0.65,0.29,0.16])}),
});
/** Axial normalization onto a voice's fixed tract length is an explicit
 * approximation. Reference experiments use each vowel's published length.
 * Schwa is an authored neutral mean, not a measurement in this paper. */
export function nativeVowelArea(vowel:MeasuredVowel|'schwa'):Float64Array {
  if(vowel==='schwa')return Float64Array.from({length:44},(_,i)=>
    (NATIVE_VOWEL_REFERENCE.ih.areaCm2[i]!+NATIVE_VOWEL_REFERENCE.uh.areaCm2[i]!+NATIVE_VOWEL_REFERENCE.ae.areaCm2[i]!)/3);
  const reference=NATIVE_VOWEL_REFERENCE[vowel];if(!reference)throw new RangeError('Unknown measured vowel '+vowel);
  return Float64Array.from(reference.areaCm2);
}
