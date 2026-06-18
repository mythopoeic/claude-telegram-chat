import { describe, it, expect } from "vitest";
import { PermissionController } from "../src/permission/controller.js";
import { FakeTransport } from "../src/transport/fake.js";
import type { ToolRequest } from "../src/session/types.js";

const quiet = { info: () => {}, warn: () => {} };
const KEY = "-100:5";
const bashReq: ToolRequest = { tool: "Bash", input: { command: "rm -rf build" }, toolUseId: "t1" };

function setup() {
  const transport = new FakeTransport();
  const controller = new PermissionController(transport, quiet);
  const handler = controller.handlerFor(-100, 5, KEY);
  return { transport, controller, handler };
}

/** Pull the callback data for a verb out of the last posted approval message. */
function buttonData(transport: FakeTransport, verb: "y" | "r" | "n"): string {
  const buttons = transport.sent.at(-1)?.buttons?.[0] ?? [];
  const found = buttons.find((b) => b.data.endsWith(`|${verb}`));
  if (!found) throw new Error(`no button for verb ${verb}`);
  return found.data;
}

describe("PermissionController approval round-trip", () => {
  it("auto-allows safe tools without posting buttons", async () => {
    const { transport, handler } = setup();
    const outcome = await handler({ tool: "Read", input: {}, toolUseId: "t" }, new AbortController().signal);
    expect(outcome.allow).toBe(true);
    expect(transport.sent).toHaveLength(0);
  });

  it("asks for a mutating tool and resolves Allow on the button press", async () => {
    const { transport, controller, handler } = setup();
    const promise = handler(bashReq, new AbortController().signal);

    // Buttons were posted and the call is still pending.
    expect(transport.sent.at(-1)?.buttons).toBeDefined();
    let settled = false;
    void promise.then(() => (settled = true));
    await Promise.resolve();
    expect(settled).toBe(false);

    expect(controller.resolveCallback(buttonData(transport, "y"))).toBe(true);
    expect(await promise).toEqual({ allow: true });
  });

  it("resolves Deny on the deny button", async () => {
    const { transport, controller, handler } = setup();
    const promise = handler(bashReq, new AbortController().signal);
    controller.resolveCallback(buttonData(transport, "n"));
    const outcome = await promise;
    expect(outcome.allow).toBe(false);
  });

  it("Allow+remember auto-allows the same tool next time (no new prompt)", async () => {
    const { transport, controller, handler } = setup();
    const first = handler(bashReq, new AbortController().signal);
    controller.resolveCallback(buttonData(transport, "r"));
    expect((await first).allow).toBe(true);
    const postedAfterFirst = transport.sent.length;

    const second = await handler(bashReq, new AbortController().signal);
    expect(second.allow).toBe(true);
    expect(transport.sent.length).toBe(postedAfterFirst); // no new approval posted
  });

  it("denies when the turn aborts while waiting", async () => {
    const { handler } = setup();
    const ac = new AbortController();
    const promise = handler(bashReq, ac.signal);
    ac.abort();
    const outcome = await promise;
    expect(outcome.allow).toBe(false);
  });

  it("finalizes the approval prompt in place after a decision", async () => {
    const { transport, controller, handler } = setup();
    const promise = handler(bashReq, new AbortController().signal);
    // let the send().then capture the message id
    await new Promise((r) => setTimeout(r, 0));

    controller.resolveCallback(buttonData(transport, "y"));
    await promise;
    await new Promise((r) => setTimeout(r, 0));

    expect(transport.edits.at(-1)?.text).toContain("allowed");
  });

  it("yolo mode auto-allows mutating tools without asking", async () => {
    const { transport, controller, handler } = setup();
    controller.setMode(KEY, "yolo");
    const outcome = await handler(bashReq, new AbortController().signal);
    expect(outcome.allow).toBe(true);
    expect(transport.sent).toHaveLength(0);
  });
});
