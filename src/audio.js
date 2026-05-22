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
  }

  async unlock() {
    if (!window.AudioContext && !window.webkitAudioContext) {
      return;
    }

    if (!this.context) {
      const AudioContextCtor = window.AudioContext || window.webkitAudioContext;
      this.context = new AudioContextCtor();
      this.masterGain = this.context.createGain();
      this.masterGain.gain.value = this.muted ? 0 : 0.12;
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
      this.masterGain.gain.value = nextMuted ? 0 : 0.12;
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
    await this.unlock();
    this.stopMusic();
    if (!song || this.muted) {
      return;
    }
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

  playShoot() {
    this.playTone({ frequency: 640, endFrequency: 420, duration: 0.08, gain: 0.13, type: "triangle" });
  }

  playHit() {
    this.playTone({ frequency: 220, endFrequency: 110, duration: 0.12, gain: 0.18, type: "square" });
  }

  playDash() {
    this.playTone({ frequency: 450, endFrequency: 760, duration: 0.11, gain: 0.14, type: "sine" });
  }

  playLevelUp() {
    this.playTone({ frequency: 520, endFrequency: 920, duration: 0.18, gain: 0.16, type: "triangle" });
    this.playTone({ frequency: 760, endFrequency: 1080, duration: 0.16, gain: 0.1, type: "sine", delay: 0.05 });
  }

  playBossWarning() {
    this.playTone({ frequency: 260, endFrequency: 180, duration: 0.16, gain: 0.18, type: "sawtooth" });
    this.playTone({ frequency: 310, endFrequency: 230, duration: 0.16, gain: 0.12, type: "sawtooth", delay: 0.22 });
  }

  playDeath() {
    this.playTone({ frequency: 260, endFrequency: 90, duration: 0.42, gain: 0.24, type: "triangle" });
  }

  playTone({ frequency, endFrequency, duration, gain, type, delay = 0 }) {
    if (this.muted || !this.context || !this.masterGain) {
      return;
    }

    const now = this.context.currentTime + delay;
    const oscillator = this.context.createOscillator();
    const volume = this.context.createGain();

    oscillator.type = type;
    oscillator.frequency.setValueAtTime(frequency, now);
    oscillator.frequency.exponentialRampToValueAtTime(Math.max(40, endFrequency), now + duration);

    volume.gain.setValueAtTime(0.0001, now);
    volume.gain.exponentialRampToValueAtTime(gain, now + 0.01);
    volume.gain.exponentialRampToValueAtTime(0.0001, now + duration);

    oscillator.connect(volume);
    volume.connect(this.masterGain);
    oscillator.start(now);
    oscillator.stop(now + duration + 0.03);
  }
}
