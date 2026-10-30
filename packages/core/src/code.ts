import { z } from 'zod'

// A code names a record to people, barcode scanners and other systems (SAP, SCADA, PLC), so it has
// one spelling: upper case English letters, digits and - _ . / Lower case input is stored in upper
// case; any other character, a Turkish letter included, is rejected rather than guessed.
export const codeSchema = z
  .string()
  .trim()
  .toUpperCase()
  .min(1)
  .max(64)
  .regex(/^[A-Z0-9._/-]+$/, { message: 'error.invalid_code' })
