import type { Occupant } from "@doppelfun/sdk";

/** Min squared distance to consider "at" an occupant; avoid jitter. */
const MIN_DISTANCE_SQ = 0.5;
/** Radius (m) within which we consider facing toward nearest occupant. */
const FACE_NEARBY_RADIUS_M = 12;

/** Parse "x,z" or "x,y,z" into { x, y, z }; y defaults to 0. Returns null if invalid. */
export function parsePositionHint(hint: string): { x: number; y: number; z: number } | null {
  const parts = hint.split(",").map((s) => s.trim()).filter(Boolean);
  if (parts.length < 2) return null;
  const x = Number(parts[0]);
  const z = Number(parts[parts.length - 1]);
  const y = parts.length >= 3 ? Number(parts[1]) : 0;
  if (!Number.isFinite(x) || !Number.isFinite(z) || !Number.isFinite(y)) return null;
  return { x, y, z };
}

/** Priority order for choosing who to move toward: 1 agents, 2 players (user), 3 NPCs/observers. */
const OCCUPANT_PRIORITY_ORDER: Array<"agent" | "user" | "observer"> = ["agent", "user", "observer"];

function nearestInGroup(
  group: Occupant[],
  myPosition: { x: number; z: number }
): Occupant | null {
  if (group.length === 0) return null;
  let nearest = group[0]!;
  let minD2 = Infinity;
  for (const o of group) {
    if (!o.position) continue;
    const dx = o.position.x - myPosition.x;
    const dz = o.position.z - myPosition.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < minD2 && d2 > MIN_DISTANCE_SQ) {
      minD2 = d2;
      nearest = o;
    }
  }
  return nearest;
}

/**
 * Find the nearest occupant (excluding self) with a position. Returns null if none or self has no position.
 */
export function findNearestOccupant(
  occupants: Occupant[],
  mySessionId: string | null,
  myPosition: { x: number; z: number } | null
): Occupant | null {
  if (!mySessionId || !myPosition) return null;
  const others = occupants.filter((o) => o.clientId !== mySessionId && o.position != null);
  if (others.length === 0) return null;
  let nearest = others[0]!;
  let minD2 = Infinity;
  for (const o of others) {
    if (!o.position) continue;
    const dx = o.position.x - myPosition.x;
    const dz = o.position.z - myPosition.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < minD2 && d2 > MIN_DISTANCE_SQ) {
      minD2 = d2;
      nearest = o;
    }
  }
  return nearest;
}

/**
 * Find the nearest occupant by priority: agents first, then players (user), then observers/NPCs.
 * Used for TryMoveToNearestOccupant and consistent with wander destination priority.
 */
export function findNearestOccupantByPriority(
  occupants: Occupant[],
  mySessionId: string | null,
  myPosition: { x: number; z: number } | null
): Occupant | null {
  if (!mySessionId || !myPosition) return null;
  const others = occupants.filter((o) => o.clientId !== mySessionId && o.position != null);
  if (others.length === 0) return null;
  for (const tier of OCCUPANT_PRIORITY_ORDER) {
    const group = others.filter((o) => o.type === tier);
    const nearest = nearestInGroup(group, myPosition);
    if (nearest) return nearest;
  }
  return nearestInGroup(others, myPosition);
}

/**
 * Y rotation (radians) to face the nearest occupant with position.
 *
 * @param occupants - All occupants (e.g. state.occupants)
 * @param mySessionId - Self session id to exclude
 * @param myPosition - Self position; must be set
 * @returns Angle in radians, or undefined if no occupant in FACE_NEARBY_RADIUS_M
 */
export function getFacingTowardNearestOccupant(
  occupants: Occupant[],
  mySessionId: string | null,
  myPosition: { x: number; z: number } | null
): number | undefined {
  if (!myPosition) return undefined;
  let nearestDist2 = FACE_NEARBY_RADIUS_M * FACE_NEARBY_RADIUS_M;
  let nearest: { x: number; z: number } | null = null;
  for (const o of occupants) {
    if (o.clientId === mySessionId || !o.position) continue;
    const dx = o.position.x - myPosition.x;
    const dz = o.position.z - myPosition.z;
    const d2 = dx * dx + dz * dz;
    if (d2 < nearestDist2 && d2 > 0.01) {
      nearestDist2 = d2;
      nearest = { x: o.position.x, z: o.position.z };
    }
  }
  if (!nearest) return undefined;
  return Math.atan2(nearest.x - myPosition.x, nearest.z - myPosition.z);
}

/**
 * Y rotation (radians) to face a specific occupant by session id.
 *
 * @returns Angle in radians, or undefined if target missing, no position, coincident, or beyond FACE_NEARBY_RADIUS_M
 */
export function getFacingTowardSessionId(
  occupants: Occupant[],
  mySessionId: string | null,
  myPosition: { x: number; z: number } | null,
  targetSessionId: string | null
): number | undefined {
  if (!myPosition || !targetSessionId || targetSessionId === mySessionId) return undefined;
  const o = occupants.find((x) => x.clientId === targetSessionId);
  if (!o?.position) return undefined;
  const dx = o.position.x - myPosition.x;
  const dz = o.position.z - myPosition.z;
  const d2 = dx * dx + dz * dz;
  const max2 = FACE_NEARBY_RADIUS_M * FACE_NEARBY_RADIUS_M;
  if (d2 > max2 || d2 <= 0.01) return undefined;
  return Math.atan2(dx, dz);
}

/**
 * True if the owner (by userId) is within radiusM of myPosition (for TimeForAutonomousWake etc).
 */
export function isOwnerNearby(
  occupants: Occupant[],
  myPosition: { x: number; z: number } | null,
  ownerUserId: string | null,
  ownerNearbyRadiusM: number
): boolean {
  if (!myPosition || !ownerUserId) return false;
  const radius2 = ownerNearbyRadiusM * ownerNearbyRadiusM;
  for (const o of occupants) {
    if (o.userId !== ownerUserId || !o.position) continue;
    const dx = o.position.x - myPosition.x;
    const dz = o.position.z - myPosition.z;
    if (dx * dx + dz * dz <= radius2) return true;
  }
  return false;
}

/**
 * True if the occupant with clientId === targetSessionId has userId === ownerUserId.
 * Used to allow DMs to owner regardless of distance (e.g. owner spectating).
 */
export function isTargetOwner(
  occupants: Occupant[],
  targetSessionId: string | null,
  ownerUserId: string | null
): boolean {
  if (!targetSessionId || !ownerUserId) return false;
  const o = occupants.find((x) => x.clientId === targetSessionId);
  return o != null && o.userId === ownerUserId;
}

/**
 * True if the occupant with clientId === targetSessionId has a position and is within radiusM of myPosition.
 * Used to enforce "only chat with nearby agents" (agents must be in earshot).
 */
export function isOccupantNearby(
  occupants: Occupant[],
  myPosition: { x: number; z: number } | null,
  targetSessionId: string | null,
  radiusM: number
): boolean {
  if (!myPosition || !targetSessionId || radiusM <= 0) return false;
  const o = occupants.find((x) => x.clientId === targetSessionId);
  if (!o?.position) return false;
  const dx = o.position.x - myPosition.x;
  const dz = o.position.z - myPosition.z;
  const radius2 = radiusM * radiusM;
  return dx * dx + dz * dz <= radius2;
}
