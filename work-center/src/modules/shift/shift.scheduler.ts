import type { IShift } from './shift.model.js'

export function onShiftCreated(_shift: IShift): void {}
export function onShiftUpdated(_shift: IShift): void {}
export function onShiftDeleted(_shiftId: string): void {}
export async function startShiftScheduler(): Promise<void> {}
export async function stopShiftScheduler(): Promise<void> {}
