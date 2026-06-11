/** Moves an element within an array from oldIndex to newIndex. Returns a new array. */
export function arrayMove<T>(arr: T[], oldIndex: number, newIndex: number): T[] {
  const result = [...arr];
  const [item] = result.splice(oldIndex, 1);
  result.splice(newIndex, 0, item);
  return result;
}
