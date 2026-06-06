export class AudioSystem {
  constructor(initialSettings) {
    this.muted = Boolean(initialSettings?.muted);
    this.musicVolume = Number.isFinite(initialSettings?.musicVolume) ? initialSettings.musicVolume : 0.45;
    this.context = null;
    this.masterGain = null;
    this.musicGain = null;
    this.musicAudio = null;
    this.generatedMusicTimer = 0;
    this.generatedStep = 0;
    this.currentSong = null;
    this.effectGates = new Map();
    this.specialGrenadeClipSrc = "./sounds/greande.mp3";
  }

  async unlock() {
    if (!window.AudioContext && !window.webkitAudioContext) {
      return;
    }

    if (!this.context) {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      this.context = new AudioContextCtor();
      this.masterGain = this.context.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.14;
      this.masterGain.connect(this.context.destination);
      this.musicGain = this.context.createGain();
      this.musicGain.gain.value = this.muted ? 0 : this.musicVolume * 0.18;
      this.musicGain.connect(this.context.destination);
    }

    if (this.context.state === "suspended") {
      await this.context.resume();
    }
  }

  setMuted(nextMuted) {
    this.muted = nextMuted;
    if (this.masterGain) {
      this.masterGain.gain.value = nextMuted ? 0 : 0.14;
    }
    if (this.musicGain) {
      this.musicGain.gain.value = nextMuted ? 0 : this.musicVolume * 0.18;
    }
    if (this.musicAudio) {
      this.musicAudio.muted = nextMuted;
    }
  }

  setMusicVolume(volume) {
    this.musicVolume = Math.max(0, Math.min(1, Number(volume) || 0));
    if (this.musicGain) {
      this.musicGain.gain.value = this.muted ? 0 : this.musicVolume * 0.18;
    }
    if (this.musicAudio) {
      this.musicAudio.volume = this.muted ? 0 : this.musicVolume;
    }
  }

  async playMusic(song) {
    this.currentSong = song;
    this.stopMusic();
    if (!song || this.muted) {
      return;
    }
    await this.unlock();
    if (song.src) {
      this.musicAudio = new Audio(song.src);
      this.musicAudio.loop = true;
      this.musicAudio.volume = this.musicVolume;
      this.musicAudio.muted = this.muted;
      this.musicAudio.play().catch(() => {});
      return;
    }
    this.startGeneratedMusic(song.id);
  }

  stopMusic() {
    if (this.musicAudio) {
      this.musicAudio.pause();
      this.musicAudio.src = "";
      this.musicAudio = null;
    }
    if (this.generatedMusicTimer) {
      window.clearInterval(this.generatedMusicTimer);
      this.generatedMusicTimer = 0;
    }
  }

  startGeneratedMusic(songId) {
    if (!this.context || !this.musicGain) {
      return;
    }
    const patterns = {
      "arcade-pulse": [196, 247, 294, 247, 330, 294, 247, 220],
      "neon-run": [262, 330, 392, 494, 392, 330, 294, 330],
      "boss-voltage": [110, 147, 165, 196, 165, 147, 123, 147],
    };
    const pattern = patterns[songId] ?? patterns["arcade-pulse"];
    const playStep = () => {
      if (this.muted || !this.context || !this.musicGain) {
        return;
      }
      const now = this.context.currentTime;
      const note = pattern[this.generatedStep % pattern.length];
      this.generatedStep += 1;
      const oscillator = this.context.createOscillator();
      const volume = this.context.createGain();
      oscillator.type = songId === "boss-voltage" ? "sawtooth" : "triangle";
      oscillator.frequency.setValueAtTime(note, now);
      volume.gain.setValueAtTime(0.0001, now);
      volume.gain.exponentialRampToValueAtTime(0.12, now + 0.02);
      volume.gain.exponentialRampToValueAtTime(0.0001, now + 0.22);
      oscillator.connect(volume);
      volume.connect(this.musicGain);
      oscillator.start(now);
      oscillator.stop(now + 0.25);
    };
    playStep();
    this.generatedMusicTimer = window.setInterval(playStep, 260);
  }

  canPlayEffect(key, interval = 0) {
    if (!this.context) {
      return false;
    }
    const now = this.context.currentTime;
    const previous = this.effectGates.get(key) ?? -Infinity;
    if (now - previous < interval) {
      return false;
    }
    this.effectGates.set(key, now);
    return true;
  }

  playShoot() {
    if (!this.canPlayEffect("shoot", 0.035)) {
      return;
    }
    this.playTone({ frequency: 760, endFrequency: 410, duration: 0.075, gain: 0.1, type: "triangle" });
    this.playTone({ frequency: 1160, endFrequency: 760, duration: 0.045, gain: 0.04, type: "sine", delay: 0.018 });
  }

  playSlash() {
    if (!this.canPlayEffect("slash", 0.07)) {
      return;
    }
    this.playTone({ frequency: 420, endFrequency: 980, duration: 0.11, gain: 0.08, type: "sawtooth" });
    this.playTone({ frequency: 740, endFrequency: 1220, duration: 0.09, gain: 0.045, type: "sine", delay: 0.025 });
    this.playNoise({ duration: 0.06, gain: 0.035, filterFrequency: 2600, filterType: "highpass" });
  }

  playHit() {
    if (!this.canPlayEffect("hit", 0.035)) {
      return;
    }
    const impact = 170 + Math.random() * 70;
    this.playTone({ frequency: impact, endFrequency: 80, duration: 0.09, gain: 0.055, type: "square" });
    this.playNoise({ duration: 0.045, gain: 0.04, filterFrequency: 900, filterType: "bandpass" });
  }

  playEnemyDeath() {
    if (!this.canPlayEffect("enemy-death", 0.045)) {
      return;
    }
    const start = 340 + Math.random() * 170;
    this.playTone({ frequency: start, endFrequency: start * 1.75, duration: 0.08, gain: 0.055, type: "triangle" });
    this.playNoise({ duration: 0.055, gain: 0.026, filterFrequency: 1500, filterType: "bandpass", delay: 0.015 });
  }

  playBossDeath() {
    if (!this.canPlayEffect("boss-death", 0.5)) {
      return;
    }
    this.playNoise({ duration: 0.38, gain: 0.16, filterFrequency: 420, filterType: "lowpass" });
    this.playTone({ frequency: 190, endFrequency: 55, duration: 0.48, gain: 0.16, type: "sawtooth" });
    this.playTone({ frequency: 285, endFrequency: 80, duration: 0.42, gain: 0.09, type: "triangle", delay: 0.04 });
    this.playTone({ frequency: 760, endFrequency: 1180, duration: 0.18, gain: 0.055, type: "sine", delay: 0.22 });
  }

  playGold(doubleGold = false) {
    if (doubleGold) {
      this.playDoubleGold();
      return;
    }
    if (!this.canPlayEffect("gold", 0.045)) {
      return;
    }
    this.playTone({ frequency: 1180, endFrequency: 1680, duration: 0.08, gain: 0.05, type: "sine" });
    this.playTone({ frequency: 1680, endFrequency: 1320, duration: 0.09, gain: 0.04, type: "triangle", delay: 0.055 });
  }

  playPickup() {
    if (!this.canPlayEffect("pickup", 0.045)) {
      return;
    }
    this.playTone({ frequency: 720, endFrequency: 980, duration: 0.055, gain: 0.032, type: "sine" });
  }

  playDoubleGold() {
    if (!this.canPlayEffect("double-gold", 0.25)) {
      return;
    }
    for (const [index, note] of [880, 1175, 1568, 2093].entries()) {
      this.playTone({ frequency: note, endFrequency: note * 1.08, duration: 0.13, gain: 0.052, type: "sine", delay: index * 0.045 });
    }
    this.playNoise({ duration: 0.12, gain: 0.025, filterFrequency: 3600, filterType: "highpass", delay: 0.08 });
  }

  playDash() {
    if (!this.canPlayEffect("dash", 0.08)) {
      return;
    }
    this.playTone({ frequency: 390, endFrequency: 820, duration: 0.13, gain: 0.1, type: "sine" });
    this.playNoise({ duration: 0.08, gain: 0.035, filterFrequency: 2400, filterType: "highpass" });
  }

  playLevelUp() {
    if (!this.canPlayEffect("level-up", 0.25)) {
      return;
    }
    for (const [index, note] of [520, 660, 790, 1040].entries()) {
      this.playTone({ frequency: note, endFrequency: note * 1.18, duration: 0.15, gain: 0.07, type: index % 2 ? "sine" : "triangle", delay: index * 0.045 });
    }
  }

  playUpgradeSelect() {
    if (!this.canPlayEffect("upgrade-select", 0.16)) {
      return;
    }
    this.playTone({ frequency: 660, endFrequency: 990, duration: 0.1, gain: 0.055, type: "triangle" });
    this.playTone({ frequency: 990, endFrequency: 1320, duration: 0.12, gain: 0.046, type: "sine", delay: 0.055 });
  }

  playBossWarning() {
    if (!this.canPlayEffect("boss-warning", 0.45)) {
      return;
    }
    this.playTone({ frequency: 260, endFrequency: 170, duration: 0.18, gain: 0.16, type: "sawtooth" });
    this.playTone({ frequency: 310, endFrequency: 215, duration: 0.18, gain: 0.12, type: "sawtooth", delay: 0.22 });
    this.playNoise({ duration: 0.12, gain: 0.035, filterFrequency: 520, filterType: "lowpass", delay: 0.02 });
  }

  playBossSpawn() {
    if (!this.canPlayEffect("boss-spawn", 0.6)) {
      return;
    }
    this.playNoise({ duration: 0.3, gain: 0.12, filterFrequency: 300, filterType: "lowpass" });
    this.playTone({ frequency: 120, endFrequency: 180, duration: 0.35, gain: 0.13, type: "sawtooth" });
    this.playTone({ frequency: 80, endFrequency: 62, duration: 0.5, gain: 0.1, type: "triangle" });
  }

  playBossAttack(kind = "attack") {
    if (!this.canPlayEffect(`boss-attack-${kind}`, 0.16)) {
      return;
    }
    if (kind === "burst") {
      this.playTone({ frequency: 180, endFrequency: 420, duration: 0.18, gain: 0.1, type: "sawtooth" });
      this.playNoise({ duration: 0.11, gain: 0.055, filterFrequency: 1100, filterType: "bandpass" });
      return;
    }
    if (kind === "summon") {
      this.playTone({ frequency: 190, endFrequency: 570, duration: 0.28, gain: 0.09, type: "triangle" });
      this.playTone({ frequency: 285, endFrequency: 760, duration: 0.22, gain: 0.06, type: "sine", delay: 0.06 });
      return;
    }
    this.playTone({ frequency: 320, endFrequency: 150, duration: 0.2, gain: 0.1, type: "sawtooth" });
    this.playNoise({ duration: 0.08, gain: 0.04, filterFrequency: 900, filterType: "bandpass", delay: 0.02 });
  }

  playEnemyShoot() {
    if (!this.canPlayEffect("enemy-shoot", 0.12)) {
      return;
    }
    this.playTone({ frequency: 520, endFrequency: 300, duration: 0.075, gain: 0.052, type: "sawtooth" });
  }

  playPlayerDamage() {
    if (!this.canPlayEffect("player-damage", 0.18)) {
      return;
    }
    this.playNoise({ duration: 0.13, gain: 0.09, filterFrequency: 480, filterType: "lowpass" });
    this.playTone({ frequency: 180, endFrequency: 70, duration: 0.22, gain: 0.12, type: "sawtooth" });
  }

  playShieldBlock() {
    if (!this.canPlayEffect("shield-block", 0.16)) {
      return;
    }
    this.playTone({ frequency: 740, endFrequency: 1180, duration: 0.12, gain: 0.075, type: "sine" });
    this.playTone({ frequency: 370, endFrequency: 920, duration: 0.14, gain: 0.045, type: "triangle", delay: 0.02 });
  }

  playGrenadeThrow() {
    if (!this.canPlayEffect("grenade-throw", 0.12)) {
      return;
    }
    this.playTone({ frequency: 360, endFrequency: 220, duration: 0.12, gain: 0.065, type: "triangle" });
    this.playNoise({ duration: 0.05, gain: 0.02, filterFrequency: 1800, filterType: "highpass" });
  }

  playSpecialGrenadeThrowClip() {
    if (typeof Audio === "undefined") {
      return;
    }
    const clip = new Audio(this.specialGrenadeClipSrc);
    clip.loop = false;
    clip.muted = false;
    clip.volume = 1;
    clip.play().catch(() => {});
  }

  playExplosion(power = 1) {
    if (!this.canPlayEffect("explosion", 0.08)) {
      return;
    }
    const safePower = Math.max(0.5, Math.min(1.7, power));
    this.playNoise({ duration: 0.26, gain: 0.12 * safePower, filterFrequency: 360, filterType: "lowpass" });
    this.playNoise({ duration: 0.09, gain: 0.05 * safePower, filterFrequency: 1500, filterType: "bandpass" });
    this.playTone({ frequency: 115, endFrequency: 52, duration: 0.34, gain: 0.1 * safePower, type: "sawtooth" });
  }

  playMinePlace() {
    if (!this.canPlayEffect("mine-place", 0.08)) {
      return;
    }
    this.playTone({ frequency: 420, endFrequency: 310, duration: 0.08, gain: 0.055, type: "triangle" });
    this.playTone({ frequency: 620, endFrequency: 620, duration: 0.045, gain: 0.04, type: "sine", delay: 0.08 });
  }

  playMineArmed() {
    if (!this.canPlayEffect("mine-armed", 0.12)) {
      return;
    }
    this.playTone({ frequency: 820, endFrequency: 1180, duration: 0.07, gain: 0.045, type: "sine" });
  }

  playMineExplosion() {
    this.playExplosion(1.15);
    this.playTone({ frequency: 220, endFrequency: 92, duration: 0.2, gain: 0.08, type: "square", delay: 0.03 });
  }

  playTurretDeploy() {
    if (!this.canPlayEffect("turret-deploy", 0.12)) {
      return;
    }
    this.playTone({ frequency: 540, endFrequency: 760, duration: 0.08, gain: 0.055, type: "triangle" });
    this.playTone({ frequency: 760, endFrequency: 1120, duration: 0.09, gain: 0.045, type: "sine", delay: 0.075 });
  }

  playTurretFire() {
    if (!this.canPlayEffect("turret-fire", 0.045)) {
      return;
    }
    this.playTone({ frequency: 980, endFrequency: 720, duration: 0.045, gain: 0.043, type: "square" });
  }

  playDeath() {
    if (!this.canPlayEffect("death", 0.45)) {
      return;
    }
    this.playNoise({ duration: 0.32, gain: 0.09, filterFrequency: 360, filterType: "lowpass" });
    this.playTone({ frequency: 260, endFrequency: 86, duration: 0.5, gain: 0.18, type: "triangle" });
    this.playTone({ frequency: 160, endFrequency: 58, duration: 0.62, gain: 0.1, type: "sawtooth", delay: 0.04 });
  }

  playTone({ frequency, endFrequency = frequency, duration, gain, type, delay = 0, attack = 0.008 }) {
    if (this.muted || !this.context || !this.masterGain) {
      return;
    }

    const safeDuration = Math.max(0.02, duration);
    const safeAttack = Math.max(0.002, Math.min(attack, safeDuration * 0.45));
    const now = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const volume = this.context.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(Math.max(40, frequency), now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, endFrequency), now + safeDuration);

    volume.gain.setValueAtTime(0.0001, now);
    volume.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), now + safeAttack);
    volume.gain.exponentialRampToValueAtTime(0.0001, now + safeDuration);

    oscillator.connect(volume);
    volume.connect(this.masterGain);
    oscillator.start(now);
    oscillator.stop(now + safeDuration + 0.03);
  }

  playNoise({ duration, gain, delay = 0, filterFrequency = 1000, filterType = "bandpass" }) {
    if (this.muted || !this.context || !this.masterGain) {
      return;
    }

    const safeDuration = Math.max(0.02, duration);
    const sampleRate = this.context.sampleRate;
    const frameCount = Math.max(1, Math.floor(sampleRate * safeDuration));
    const buffer = this.context.createBuffer(1, frameCount, sampleRate);
    const data = buffer.getChannelData(0);
    for (let index = 0; index < frameCount; index += 1) {
      const fade = 1 - index / frameCount;
      data[index] = (Math.random() * 2 - 1) * fade;
    }

    const now = this.context.currentTime + delay;
    const source = this.context.createBufferSource();
    const filter = this.context.createBiquadFilter();
    const volume = this.context.createGain();
    source.buffer = buffer;
    filter.type = filterType;
    filter.frequency.setValueAtTime(Math.max(40, filterFrequency), now);
    volume.gain.setValueAtTime(0.0001, now);
    volume.gain.exponentialRampToValueAtTime(Math.max(0.0001, gain), now + 0.008);
    volume.gain.exponentialRampToValueAtTime(0.0001, now + safeDuration);
    source.connect(filter);
    filter.connect(volume);
    volume.connect(this.masterGain);
    source.start(now);
    source.stop(now + safeDuration + 0.02);
  }
}
