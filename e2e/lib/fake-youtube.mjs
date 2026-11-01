// A stand-in for YouTube's IFrame API (no network in the suites): a box per
// player, its state on data-state, play/pause/seek kept by the clock.
export const FAKE_YT = `
window.YT = { Player: class {
  constructor(el, o) {
    this.o = o; this.t = 0; this.state = -1;
    const d = document.createElement("div");
    d.dataset.testid = "fake-youtube"; d.dataset.video = o.videoId; d.dataset.host = o.host || "";
    d.style.cssText = "width:100%;height:100%;background:#234";
    el.replaceWith(d); this.el = d;
    setTimeout(() => { o.events.onReady && o.events.onReady(); if (o.playerVars && o.playerVars.autoplay) this.playVideo(); }, 50);
  }
  emit(s) { this.state = s; this.el.dataset.state = String(s); this.o.events.onStateChange && this.o.events.onStateChange({ data: s }); }
  playVideo() { if (this.state === 1) return; this.start = Date.now() - this.t * 1000; this.emit(1); }
  pauseVideo() { this.t = this.getCurrentTime(); this.emit(2); }
  seekTo(s) { this.t = s; if (this.state === 1) this.start = Date.now() - s * 1000; }
  getCurrentTime() { return this.state === 1 ? (Date.now() - this.start) / 1000 : this.t; }
  getDuration() { return 212; }
  getPlaybackRate() { return this.rate ?? 1; }
  setPlaybackRate(rate) { this.rate = rate; }
  cueVideoById(id) { this.el.dataset.video = id; this.t = 0; this.emit(5); }
  loadVideoById(id) { this.cueVideoById(id); this.playVideo(); }
  destroy() { this.el.remove(); }
} };
window.onYouTubeIframeAPIReady && window.onYouTubeIframeAPIReady();
`;
