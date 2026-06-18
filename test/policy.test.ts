import { describe, it, expect } from "vitest";
import { decide, autonomyFromCommand, type PolicyState } from "../src/permission/policy.js";

const tiered = (remembered: string[] = []): PolicyState => ({
  autonomy: "tiered",
  remembered: new Set(remembered),
});

describe("decide", () => {
  it("tiered: auto-allows safe reads", () => {
    expect(decide("Read", tiered())).toBe("auto-allow");
    expect(decide("Grep", tiered())).toBe("auto-allow");
  });

  it("tiered: asks for mutating tools", () => {
    expect(decide("Bash", tiered())).toBe("ask");
    expect(decide("Edit", tiered())).toBe("ask");
    expect(decide("Write", tiered())).toBe("ask");
  });

  it("tiered: auto-allows a remembered tool", () => {
    expect(decide("Bash", tiered(["Bash"]))).toBe("auto-allow");
  });

  it("yolo: auto-allows everything", () => {
    expect(decide("Bash", { autonomy: "yolo", remembered: new Set() })).toBe("auto-allow");
    expect(decide("Write", { autonomy: "yolo", remembered: new Set() })).toBe("auto-allow");
  });

  it("careful: asks for everything, even reads", () => {
    expect(decide("Read", { autonomy: "careful", remembered: new Set() })).toBe("ask");
    expect(decide("Bash", { autonomy: "careful", remembered: new Set(["Bash"]) })).toBe("ask");
  });
});

describe("autonomyFromCommand", () => {
  it("maps command names to autonomy levels", () => {
    expect(autonomyFromCommand("yolo")).toBe("yolo");
    expect(autonomyFromCommand("careful")).toBe("careful");
    expect(autonomyFromCommand("tiered")).toBe("tiered");
    expect(autonomyFromCommand("auto")).toBe("tiered");
    expect(autonomyFromCommand("list")).toBeUndefined();
  });
});
