/**
 * @file PlaybackState.js
 * Model representing the synchronized video playback anchor.
 * Source of truth: docs/02-architecture.md §9.1 and docs/04-websocket-events.md §1
 */

/**
 * @typedef {'playing' | 'paused'} PlayState
 */

/**
 * @typedef {Object} SyncStateDTO
 * @property {PlayState} playState
 * @property {number} currentTime
 * @property {string|null} videoId
 * @property {number} updatedAt
 */

export class PlaybackState {
  /**
   * @param {Object} [params]
   * @param {string|null} [params.videoId=null]
   * @param {PlayState} [params.playState='paused']
   * @param {number} [params.currentTime=0] - Anchor position in seconds at updatedAt
   * @param {number} [params.updatedAt=Date.now()] - Server epoch ms when anchor was set
   */
  constructor({
    videoId = null,
    playState = 'paused',
    currentTime = 0,
    updatedAt = Date.now(),
  } = {}) {
    this.videoId = videoId;
    this.playState = playState;
    this.currentTime = currentTime;
    this.updatedAt = updatedAt;
  }

  /**
   * Computes the live playback position in seconds without running any server timers.
   * If playing: currentTime + (now - updatedAt) / 1000
   * If paused: currentTime
   * @param {number} [now=Date.now()] - Current epoch ms (passable for deterministic testing)
   * @returns {number}
   */
  liveTime(now = Date.now()) {
    if (this.playState !== 'playing') {
      return this.currentTime;
    }
    const elapsedSeconds = Math.max(0, (now - this.updatedAt) / 1000);
    return this.currentTime + elapsedSeconds;
  }

  /**
   * Transitions playback state to playing.
   * @param {number|null} [optionalCurrentTime=null] - Sender's player position if provided
   * @param {number} [now=Date.now()]
   */
  play(optionalCurrentTime = null, now = Date.now()) {
    const timeToAnchor = optionalCurrentTime !== null ? optionalCurrentTime : this.liveTime(now);
    this.currentTime = timeToAnchor;
    this.playState = 'playing';
    this.updatedAt = now;
  }

  /**
   * Transitions playback state to paused, freezing position at liveTime.
   * @param {number|null} [optionalCurrentTime=null]
   * @param {number} [now=Date.now()]
   */
  pause(optionalCurrentTime = null, now = Date.now()) {
    const timeToAnchor = optionalCurrentTime !== null ? optionalCurrentTime : this.liveTime(now);
    this.currentTime = timeToAnchor;
    this.playState = 'paused';
    this.updatedAt = now;
  }

  /**
   * Scrubs playback position to a specific second mark.
   * Play state remains unchanged.
   * @param {number} time
   * @param {number} [now=Date.now()]
   */
  seek(time, now = Date.now()) {
    this.currentTime = Math.max(0, time);
    this.updatedAt = now;
  }

  /**
   * Loads a new video ID. Resets playback to paused at 0:00 (per doc 04 §4.7).
   * @param {string} videoId
   * @param {number} [now=Date.now()]
   */
  changeVideo(videoId, now = Date.now()) {
    this.videoId = videoId;
    this.currentTime = 0;
    this.playState = 'paused';
    this.updatedAt = now;
  }

  /**
   * Serializes the playback anchor into the View/DTO required by clients.
   * @param {number} [now=Date.now()]
   * @returns {SyncStateDTO}
   */
  toSyncState(now = Date.now()) {
    return {
      playState: this.playState,
      currentTime: Number(this.liveTime(now).toFixed(2)),
      videoId: this.videoId,
      updatedAt: this.updatedAt,
    };
  }
}
