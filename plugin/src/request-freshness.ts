export function isCurrentRequest(
  requestGeneration: number,
  currentGeneration: number,
  requestKey: string,
  currentKey: string
): boolean {
  return requestGeneration === currentGeneration && requestKey === currentKey;
}
