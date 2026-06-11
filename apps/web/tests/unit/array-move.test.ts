import { describe, it, expect } from "vitest";
import { arrayMove } from "@/lib/array-move";

describe("arrayMove", () => {
  it("moves element forward", () => {
    expect(arrayMove(["a", "b", "c", "d"], 0, 2)).toEqual(["b", "c", "a", "d"]);
  });

  it("moves element backward", () => {
    expect(arrayMove(["a", "b", "c", "d"], 3, 1)).toEqual(["a", "d", "b", "c"]);
  });

  it("returns new array (no mutation)", () => {
    const arr = ["a", "b", "c"];
    const result = arrayMove(arr, 0, 2);
    expect(arr).toEqual(["a", "b", "c"]); // original unchanged
    expect(result).toEqual(["b", "c", "a"]);
  });
});
