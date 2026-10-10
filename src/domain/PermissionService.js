/**
 * @file PermissionService.js
 * Centralized Role-Based Access Control (RBAC) service.
 * Source of truth: docs/07-rbac-matrix.md
 */

/**
 * Valid room participant roles.
 * @typedef {'host' | 'moderator' | 'participant'} Role
 */

/**
 * Granular action permissions within a room.
 * @typedef {'room.watch' | 'playback.control' | 'video.change' | 'role.assign' | 'participant.remove' | 'request.create' | 'request.resolve'} Permission
 */

export const ROLES = Object.freeze({
  HOST: 'host',
  MODERATOR: 'moderator',
  PARTICIPANT: 'participant',
});

export const PERMISSIONS = Object.freeze({
  ROOM_WATCH: 'room.watch',
  PLAYBACK_CONTROL: 'playback.control',
  VIDEO_CHANGE: 'video.change',
  ROLE_ASSIGN: 'role.assign',
  PARTICIPANT_REMOVE: 'participant.remove',
  REQUEST_CREATE: 'request.create',
  REQUEST_RESOLVE: 'request.resolve',
});

/**
 * Mapping of each role to its granted permissions (Set for O(1) lookups).
 * Matches the RBAC matrix in docs/07-rbac-matrix.md §4.
 * @type {Record<Role, ReadonlySet<Permission>>}
 */
const ROLE_PERMISSIONS = {
  [ROLES.HOST]: new Set([
    PERMISSIONS.ROOM_WATCH,
    PERMISSIONS.PLAYBACK_CONTROL,
    PERMISSIONS.VIDEO_CHANGE,
    PERMISSIONS.ROLE_ASSIGN,
    PERMISSIONS.PARTICIPANT_REMOVE,
    PERMISSIONS.REQUEST_RESOLVE,
  ]),
  [ROLES.MODERATOR]: new Set([
    PERMISSIONS.ROOM_WATCH,
    PERMISSIONS.PLAYBACK_CONTROL,
    PERMISSIONS.VIDEO_CHANGE,
    PERMISSIONS.REQUEST_RESOLVE,
  ]),
  [ROLES.PARTICIPANT]: new Set([
    PERMISSIONS.ROOM_WATCH,
    PERMISSIONS.REQUEST_CREATE,
  ]),
};

export class ForbiddenError extends Error {
  constructor(message = 'Your role does not allow this action.') {
    super(message);
    this.name = 'ForbiddenError';
    this.code = 'FORBIDDEN';
  }
}

export class PermissionService {
  /**
   * Checks whether a role has a given permission.
   * @param {Role} role - The participant's role
   * @param {Permission} permission - The permission being tested
   * @returns {boolean} True if allowed, false otherwise
   */
  static can(role, permission) {
    if (!role || !ROLE_PERMISSIONS[role]) {
      return false;
    }
    return ROLE_PERMISSIONS[role].has(permission);
  }

  /**
   * Asserts that a role has a given permission; throws ForbiddenError if not.
   * @param {Role} role - The participant's role
   * @param {Permission} permission - The permission required
   * @throws {ForbiddenError} If permission is denied
   */
  static assert(role, permission) {
    if (!this.can(role, permission)) {
      throw new ForbiddenError();
    }
  }
}
