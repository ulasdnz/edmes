// The ablative suffix ("-dan", "-den", "-tan", "-ten") of a clock time follows the last number
// spoken: "10:31" is read "on otuz bir" and takes "-den"; "10:00" is read "on" and takes "-dan".
// Vowel harmony and the voiceless ending of that word decide the suffix.
const UNITS = ['dan', 'den', 'den', 'ten', 'ten', 'ten', 'dan', 'den', 'den', 'dan'] as const
//              sıfır  bir    iki    üç     dört   beş    altı   yedi   sekiz  dokuz
const TENS = ['', 'dan', 'den', 'dan', 'tan', 'den'] as const
//                on     yirmi  otuz   kırk   elli

function suffixOf(n: number): string {
  if (n === 0) return UNITS[0]
  if (n % 10 !== 0) return UNITS[n % 10] ?? UNITS[0]
  return TENS[n / 10] ?? UNITS[0]
}

// "HH:mm" (or "HH:mm:ss"): the last group that is not zero is the last number spoken; all zero
// is read "sıfır"
export function turkishAblativeSuffix(time: string): string {
  const groups = time.split(':').map(Number)
  const spoken = groups.findLast(n => n !== 0) ?? 0
  return suffixOf(spoken)
}
