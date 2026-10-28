/** Frozen full pre-change compiled PlaybackClock from dist/network/playback.js
 * SHA256 7605cd9d9f4350b735699d5c9d9cf27adf43b063a49b42b1465601ef92b47aa3.
 * Only the unrelated module import and following Replica declaration are omitted. */
/** Adapted from thegame PlaybackClock at 4e7a577. Wall-time arrival never becomes render time.
 * No extrapolation after the newest cause; starvation is observable, not fabricated motion. */
export class PlaybackClock {
    delaySeconds;
    latest = 0;
    received = null;
    anchor = null;
    value = null;
    sampled = null;
    calibrated = false;
    rate = 1;
    heldFrames = 0;
    constructor(delaySeconds = .1) {
        this.delaySeconds = delaySeconds;
        if (!Number.isFinite(delaySeconds) || delaySeconds < 0 || delaySeconds > 2)
            throw new RangeError('Invalid presentation delay');
    }
    observe(time, now) {
        if (!Number.isFinite(time) || time < 0 || !Number.isFinite(now))
            throw new TypeError('Invalid clock observation');
        if (!this.anchor || this.received !== null && now - this.received > 2)
            this.anchor = { time, at: now };
        else {
            const elapsed = now - this.anchor.at;
            if (elapsed >= .25) {
                const measured = Math.max(.02, Math.min(1.25, (time - this.anchor.time) / elapsed));
                this.rate += (measured - this.rate) * (this.calibrated ? 1 - Math.exp(-elapsed / .75) : 1);
                this.calibrated = true;
                this.anchor = { time, at: now };
            }
        }
        this.latest = time;
        this.received = now;
    }
    sample(now) {
        if (!Number.isFinite(now))
            throw new TypeError('Invalid presentation timestamp');
        if (this.received === null)
            return 0;
        const target = Math.max(0, Math.min(this.latest, this.latest - this.delaySeconds + Math.max(0, now - this.received) * this.rate)), previous = this.value;
        if (previous === null)
            this.value = target;
        else {
            const dt = Math.max(0, now - (this.sampled ?? now)), correction = Math.max(.25, Math.min(1.25, 1 + (target - previous) * 6));
            this.value = dt > 1 ? Math.max(previous, target) : Math.max(previous, Math.min(this.latest, previous + dt * this.rate * correction));
            if (this.value <= previous + 1e-10 && dt > 0)
                this.heldFrames++;
        }
        this.sampled = now;
        return this.value;
    }
    reset() { this.latest = 0; this.received = null; this.anchor = null; this.value = null; this.sampled = null; this.calibrated = false; this.rate = 1; this.heldFrames = 0; }
}
