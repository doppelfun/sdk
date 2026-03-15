import { describe, it, expect, vi } from "vitest";
import { movementDriverTick } from "./movementDriver.js";
import { createClawStore } from "../state/index.js";
import type { DoppelClient } from "@doppelfun/sdk";

describe("movementDriverTick", () => {
  it("streams movementIntent every tick without world target (smooth stick hold)", () => {
    const sendInput = vi.fn();
    const client = { sendInput } as unknown as DoppelClient;
    const store = createClawStore("0_0");
    store.setMovementIntent({ moveX: 0.2, moveZ: 0.1, sprint: false });
    expect(movementDriverTick(client, store)).toBe(true);
    expect(sendInput).toHaveBeenCalledWith(
      expect.objectContaining({ moveX: 0.2, moveZ: 0.1, sprint: false })
    );
    sendInput.mockClear();
    expect(movementDriverTick(client, store)).toBe(true);
    expect(sendInput).toHaveBeenCalledWith(
      expect.objectContaining({ moveX: 0.2, moveZ: 0.1 })
    );
  });

  it("no-ops without movementTarget or movementIntent", () => {
    const sendInput = vi.fn();
    const client = { sendInput } as unknown as DoppelClient;
    const store = createClawStore("0_0");
    expect(movementDriverTick(client, store)).toBe(false);
    expect(sendInput).not.toHaveBeenCalled();
  });

  it("sends 0,0 during autonomous emote stand-still", () => {
    const sendInput = vi.fn();
    const client = { sendInput } as unknown as DoppelClient;
    const store = createClawStore("0_0");
    store.setAutonomousEmoteStandStillUntil(Date.now() + 5000);
    expect(movementDriverTick(client, store)).toBe(true);
    expect(sendInput).toHaveBeenCalledWith(
      expect.objectContaining({ moveX: 0, moveZ: 0, sprint: false })
    );
  });

  it("no-ops without myPosition", () => {
    const sendInput = vi.fn();
    const client = { sendInput } as unknown as DoppelClient;
    const store = createClawStore("0_0");
    store.setMovementTarget({ x: 10, z: 10 });
    expect(movementDriverTick(client, store)).toBe(false);
    expect(sendInput).not.toHaveBeenCalled();
  });

  it("sends 0,0 and clears target when within stop distance", () => {
    const sendInput = vi.fn();
    const client = { sendInput } as unknown as DoppelClient;
    const store = createClawStore("0_0");
    store.setMovementTarget({ x: 10, z: 10 });
    store.setState({ myPosition: { x: 9.5, y: 0, z: 10 }, movementStopDistanceM: 2 });
    expect(movementDriverTick(client, store)).toBe(true);
    expect(sendInput).toHaveBeenCalledWith(
      expect.objectContaining({ moveX: 0, moveZ: 0 })
    );
    expect(store.getState().movementTarget).toBeNull();
  });

  it("on arrive with pendingGoTalkToAgent sends chat then clears pending", () => {
    const sendInput = vi.fn();
    const sendChat = vi.fn();
    const sendSpeak = vi.fn();
    const client = { sendInput, sendChat, sendSpeak } as unknown as DoppelClient;
    const store = createClawStore("0_0");
    store.setMovementTarget({ x: 10, z: 10 });
    store.setState({ myPosition: { x: 9.5, y: 0, z: 10 }, movementStopDistanceM: 2 });
    store.setPendingGoTalkToAgent({ targetSessionId: "other-session", openingMessage: "Hi!" });
    expect(movementDriverTick(client, store)).toBe(true);
    expect(sendInput).toHaveBeenCalledWith(
      expect.objectContaining({ moveX: 0, moveZ: 0 })
    );
    expect(sendChat).toHaveBeenCalledWith("Hi!", { targetSessionId: "other-session" });
    expect(store.getState().movementTarget).toBeNull();
    expect(store.getState().pendingGoTalkToAgent).toBeNull();
    expect(store.getState().autonomousSeekCooldownUntil).toBeGreaterThan(Date.now());
    expect(store.getState().conversationPhase).toBe("waiting_for_reply");
    expect(store.getState().conversationPeerSessionId).toBe("other-session");
  });

  it("does not send input when far from target (server-driven move_to)", () => {
    const sendInput = vi.fn();
    const client = { sendInput } as unknown as DoppelClient;
    const store = createClawStore("0_0");
    store.setMovementTarget({ x: 50, z: 50 });
    store.setState({ myPosition: { x: 0, y: 0, z: 0 } });
    expect(movementDriverTick(client, store)).toBe(false);
    expect(sendInput).not.toHaveBeenCalled();
    expect(store.getState().movementTarget).not.toBeNull();
  });
});
