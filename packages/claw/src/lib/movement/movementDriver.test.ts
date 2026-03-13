import { describe, it, expect, vi } from "vitest";
import { movementDriverTick } from "./movementDriver.js";
import { createInitialState } from "../state/state.js";
import type { DoppelClient } from "@doppelfun/sdk";

describe("movementDriverTick", () => {
  it("streams movementIntent every tick without world target (smooth stick hold)", () => {
    const sendInput = vi.fn();
    const client = { sendInput } as unknown as DoppelClient;
    const state = createInitialState("0_0");
    state.movementIntent = { moveX: 0.2, moveZ: 0.1, sprint: false };
    expect(movementDriverTick(client, state)).toBe(true);
    expect(sendInput).toHaveBeenCalledWith(
      expect.objectContaining({ moveX: 0.2, moveZ: 0.1, sprint: false })
    );
    sendInput.mockClear();
    expect(movementDriverTick(client, state)).toBe(true);
    expect(sendInput).toHaveBeenCalledWith(
      expect.objectContaining({ moveX: 0.2, moveZ: 0.1 })
    );
  });

  it("no-ops without movementTarget or movementIntent", () => {
    const sendInput = vi.fn();
    const client = { sendInput } as unknown as DoppelClient;
    const state = createInitialState("0_0");
    expect(movementDriverTick(client, state)).toBe(false);
    expect(sendInput).not.toHaveBeenCalled();
  });

  it("sends 0,0 during autonomous emote stand-still", () => {
    const sendInput = vi.fn();
    const client = { sendInput } as unknown as DoppelClient;
    const state = createInitialState("0_0");
    state.autonomousEmoteStandStillUntil = Date.now() + 5000;
    expect(movementDriverTick(client, state)).toBe(true);
    expect(sendInput).toHaveBeenCalledWith(
      expect.objectContaining({ moveX: 0, moveZ: 0, sprint: false })
    );
  });

  it("no-ops without myPosition", () => {
    const sendInput = vi.fn();
    const client = { sendInput } as unknown as DoppelClient;
    const state = createInitialState("0_0");
    state.movementTarget = { x: 10, z: 10 };
    expect(movementDriverTick(client, state)).toBe(false);
    expect(sendInput).not.toHaveBeenCalled();
  });

  it("sends 0,0 and clears target when within stop distance", () => {
    const sendInput = vi.fn();
    const client = { sendInput } as unknown as DoppelClient;
    const state = createInitialState("0_0");
    state.movementTarget = { x: 10, z: 10 };
    state.myPosition = { x: 9.5, y: 0, z: 10 };
    state.movementStopDistanceM = 2;
    expect(movementDriverTick(client, state)).toBe(true);
    expect(sendInput).toHaveBeenCalledWith(
      expect.objectContaining({ moveX: 0, moveZ: 0 })
    );
    expect(state.movementTarget).toBeNull();
  });

  it("on arrive with pendingGoTalkToAgent sends chat then clears pending", () => {
    const sendInput = vi.fn();
    const sendChat = vi.fn();
    const sendSpeak = vi.fn();
    const client = { sendInput, sendChat, sendSpeak } as unknown as DoppelClient;
    const state = createInitialState("0_0");
    state.movementTarget = { x: 10, z: 10 };
    state.myPosition = { x: 9.5, y: 0, z: 10 };
    state.movementStopDistanceM = 2;
    state.pendingGoTalkToAgent = { targetSessionId: "other-session", openingMessage: "Hi!" };
    expect(movementDriverTick(client, state)).toBe(true);
    expect(sendInput).toHaveBeenCalledWith(
      expect.objectContaining({ moveX: 0, moveZ: 0 })
    );
    expect(sendChat).toHaveBeenCalledWith("Hi!", { targetSessionId: "other-session" });
    expect(state.movementTarget).toBeNull();
    expect(state.pendingGoTalkToAgent).toBeNull();
    expect(state.autonomousSeekCooldownUntil).toBeGreaterThan(Date.now());
    expect(state.conversationPhase).toBe("waiting_for_reply");
    expect(state.conversationPeerSessionId).toBe("other-session");
  });

  it("sends non-zero input when far from target", () => {
    const sendInput = vi.fn();
    const client = { sendInput } as unknown as DoppelClient;
    const state = createInitialState("0_0");
    state.movementTarget = { x: 50, z: 50 };
    state.myPosition = { x: 0, y: 0, z: 0 };
    expect(movementDriverTick(client, state)).toBe(true);
    expect(sendInput).toHaveBeenCalled();
    const arg = sendInput.mock.calls[0]![0] as { moveX: number; moveZ: number };
    expect(Math.abs(arg.moveX)).toBeGreaterThan(0);
    expect(Math.abs(arg.moveZ)).toBeGreaterThan(0);
    expect(state.movementTarget).not.toBeNull();
  });
});
