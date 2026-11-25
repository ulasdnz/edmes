export function goodQuantity(input: { gross: number; scrap: number; adjustments: number }): number {
  return input.gross - input.scrap + input.adjustments
}
